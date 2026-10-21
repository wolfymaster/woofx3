use anyhow::Result;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

use lib_repository::RepositoryImpl;
use lib_sandbox::{ModuleRegistry, SandboxFactory};

use crate::services::file_service::FileService;
use crate::services::public_url::PublicUrlResolver;
use crate::services::scheduler::ModuleScheduler;
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

/// One async lock per module name, so an install, a delete and a rollback of
/// the same module run one after another instead of interleaving their
/// repository and registry writes. Different modules never wait on each other.
#[derive(Default)]
pub struct ModuleLocks(Mutex<HashMap<String, Arc<AsyncMutex<()>>>>);

impl ModuleLocks {
    pub fn new() -> Self {
        Self::default()
    }

    /// Waits for the module's turn; the lock is released when the guard drops.
    pub async fn lock(&self, module_name: &str) -> OwnedMutexGuard<()> {
        let slot = {
            let mut slots = self
                .0
                .lock()
                // The map only holds Arc slots, so it stays consistent even
                // if a holder panicked.
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            // A slot only the map holds is idle; dropping it keeps the map
            // from growing with every module name ever seen.
            slots.retain(|_, slot| Arc::strong_count(slot) > 1);
            slots
                .entry(module_name.to_string())
                .or_insert_with(|| Arc::new(AsyncMutex::new(())))
                .clone()
        };
        slot.lock_owned().await
    }
}

#[allow(dead_code)]
#[derive(Clone)]
pub struct AppContext {
    pub repository: SharedRepository,
    pub sandbox: SandboxFactory,
    pub registry: Arc<ModuleRegistry>,
    pub db_proxy_url: Option<String>,
    pub scheduler: Arc<ModuleScheduler>,
    pub public_url_resolver: Arc<PublicUrlResolver>,
    /// `ctx.oauth`, for completing a connect; absent without a host context.
    pub oauth: Option<Arc<crate::services::oauth::OAuthService>>,
    /// Resolved widget frames, cleared by every module lifecycle change.
    pub frame_cache: Arc<crate::routes::widgets::WidgetFrameCache>,
    pub file_service: Arc<FileService>,
    pub module_locks: Arc<ModuleLocks>,
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    async fn exclusive_section(locks: Arc<ModuleLocks>, name: &str, inside: Arc<AtomicUsize>) {
        let _turn = locks.lock(name).await;
        assert_eq!(inside.fetch_add(1, Ordering::SeqCst), 0, "overlapped");
        tokio::time::sleep(Duration::from_millis(20)).await;
        inside.fetch_sub(1, Ordering::SeqCst);
    }

    #[tokio::test]
    async fn operations_on_one_module_run_one_at_a_time() {
        let locks = Arc::new(ModuleLocks::new());
        let inside = Arc::new(AtomicUsize::new(0));

        let tasks: Vec<_> = (0..4)
            .map(|_| tokio::spawn(exclusive_section(locks.clone(), "cozy", inside.clone())))
            .collect();
        for task in tasks {
            task.await.unwrap();
        }
    }

    #[tokio::test]
    async fn different_modules_do_not_wait_on_each_other() {
        let locks = ModuleLocks::new();
        let _held = locks.lock("cozy").await;

        tokio::time::timeout(Duration::from_secs(1), locks.lock("other"))
            .await
            .expect("another module's lock is free");
    }

    #[tokio::test]
    async fn idle_slots_are_dropped() {
        let locks = ModuleLocks::new();
        drop(locks.lock("a").await);
        drop(locks.lock("b").await);

        assert_eq!(locks.0.lock().unwrap().len(), 1);
    }
}
