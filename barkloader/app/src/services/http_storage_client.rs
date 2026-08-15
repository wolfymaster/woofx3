//! Production `StorageClient` impl for sandbox runtimes. Bridges the
//! synchronous trait surface that JS/Lua functions see (`ctx.storage.*`)
//! to the async Twirp client functions in `lib_module::db_proxy`. Mirrors
//! `HttpResourceClient` (`sandbox_resources.rs`) — same blocking-on-current-
//! runtime approach, same reason it's safe under actix-web's multi-thread
//! runtime.
//!
//! `value` travels over the wire as a JSON-encoded string (the storage
//! proto's `StorageItem.value` field is a plain `string`); this is where
//! that encoding happens, symmetrically for get and set.

use lib_module::db_proxy;
use lib_sandbox::host::StorageClient;
use serde_json::Value;
use tokio::runtime::Handle;

pub struct HttpStorageClient {
    db_proxy_url: String,
    /// Bound once at construction — today one barkloader process serves
    /// exactly one application, so there is no per-invocation tenant to
    /// thread through (see `main.rs::setup`, which resolves this from
    /// `.woofx3.json`'s `applicationId`).
    application_id: String,
}

impl HttpStorageClient {
    pub fn new(db_proxy_url: String, application_id: String) -> Self {
        Self {
            db_proxy_url,
            application_id,
        }
    }
}

impl StorageClient for HttpStorageClient {
    fn get(&self, key: &str) -> Result<Option<Value>, String> {
        let url = self.db_proxy_url.clone();
        let application_id = self.application_id.clone();
        let key_owned = key.to_string();
        let item = Handle::current()
            .block_on(async move { db_proxy::storage_get(&url, &key_owned, &application_id).await })
            .map_err(|e| e.to_string())?;

        match item {
            Some(item) => serde_json::from_str(&item.value)
                .map(Some)
                .map_err(|e| format!("decode stored value for key {:?}: {}", key, e)),
            None => Ok(None),
        }
    }

    fn set(&self, key: &str, value: Value) -> Result<(), String> {
        let url = self.db_proxy_url.clone();
        let application_id = self.application_id.clone();
        let key = key.to_string();
        let value_str = serde_json::to_string(&value).map_err(|e| e.to_string())?;
        Handle::current()
            .block_on(async move { db_proxy::storage_set(&url, &key, &value_str, &application_id).await })
            .map_err(|e| e.to_string())
    }
}
