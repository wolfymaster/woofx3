use anyhow::{anyhow, Result};
use lib_repository::Repository;
use log::{info, warn};
use std::path::Path;

use super::db_proxy::{create_module, create_module_resource, CreateModuleFunctionJson};
use super::module_file::ModuleFile;
use super::module_manifest::ModuleManifest;

pub struct VersionConflict {
    pub module_name: String,
    pub existing_version: String,
    pub new_version: String,
}

pub enum VersionConflictAction {
    Reject,
    ForceOverwrite,
    AutoIncrementPatch,
}

pub async fn check_version_conflict<R: Repository>(
    module_name: &str,
    module_key: &str,
    new_version: &str,
    repository: &R,
) -> Result<Option<VersionConflict>> {
    let archive_key = format!("archives/{}.zip", module_key);
    match repository.exists(&archive_key).await {
        Ok(true) => Ok(Some(VersionConflict {
            module_name: module_name.to_string(),
            existing_version: new_version.to_string(),
            new_version: new_version.to_string(),
        })),
        Ok(false) => Ok(None),
        Err(_) => Ok(None),
    }
}

pub async fn cleanup_old_version(
    module_name: &str,
    db_proxy_url: Option<&str>,
    application_id: &str,
) -> Result<()> {
    let url = match db_proxy_url {
        Some(u) => u,
        None => return Ok(()),
    };

    super::db_proxy::delete_triggers_by_module_id(url, module_name).await?;
    super::db_proxy::delete_actions_by_module_id(url, module_name).await?;
    info!("Deleted triggers and actions for module {}", module_name);

    super::db_proxy::delete_workflows_by_module(url, application_id, module_name).await?;
    info!("Deleted workflows for module {}", module_name);

    super::db_proxy::delete_commands_by_module(url, application_id, module_name).await?;
    info!("Deleted commands for module {}", module_name);

    Ok(())
}

/// Compensating cleanup for a half-completed install. Called when any db-side
/// step after `create_module` fails so the next install attempt doesn't trip
/// the `modules_name_key` unique constraint. Each step is best-effort — a
/// cleanup error is logged and suppressed so the original install error
/// surfaces to the caller.
async fn rollback_db_install(
    db_proxy_url: &str,
    manifest_module_key: &str,
    module_name: &str,
    application_id: &str,
) {
    if let Err(e) =
        cleanup_old_version(manifest_module_key, Some(db_proxy_url), application_id).await
    {
        warn!(
            "rollback: cleanup_old_version({}) failed: {}",
            manifest_module_key, e
        );
    }
    if let Err(e) = super::db_proxy::delete_module(db_proxy_url, module_name).await {
        warn!("rollback: delete_module({}) failed: {}", module_name, e);
    } else {
        info!("rollback: removed module row for {}", module_name);
    }
}

pub async fn run_install<R: Repository>(
    manifest: &ModuleManifest,
    files: &[ModuleFile],
    repository: &R,
    archive_key: &str,
    db_proxy_url: Option<&str>,
    application_id: &str,
    cleanup_old: bool,
    composite_module_key: &str,
    client_id: &str,
) -> Result<()> {
    // `module_key` here is the manifest id (used for file paths and as the
    // module_name-style ref passed to child resource registrations).
    // `composite_module_key` is the `{id}:{version}:{hash}` idempotency key
    // that gets persisted on the module row and is the actual `moduleKey`
    // returned to the UI — these two are NOT the same.
    let module_key = manifest.module_key();
    let mut fn_rows: Vec<CreateModuleFunctionJson> =
        Vec::with_capacity(manifest.functions.len());

    for f in &manifest.functions {
        let file_key = f.upload_to_repository(&module_key, files, repository).await?;
        let file_name = Path::new(&f.path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("function")
            .to_string();
        fn_rows.push(CreateModuleFunctionJson {
            function_name: f.id.clone(),
            file_name,
            file_key,
            entry_point: f.entry_point.clone().unwrap_or_default(),
            runtime: f.runtime.clone(),
        });
    }

    for w in &manifest.widgets {
        w.upload_assets(&module_key, files, repository).await?;
    }

    for o in &manifest.overlays {
        o.upload_entry(&module_key, files, repository).await?;
    }

    if let Some(url) = db_proxy_url {
        if cleanup_old {
            cleanup_old_version(module_key, Some(url), application_id).await?;
        }

        // Saga-style install: every step after `create_module` must be paired
        // with a compensating cleanup if the install fails partway through.
        // We run the whole db-side sequence inside an async block so a single
        // rollback path handles any failure.
        let install_result: Result<()> = async {
            let manifest_json = serde_json::to_string(manifest)
                .map_err(|e| anyhow!("serialize manifest: {}", e))?;
            let db_record_id = create_module(
                url,
                &manifest.name,
                &manifest.version,
                &manifest_json,
                archive_key,
                &fn_rows,
                composite_module_key,
                client_id,
            )
            .await?;

            // Record function resources in ledger
            for f in &manifest.functions {
                if let Err(e) = create_module_resource(
                    url, &db_record_id, "function", "", &f.id, &f.name, &manifest.version,
                ).await {
                    warn!("Failed to record function resource {}: {}", f.id, e);
                }
            }

            // Record widget resources in ledger
            for w in &manifest.widgets {
                if let Err(e) = create_module_resource(
                    url, &db_record_id, "widget", "", &w.id, &w.name, &manifest.version,
                ).await {
                    warn!("Failed to record widget resource {}: {}", w.id, e);
                }
            }

            // Record overlay resources in ledger
            for o in &manifest.overlays {
                if let Err(e) = create_module_resource(
                    url, &db_record_id, "overlay", "", &o.id, &o.name, &manifest.version,
                ).await {
                    warn!("Failed to record overlay resource {}: {}", o.id, e);
                }
            }

            // Register triggers as a single bulk call keyed by the composite module_key.
            let trigger_inputs: Vec<_> = manifest
                .triggers
                .iter()
                .map(|t| t.to_input())
                .collect();
            info!(
                "Registering {} trigger(s) for module {} (moduleKey={})",
                trigger_inputs.len(),
                module_key,
                composite_module_key
            );
            super::db_proxy::register_triggers(
                url,
                composite_module_key,
                &manifest.name,
                &manifest.version,
                trigger_inputs,
            )
            .await?;

            // Ledger rows still record one resource per trigger.
            for t in &manifest.triggers {
                if let Err(e) = create_module_resource(
                    url, &db_record_id, "trigger", "", &t.id, &t.name, &manifest.version,
                ).await {
                    warn!("Failed to record trigger resource {}: {}", t.id, e);
                }
            }

            // Register actions as a single bulk call keyed by the composite module_key.
            let action_inputs: Vec<_> = manifest
                .actions
                .iter()
                .map(|a| a.to_input())
                .collect();
            info!(
                "Registering {} action(s) for module {} (moduleKey={})",
                action_inputs.len(),
                module_key,
                composite_module_key
            );
            super::db_proxy::register_actions(
                url,
                composite_module_key,
                &manifest.name,
                &manifest.version,
                action_inputs,
            )
            .await?;

            for a in &manifest.actions {
                if let Err(e) = create_module_resource(
                    url, &db_record_id, "action", "", &a.id, &a.name, &manifest.version,
                ).await {
                    warn!("Failed to record action resource {}: {}", a.id, e);
                }
            }

            for wf in &manifest.workflows {
                wf.register(module_key, url, application_id).await?;
                if let Err(e) = create_module_resource(
                    url, &db_record_id, "workflow", "", &wf.id, &wf.name, &manifest.version,
                ).await {
                    warn!("Failed to record workflow resource {}: {}", wf.id, e);
                }
            }

            // module_id may have been set above; retrieve it for resource tracking
            let mid = match super::db_proxy::get_module_by_name(url, module_key).await {
                Ok(Some(resp)) => {
                    let v: serde_json::Value = serde_json::from_str(&resp).unwrap_or_default();
                    v.get("module").and_then(|m| m.get("id")).and_then(|v| v.as_str()).unwrap_or("").to_string()
                }
                _ => String::new(),
            };

            for cmd in &manifest.commands {
                cmd.register(module_key, url, application_id).await?;
                if !mid.is_empty() {
                    if let Err(e) = create_module_resource(
                        url, &mid, "command", "", &cmd.id, &cmd.name, &manifest.version,
                    ).await {
                        warn!("Failed to record command resource {}: {}", cmd.id, e);
                    }
                }
            }

            Ok(())
        }
        .await;

        if let Err(e) = install_result {
            warn!(
                "install failed for module {} ({}): rolling back db state: {}",
                manifest.name, composite_module_key, e
            );
            rollback_db_install(url, module_key, &manifest.name, application_id).await;
            return Err(e);
        }
    } else {
        warn!("DB_PROXY_ADDR not set; skipping CreateModule, trigger, workflow, action, and command registration");
        for wf in &manifest.workflows {
            wf.process().await?;
        }
        for c in &manifest.commands {
            c.process().await?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::module_service::module_file::{
        ModuleFile, ModuleFileKind, ModuleValidManifestKind, ModuleValidProgramKind,
    };
    use lib_repository::{FileRepository, FileRepositoryConfig, Repository};

    #[tokio::test]
    async fn install_stores_function_without_db_proxy() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let manifest_json = br#"{
            "id": "test-mod",
            "name": "Test Mod",
            "version": "1.0.0",
            "functions": [{ "id": "f1", "name": "F1", "runtime": "lua", "path": "functions/f1.lua" }]
        }"#;

        let files = vec![
            ModuleFile::new(
                "module.json".into(),
                ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON),
                manifest_json.to_vec(),
            ),
            ModuleFile::new(
                "functions/f1.lua".into(),
                ModuleFileKind::PROGRAM(ModuleValidProgramKind::LUA),
                b"return 1".to_vec(),
            ),
        ];

        let manifest: ModuleManifest = serde_json::from_slice(manifest_json).expect("manifest");
        let mid = manifest.compute_module_key(manifest_json);
        run_install(
            &manifest,
            &files,
            &repo,
            "archives/test-mod/1.0.0.zip",
            None,
            "",
            false,
            &mid,
            "",
        )
        .await
        .expect("install");

        let stored = repo
            .read_file("modules/test-mod/functions/functions/f1.lua")
            .expect("read");
        assert_eq!(stored, b"return 1");
    }

    #[tokio::test]
    async fn install_stores_widget_entry_and_asset_dir() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let manifest_json = br#"{
            "id": "wm",
            "name": "Widget Mod",
            "version": "1.0.0",
            "widgets": [{
                "id": "w1",
                "name": "W",
                "entry": "w/index.html",
                "assets": "w/static/"
            }]
        }"#;

        let files = vec![
            ModuleFile::new(
                "module.json".into(),
                ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON),
                manifest_json.to_vec(),
            ),
            ModuleFile::new(
                "w/index.html".into(),
                ModuleFileKind::ASSET("html".into()),
                b"<!doctype html>".to_vec(),
            ),
            ModuleFile::new(
                "w/static/theme.css".into(),
                ModuleFileKind::ASSET("css".into()),
                b"body{}".to_vec(),
            ),
        ];

        let manifest: ModuleManifest = serde_json::from_slice(manifest_json).expect("manifest");
        let mid = manifest.compute_module_key(manifest_json);
        run_install(&manifest, &files, &repo, "archives/wm/1.0.0.zip", None, "", false, &mid, "")
            .await
            .expect("install");

        let html = repo
            .read_file("modules/wm/widgets/w1/w/index.html")
            .expect("html");
        assert_eq!(html, b"<!doctype html>");
        let css = repo
            .read_file("modules/wm/widgets/w1/theme.css")
            .expect("css");
        assert_eq!(css, b"body{}");
    }

    #[tokio::test]
    async fn install_stores_overlay_entry() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let manifest_json = br#"{
            "id": "om",
            "name": "Overlay Mod",
            "version": "2.0.0",
            "overlays": [{ "id": "o1", "name": "O", "entry": "overlays/o1/index.html" }]
        }"#;

        let files = vec![
            ModuleFile::new(
                "module.json".into(),
                ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON),
                manifest_json.to_vec(),
            ),
            ModuleFile::new(
                "overlays/o1/index.html".into(),
                ModuleFileKind::ASSET("html".into()),
                b"<html/>".to_vec(),
            ),
        ];

        let manifest: ModuleManifest = serde_json::from_slice(manifest_json).expect("manifest");
        let mid = manifest.compute_module_key(manifest_json);
        run_install(&manifest, &files, &repo, "archives/om/2.0.0.zip", None, "", false, &mid, "")
            .await
            .expect("install");

        let html = repo
            .read_file("modules/om/overlays/o1/overlays/o1/index.html")
            .expect("overlay html");
        assert_eq!(html, b"<html/>");
    }
}
