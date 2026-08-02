use anyhow::{anyhow, Result};
use lib_repository::{CreateFileRequest, Repository, RepositoryFactory};
use log::{error, info};
use std::path::{Path, PathBuf};

use crate::util::get_woofx3_json_value;

/// Uploads builtin widget files (bundled as static files inside the
/// streamware repo, checked into `streamware/public/widgets/builtin/`)
/// into the same repository-backed storage barkloader uses for module
/// assets, under the `builtin/widgets/{manifestId}/{relPath}` key prefix —
/// so they're resolvable through the unified asset proxy the same way as
/// module assets, regardless of which repository backend (local file / S3)
/// is configured, rather than only ever being readable off local disk by
/// streamware itself.
///
/// Manually invoked: `cargo run --bin barkloader -- seed-builtin-widgets
/// [--source-dir <path>]`. Idempotent — every write is a plain overwrite,
/// safe to re-run whenever the builtin widget files change. Not run
/// automatically at process start (this is a rare, deploy-time operation,
/// not part of the request-serving hot path).
pub async fn run(args: &[String]) -> std::io::Result<()> {
    match run_inner(args).await {
        Ok(count) => {
            info!("seed-builtin-widgets: wrote {count} file(s)");
            Ok(())
        }
        Err(e) => {
            error!("seed-builtin-widgets failed: {e:?}");
            std::process::exit(1);
        }
    }
}

async fn run_inner(args: &[String]) -> Result<usize> {
    let source_dir = parse_source_dir(args)?;
    info!("Seeding builtin widgets from {}", source_dir.display());

    // Resolve the repository the same way the server's own setup() does,
    // so this writes to whichever backend (local file or S3) the running
    // deployment is actually configured for, not a hardcoded path.
    let db_proxy_url = get_woofx3_json_value("databaseProxyUrl", "");
    let db_proxy_url = if db_proxy_url.is_empty() {
        None
    } else {
        Some(db_proxy_url.as_str())
    };
    let repository_config =
        crate::services::storage_settings::resolve_repository_config(db_proxy_url, crate::DEFAULT_MODULE_DIR)
            .await?;
    let repository = RepositoryFactory::new(&repository_config).await?;
    repository.setup()?;

    let files = walk_files(&source_dir)?;
    if files.is_empty() {
        return Err(anyhow!(
            "no files found under {} — nothing to seed",
            source_dir.display()
        ));
    }

    let mut requests = Vec::with_capacity(files.len());
    for file in &files {
        let rel = file
            .strip_prefix(&source_dir)
            .map_err(|e| anyhow!("{e}"))?
            .to_string_lossy()
            .replace('\\', "/");
        let key = format!("builtin/widgets/{rel}");
        let content = std::fs::read(file).map_err(|e| anyhow!("read {}: {}", file.display(), e))?;
        let extension = file
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("bin")
            .to_string();
        info!("  {} -> {}", file.display(), key);
        requests.push(CreateFileRequest {
            content: Some(content),
            extension: Some(extension),
            file_name: key,
        });
    }

    let count = requests.len();
    let mut failed = Vec::new();
    repository.create(requests, &mut failed).await?;
    if !failed.is_empty() {
        return Err(anyhow!(
            "failed to write {} of {} file(s): {:?}",
            failed.len(),
            count,
            failed
        ));
    }

    Ok(count)
}

/// `--source-dir <path>` overrides the default, which is
/// `{monorepo root}/streamware/public/widgets/builtin` — the monorepo
/// root is located the same way `.woofx3.json` resolution does (walk up
/// from cwd looking for `.woofx3.json`/`.woofx3.config`), so this works
/// regardless of which directory the CLI is invoked from within the repo.
fn parse_source_dir(args: &[String]) -> Result<PathBuf> {
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--source-dir" {
            let value = args
                .get(i + 1)
                .ok_or_else(|| anyhow!("--source-dir requires a value"))?;
            return Ok(PathBuf::from(value));
        }
        i += 1;
    }
    let root = woofx3_runtime::find_config_root(".");
    Ok(PathBuf::from(root).join("streamware/public/widgets/builtin"))
}

fn walk_files(root: &Path) -> Result<Vec<PathBuf>> {
    if !root.exists() {
        return Err(anyhow!(
            "source dir {} does not exist — pass --source-dir to override",
            root.display()
        ));
    }
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries =
            std::fs::read_dir(&dir).map_err(|e| anyhow!("read_dir {}: {}", dir.display(), e))?;
        for entry in entries {
            let entry = entry.map_err(|e| anyhow!("{e}"))?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else {
                out.push(path);
            }
        }
    }
    out.sort();
    Ok(out)
}
