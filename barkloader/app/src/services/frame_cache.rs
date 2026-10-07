//! Widget frames, kept until the installed modules change.
//!
//! A frame is a pure function of what is installed: the widget's entry file
//! under its version-scoped directory, its module's record and manifest, and
//! the themes other installed modules ship. Resolving one costs several
//! db-proxy round trips and repository reads, and an overlay asks for one per
//! widget on every load, so every frame is resolved once and served from here
//! until something that could change it happens.
//!
//! Barkloader makes every one of those changes itself -- install, upgrade,
//! rollback, uninstall, a storage backend swap -- and each clears the whole
//! cache rather than working out which entries a change touches. They are
//! rare, and a theme can live in a different module from the widget it
//! themes, so a precise invalidation would have to track that for no gain.
//!
//! Concurrent requests for a frame not yet cached share one resolution: an
//! overlay with five copies of a widget resolves it once. A failed resolution
//! is not kept, so a transient db-proxy error is retried by the next request.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};

use tokio::sync::OnceCell;

/// Most frames kept at once. Keys carry a caller-supplied theme id, so this
/// bounds what arbitrary query strings can grow it to; a real engine holds a
/// few dozen. Reaching it clears the cache, which only costs re-resolving.
pub const MAX_ENTRIES: usize = 4096;

/// What a frame depends on beyond the installed modules. The public URL is in
/// the key because it is baked into every URL a frame carries and can be
/// changed from the UI without anything here being told.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct FrameKey {
    pub module_key: String,
    pub manifest_id: String,
    pub theme: Option<String>,
    pub public_url: String,
}

type Cell<V> = Arc<OnceCell<Arc<V>>>;

pub struct FrameCache<V> {
    cells: Mutex<HashMap<FrameKey, Cell<V>>>,
}

impl<V> Default for FrameCache<V> {
    fn default() -> Self {
        Self {
            cells: Mutex::new(HashMap::new()),
        }
    }
}

impl<V> FrameCache<V> {
    pub fn new() -> Self {
        Self::default()
    }

    /// The cached frame for `key`, resolving it with `resolve` when there is
    /// none. Callers arriving while it resolves wait for that resolution
    /// instead of starting their own.
    pub async fn get_or_resolve<E, F, Fut>(&self, key: FrameKey, resolve: F) -> Result<Arc<V>, E>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<V, E>>,
    {
        let cell = self.cell(key);
        cell.get_or_try_init(|| async { resolve().await.map(Arc::new) })
            .await
            .cloned()
    }

    /// Drop every frame. A resolution already running finishes for its own
    /// callers but is not kept: its cell is no longer in the map.
    pub fn clear(&self) {
        self.cells
            .lock()
            .expect("frame cache lock poisoned")
            .clear();
    }

    /// Clears the cache when dropped, however the holder exits. A lifecycle
    /// handler takes one first, so a frame resolved mid-install against the
    /// old version cannot outlive the install, even one that fails halfway.
    pub fn clear_on_drop(self: &Arc<Self>) -> ClearOnDrop<V> {
        ClearOnDrop(Arc::clone(self))
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.cells.lock().expect("frame cache lock poisoned").len()
    }

    fn cell(&self, key: FrameKey) -> Cell<V> {
        let mut cells = self.cells.lock().expect("frame cache lock poisoned");
        if let Some(cell) = cells.get(&key) {
            return Arc::clone(cell);
        }
        if cells.len() >= MAX_ENTRIES {
            cells.clear();
        }
        let cell: Cell<V> = Arc::new(OnceCell::new());
        cells.insert(key, Arc::clone(&cell));
        cell
    }
}

#[must_use = "the cache is cleared when this is dropped"]
pub struct ClearOnDrop<V>(Arc<FrameCache<V>>);

impl<V> Drop for ClearOnDrop<V> {
    fn drop(&mut self) {
        self.0.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn key(manifest_id: &str) -> FrameKey {
        FrameKey {
            module_key: "woofx3".into(),
            manifest_id: manifest_id.into(),
            theme: None,
            public_url: "https://engine.example.test".into(),
        }
    }

    async fn resolve_counting(
        cache: &FrameCache<String>,
        k: FrameKey,
        calls: &AtomicUsize,
    ) -> Result<Arc<String>, ()> {
        cache
            .get_or_resolve(k, || async {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok::<_, ()>("frame".to_string())
            })
            .await
    }

    #[tokio::test]
    async fn resolves_once_and_serves_the_cached_frame() {
        let cache = FrameCache::new();
        let calls = AtomicUsize::new(0);
        for _ in 0..3 {
            let frame = resolve_counting(&cache, key("text"), &calls).await.unwrap();
            assert_eq!(*frame, "frame");
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn keeps_each_key_apart() {
        let cache = FrameCache::new();
        let calls = AtomicUsize::new(0);
        resolve_counting(&cache, key("text"), &calls).await.unwrap();
        resolve_counting(&cache, key("timer"), &calls)
            .await
            .unwrap();
        let mut themed = key("text");
        themed.theme = Some("woofx3:theme:neon".into());
        resolve_counting(&cache, themed, &calls).await.unwrap();
        let mut moved = key("text");
        moved.public_url = "https://elsewhere.example.test".into();
        resolve_counting(&cache, moved, &calls).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 4);
    }

    #[tokio::test]
    async fn concurrent_callers_share_one_resolution() {
        let cache = Arc::new(FrameCache::<String>::new());
        let calls = Arc::new(AtomicUsize::new(0));
        let gate = Arc::new(tokio::sync::Notify::new());
        let mut tasks = Vec::new();
        for _ in 0..5 {
            let (cache, calls, gate) = (cache.clone(), calls.clone(), gate.clone());
            tasks.push(tokio::spawn(async move {
                cache
                    .get_or_resolve(key("text"), || async move {
                        calls.fetch_add(1, Ordering::SeqCst);
                        gate.notified().await;
                        Ok::<_, ()>("frame".to_string())
                    })
                    .await
            }));
        }
        tokio::task::yield_now().await;
        gate.notify_waiters();
        gate.notify_one();
        for task in tasks {
            assert_eq!(*task.await.unwrap().unwrap(), "frame");
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn does_not_keep_a_failure() {
        let cache = FrameCache::<String>::new();
        let failed: Result<_, &str> = cache
            .get_or_resolve(key("text"), || async { Err("db-proxy unreachable") })
            .await;
        assert!(failed.is_err());
        let calls = AtomicUsize::new(0);
        resolve_counting(&cache, key("text"), &calls).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn clear_drops_every_frame() {
        let cache = FrameCache::new();
        let calls = AtomicUsize::new(0);
        resolve_counting(&cache, key("text"), &calls).await.unwrap();
        cache.clear();
        assert_eq!(cache.len(), 0);
        resolve_counting(&cache, key("text"), &calls).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn the_guard_clears_when_dropped() {
        let cache = Arc::new(FrameCache::new());
        let calls = AtomicUsize::new(0);
        {
            let _guard = cache.clear_on_drop();
            resolve_counting(&cache, key("text"), &calls).await.unwrap();
            assert_eq!(cache.len(), 1);
        }
        assert_eq!(cache.len(), 0);
    }

    #[tokio::test]
    async fn a_resolution_cleared_midway_is_not_kept() {
        let cache = Arc::new(FrameCache::<String>::new());
        let gate = Arc::new(tokio::sync::Notify::new());
        let task = {
            let (cache, gate) = (cache.clone(), gate.clone());
            tokio::spawn(async move {
                cache
                    .get_or_resolve(key("text"), || async move {
                        gate.notified().await;
                        Ok::<_, ()>("old version".to_string())
                    })
                    .await
            })
        };
        tokio::task::yield_now().await;
        cache.clear();
        gate.notify_one();
        assert_eq!(*task.await.unwrap().unwrap(), "old version");

        let calls = AtomicUsize::new(0);
        let fresh = resolve_counting(&cache, key("text"), &calls).await.unwrap();
        assert_eq!(*fresh, "frame");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn reaching_the_cap_starts_over() {
        let cache = FrameCache::new();
        let calls = AtomicUsize::new(0);
        for i in 0..MAX_ENTRIES {
            resolve_counting(&cache, key(&format!("w{i}")), &calls)
                .await
                .unwrap();
        }
        assert_eq!(cache.len(), MAX_ENTRIES);
        resolve_counting(&cache, key("one-more"), &calls)
            .await
            .unwrap();
        assert_eq!(cache.len(), 1);
    }
}
