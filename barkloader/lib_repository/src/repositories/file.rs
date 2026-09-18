use crate::repository::{
    CreateFileRequest, ReadEndpoint, Repository, UploadEndpoint, UploadRequest,
};
use anyhow::Result;
use async_trait::async_trait;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::fs;
use tracing::info;

async fn collect_files_recursive(
    dir: PathBuf,
    base: PathBuf,
    results: &mut Vec<String>,
) -> Result<()> {
    let mut stack: Vec<PathBuf> = vec![dir];
    while let Some(current) = stack.pop() {
        let mut read_dir = fs::read_dir(&current).await.map_err(|e| {
            anyhow::anyhow!("failed to read directory {}: {}", current.display(), e)
        })?;
        while let Some(entry) = read_dir.next_entry().await? {
            let path = entry.path();
            let metadata = entry.metadata().await?;
            if metadata.is_dir() {
                stack.push(path);
            } else {
                let relative = path
                    .strip_prefix(&base)
                    .map_err(|e| anyhow::anyhow!("failed to compute relative path: {}", e))?;
                results.push(relative.to_string_lossy().into_owned());
            }
        }
    }
    Ok(())
}

/// A uniquely named sibling of `destination`. Same directory, so the
/// final rename stays on one filesystem and is atomic.
fn staging_path_for(destination: &Path) -> PathBuf {
    let file_name = destination
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    destination.with_file_name(format!(".{}.{}.partial", file_name, uuid::Uuid::new_v4()))
}

#[derive(Clone, Debug)]
pub struct FileRepositoryConfig {
    pub destination: PathBuf,
}

#[derive(Clone)]
pub struct FileRepository {
    config: FileRepositoryConfig,
}

impl FileRepository {
    pub fn new(config: FileRepositoryConfig) -> Self {
        Self { config }
    }
}

#[async_trait]
impl Repository for FileRepository {
    fn setup(&self) -> Result<()> {
        // Create destination directory if it doesn't exist
        if !self.config.destination.exists() {
            info!(
                "Creating destination directory: {}",
                self.config.destination.display()
            );
            std::fs::create_dir_all(&self.config.destination).map_err(anyhow::Error::new)?;
        }
        Ok(())
    }

    async fn read_file(&self, key: &str) -> Result<Vec<u8>> {
        let path = self.config.destination.join(key);
        fs::read(&path)
            .await
            .map_err(|e| anyhow::anyhow!("failed to read file {}: {}", path.display(), e))
    }

    async fn delete_prefix(&self, prefix: &str) -> Result<()> {
        let path = self.config.destination.join(prefix);
        if !path.exists() {
            return Ok(());
        }
        if path.is_dir() {
            fs::remove_dir_all(&path).await.map_err(|e| {
                anyhow::anyhow!("failed to delete directory {}: {}", path.display(), e)
            })?;
        } else {
            fs::remove_file(&path)
                .await
                .map_err(|e| anyhow::anyhow!("failed to delete file {}: {}", path.display(), e))?;
        }
        Ok(())
    }

    async fn list_prefix(&self, prefix: &str) -> Result<Vec<String>> {
        let dir = self.config.destination.join(prefix);
        if !dir.exists() {
            return Ok(Vec::new());
        }

        let mut results = Vec::new();
        collect_files_recursive(dir, self.config.destination.clone(), &mut results).await?;
        Ok(results)
    }

    async fn exists(&self, key: &str) -> Result<bool> {
        let path = self.config.destination.join(key);
        Ok(path.exists())
    }

    async fn list<P: AsRef<Path> + Send>(&self, _path: P) -> Result<()> {
        Ok(())
    }

    async fn create<I: IntoIterator<Item = CreateFileRequest> + Send>(
        &self,
        req: I,
        failed: &mut Vec<String>,
    ) -> Result<()> {
        let requests: Vec<CreateFileRequest> = req.into_iter().collect();

        for create_request in requests {
            info!("Writing file {}", create_request.file_name);

            let destination_path = self.config.destination.join(&create_request.file_name);

            // ensure parent directories exist for nested paths
            if let Some(parent) = destination_path.parent() {
                if !parent.exists() {
                    if let Err(_err) = fs::create_dir_all(parent).await {
                        failed.push(create_request.file_name);
                        continue;
                    }
                }
            }

            // Written beside the destination and renamed into place, so the
            // key only ever names a complete file: a reader never serves a
            // half-written object, and a write that fails midway leaves
            // nothing at the key for `exists` to mistake for a finished one.
            if let Some(contents) = create_request.content {
                let staging_path = staging_path_for(&destination_path);
                let written = match fs::write(&staging_path, contents).await {
                    Ok(()) => fs::rename(&staging_path, &destination_path).await,
                    Err(err) => Err(err),
                };
                if written.is_err() {
                    let _ = fs::remove_file(&staging_path).await;
                    failed.push(create_request.file_name);
                }
            }
        }

        Ok(())
    }

    /// Local disk has nothing to sign against. Reporting that honestly
    /// lets `routes::assets` fall back to its own signed-token upload
    /// endpoint, which presents the caller with the same contract an
    /// S3 presigned PUT does.
    async fn presign_upload(&self, _req: UploadRequest<'_>) -> Result<UploadEndpoint> {
        Ok(UploadEndpoint::Unsupported)
    }

    async fn presign_read(&self, _key: &str, _ttl: Duration) -> Result<ReadEndpoint> {
        Ok(ReadEndpoint::Unsupported)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(root: &Path) -> FileRepository {
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: root.to_path_buf(),
        });
        repo.setup().expect("repo setup");
        repo
    }

    async fn write(repo: &FileRepository, key: &str, contents: &[u8]) -> Vec<String> {
        let mut failed = Vec::new();
        repo.create(
            [CreateFileRequest {
                content: Some(contents.to_vec()),
                extension: None,
                file_name: key.to_string(),
            }],
            &mut failed,
        )
        .await
        .expect("create");
        failed
    }

    #[tokio::test]
    async fn create_leaves_only_the_finished_file_at_the_key() {
        let root = tempfile::tempdir().expect("tempdir");
        let repo = repo(root.path());

        assert!(
            write(&repo, "user/app-1/res-1/clip.png", b"first")
                .await
                .is_empty()
        );
        assert!(
            write(&repo, "user/app-1/res-1/clip.png", b"second")
                .await
                .is_empty()
        );

        assert_eq!(
            std::fs::read(root.path().join("user/app-1/res-1/clip.png")).unwrap(),
            b"second"
        );
        let names: Vec<_> = std::fs::read_dir(root.path().join("user/app-1/res-1"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("clip.png")]);
    }

    #[tokio::test]
    async fn failed_write_leaves_nothing_at_the_key() {
        let root = tempfile::tempdir().expect("tempdir");
        let repo = repo(root.path());
        // A directory where the file should go makes the final rename fail.
        std::fs::create_dir_all(root.path().join("user/app-1/res-1/clip.png/blocker")).unwrap();

        let failed = write(&repo, "user/app-1/res-1/clip.png", b"bytes").await;

        assert_eq!(failed, vec!["user/app-1/res-1/clip.png".to_string()]);
        let names: Vec<_> = std::fs::read_dir(root.path().join("user/app-1/res-1"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("clip.png")]);
        assert!(root.path().join("user/app-1/res-1/clip.png").is_dir());
    }

    #[tokio::test]
    async fn delete_prefix_removes_a_resource_and_its_thumbnail_from_disk() {
        let root = tempfile::tempdir().expect("tempdir");
        let repo = repo(root.path());
        write(&repo, "user/app-1/res-1/clip.png", b"bytes").await;
        write(&repo, "user/app-1/res-1/thumbnail.png", b"thumb").await;
        write(&repo, "user/app-1/res-2/other.png", b"keep").await;

        repo.delete_prefix("user/app-1/res-1/")
            .await
            .expect("delete");

        assert!(!root.path().join("user/app-1/res-1").exists());
        assert!(root.path().join("user/app-1/res-2/other.png").exists());
        // Deleting again is not an error.
        repo.delete_prefix("user/app-1/res-1/")
            .await
            .expect("idempotent delete");
    }
}
