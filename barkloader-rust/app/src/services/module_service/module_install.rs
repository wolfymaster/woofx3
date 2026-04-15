use anyhow::{anyhow, Result};
use lib_repository::Repository;
use log::{info, warn};
use std::collections::BTreeMap;
use std::path::Path;

use super::db_proxy::{create_module, CreateModuleFunctionJson};
use super::module_file::ModuleFile;
use super::module_manifest::{ManifestTrigger, ModuleManifest};

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
    new_version: &str,
    repository: &R,
) -> Result<Option<VersionConflict>> {
    let archive_key = format!("archives/{}/{}.zip", module_name, new_version);
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
    application_id: Option<&str>,
) -> Result<()> {
    let url = match db_proxy_url {
        Some(u) => u,
        None => return Ok(()),
    };

    super::db_proxy::delete_triggers_by_module(url, module_name).await?;
    info!("Deleted triggers for module {}", module_name);

    super::db_proxy::delete_actions_by_module(url, module_name).await?;
    info!("Deleted actions for module {}", module_name);

    if let Some(app_id) = application_id {
        super::db_proxy::delete_workflows_by_module(url, app_id, module_name).await?;
        info!("Deleted workflows for module {}", module_name);

        super::db_proxy::delete_commands_by_module(url, app_id, module_name).await?;
        info!("Deleted commands for module {}", module_name);
    }

    Ok(())
}

pub async fn run_install<R: Repository>(
    manifest: &ModuleManifest,
    files: &[ModuleFile],
    repository: &R,
    archive_key: &str,
    db_proxy_url: Option<&str>,
    application_id: Option<&str>,
    cleanup_old: bool,
) -> Result<()> {
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
            if let Some(app_id) = application_id {
                cleanup_old_version(module_key, Some(url), Some(app_id)).await?;
            } else {
                cleanup_old_version(module_key, Some(url), None).await?;
            }
        }

        let manifest_json = serde_json::to_string(manifest)
            .map_err(|e| anyhow!("serialize manifest: {}", e))?;
        create_module(
            url,
            &module_key,
            &manifest.version,
            &manifest_json,
            archive_key,
            &fn_rows,
        )
        .await?;

        let mut by_category: BTreeMap<String, Vec<&ManifestTrigger>> = BTreeMap::new();
        for t in &manifest.triggers {
            let key = t.register_category();
            by_category.entry(key).or_default().push(t);
        }
        for group in by_category.values_mut() {
            group.sort_by_key(|t| t.id.as_str());
        }
        for (category, group) in by_category {
            info!(
                "Registering {} trigger(s) for module {} in category {:?}",
                group.len(),
                module_key,
                category
            );
            for t in group {
                t.register(module_key, url).await?;
            }
        }

        for a in &manifest.actions {
            a.register(module_key, url).await?;
        }

        if let Some(app_id) = application_id {
            for wf in &manifest.workflows {
                wf.register(module_key, url, app_id).await?;
            }
        } else {
            warn!("APPLICATION_ID not set; skipping workflow registration");
            for wf in &manifest.workflows {
                wf.process().await?;
            }
        }
    } else {
        warn!("DB_PROXY_ADDR not set; skipping CreateModule, trigger, workflow, and action registration");
        for wf in &manifest.workflows {
            wf.process().await?;
        }
    }

    if let (Some(url), Some(app_id)) = (db_proxy_url, application_id) {
        for cmd in &manifest.commands {
            cmd.register(module_key, url, app_id).await?;
        }
    } else {
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
        run_install(
            &manifest,
            &files,
            &repo,
            "archives/test-mod/1.0.0.zip",
            None,
            None,
            false,
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
        run_install(&manifest, &files, &repo, "archives/wm/1.0.0.zip", None, None, false)
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
        run_install(&manifest, &files, &repo, "archives/om/2.0.0.zip", None, None, false)
            .await
            .expect("install");

        let html = repo
            .read_file("modules/om/overlays/o1/overlays/o1/index.html")
            .expect("overlay html");
        assert_eq!(html, b"<html/>");
    }
}
