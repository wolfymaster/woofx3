use anyhow::Result;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use lib_repository::RepositoryImpl;
use lib_sandbox::{ModuleRegistry, SandboxFactory};

use crate::services::background_scheduler::BackgroundTaskScheduler;
use crate::services::public_url::PublicUrlResolver;
use crate::util;

/// The live storage backend, swappable at runtime.
///
/// Storage settings are editable from the UI (`api.setStorageConfig`),
/// so the repository resolved at boot is not final -- an operator can
/// change credentials, endpoint, or the provider itself while the
/// process runs. Readers take a snapshot `Arc` and hold it for the
/// duration of one operation, which keeps an in-flight install on the
/// backend it started against rather than tearing across a swap.
///
/// The inner value stays a concrete `RepositoryImpl` rather than
/// `Arc<dyn Repository>` because `Repository` is not object-safe: its
/// `list` and `create` methods are generic. That is the same reason
/// `lib_repository` dispatches through an enum.
#[derive(Clone)]
pub struct SharedRepository(Arc<RwLock<Arc<RepositoryImpl>>>);

impl SharedRepository {
    pub fn new(repository: RepositoryImpl) -> Self {
        Self(Arc::new(RwLock::new(Arc::new(repository))))
    }

    /// Snapshot of the backend currently in force. Clone the `Arc` and
    /// release the lock immediately -- asset delivery runs on this path
    /// and must never contend with a reload.
    pub fn current(&self) -> Arc<RepositoryImpl> {
        self.0.read().expect("repository lock poisoned").clone()
    }

    /// Install a new backend. Callers must have already constructed and
    /// probed it (see `routes::storage`); this is the publish step and
    /// performs no validation of its own.
    pub fn replace(&self, repository: RepositoryImpl) {
        *self.0.write().expect("repository lock poisoned") = Arc::new(repository);
    }
}

#[allow(dead_code)]
#[derive(Clone)]
pub struct AppContext {
    pub repository: SharedRepository,
    pub sandbox: SandboxFactory,
    pub registry: Arc<ModuleRegistry>,
    pub db_proxy_url: Option<String>,
    pub scheduler: Arc<BackgroundTaskScheduler>,
    pub public_url_resolver: Arc<PublicUrlResolver>,
}

pub struct SafeTempDir {
    path: PathBuf,
    allowed_parent: PathBuf,
}

impl SafeTempDir {
    pub fn new<P: AsRef<Path>>(path: P, allowed_parent: P) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        let allowed_parent = allowed_parent.as_ref().to_path_buf();

        Ok(SafeTempDir {
            path,
            allowed_parent,
        })
    }
}

impl Drop for SafeTempDir {
    fn drop(&mut self) {
        if let Err(e) = util::safe_remove_dir_all(&self.path, &self.allowed_parent) {
            eprintln!("Failed to cleanup temporary directory: {}", e);
        }
    }
}
