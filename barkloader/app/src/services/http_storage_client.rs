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
use lib_sandbox::host::{CompareAndSetOutcome, StorageClient, StorageSetOptions};
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

impl HttpStorageClient {
    fn address<'a>(&'a self, namespace: &'a str, key: &'a str) -> db_proxy::StorageAddress<'a> {
        db_proxy::StorageAddress {
            application_id: &self.application_id,
            namespace,
            key,
        }
    }
}

fn decode(raw: &str, key: &str) -> Result<Value, String> {
    serde_json::from_str(raw).map_err(|e| format!("decode stored value for key {:?}: {}", key, e))
}

impl StorageClient for HttpStorageClient {
    fn get(&self, namespace: &str, key: &str) -> Result<Option<Value>, String> {
        let url = self.db_proxy_url.clone();
        let item = Handle::current()
            .block_on(async { db_proxy::storage_get(&url, &self.address(namespace, key)).await })
            .map_err(|e| e.to_string())?;

        item.map(|item| decode(&item.value, key)).transpose()
    }

    fn set(&self, namespace: &str, key: &str, value: Value, options: StorageSetOptions) -> Result<(), String> {
        let url = self.db_proxy_url.clone();
        let value_str = serde_json::to_string(&value).map_err(|e| e.to_string())?;
        Handle::current()
            .block_on(async {
                db_proxy::storage_set(
                    &url,
                    &self.address(namespace, key),
                    &value_str,
                    options.clear_on_session_end,
                )
                .await
            })
            .map_err(|e| e.to_string())
    }

    fn compare_and_set(
        &self,
        namespace: &str,
        key: &str,
        expected: Option<&Value>,
        value: Value,
        options: StorageSetOptions,
    ) -> Result<CompareAndSetOutcome, String> {
        let url = self.db_proxy_url.clone();
        // Encoded the same way `set` encodes, so a value read back and passed
        // as `expected` compares equal to what is stored.
        let expected_str = expected
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| e.to_string())?;
        let value_str = serde_json::to_string(&value).map_err(|e| e.to_string())?;
        let response = Handle::current()
            .block_on(async {
                db_proxy::storage_compare_and_set(
                    &url,
                    &self.address(namespace, key),
                    expected_str.as_deref(),
                    &value_str,
                    options.clear_on_session_end,
                )
                .await
            })
            .map_err(|e| e.to_string())?;

        Ok(CompareAndSetOutcome {
            swapped: response.swapped,
            current: response
                .current
                .map(|item| decode(&item.value, key))
                .transpose()?,
        })
    }
}
