pub mod extension;
pub mod noop;

pub use extension::{ExtensionRegistry, HandlerFn, HostExtension, HostFunction};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

pub trait NatsPublisher: Send + Sync {
    fn publish(&self, subject: &str, data: Value) -> Result<(), String>;
}

/// How a module wants a stored value treated, beyond its bytes.
///
/// A struct rather than a bare flag: `set(key, value, true)` at a call site
/// says nothing about what is being asked for, and `namespace` and `expires_at`
/// are the other two metadata fields the storage proto carries that no writer
/// populates yet.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StorageSetOptions {
    /// Drop this key when the stream session ends.
    ///
    /// The module only declares the intent; the engine clears it, because the
    /// sandbox deliberately exposes no way to delete storage. Defaults to
    /// false, which is the safe direction -- a key that outlives a session can
    /// still be cleared later, one wrongly dropped is gone.
    pub clear_on_session_end: bool,
}

/// What a compare-and-set did.
#[derive(Debug, Clone, PartialEq)]
pub struct CompareAndSetOutcome {
    /// Whether the value was written.
    pub swapped: bool,
    /// What the key holds now: the value just written, or the one that stopped
    /// the write -- which is what a caller retries from. `None` when empty.
    pub current: Option<Value>,
}

/// Module storage. Every call names the namespace it reads or writes -- the
/// owning module's manifest id -- so one module can never reach another's
/// values, even under the same key.
pub trait StorageClient: Send + Sync {
    fn get(&self, namespace: &str, key: &str) -> Result<Option<Value>, String>;
    fn set(
        &self,
        namespace: &str,
        key: &str,
        value: Value,
        options: StorageSetOptions,
    ) -> Result<(), String>;
    /// Write `value` only if the key holds `expected` now (or nothing, when
    /// `expected` is `None`), in one transaction.
    fn compare_and_set(
        &self,
        namespace: &str,
        key: &str,
        expected: Option<&Value>,
        value: Value,
        options: StorageSetOptions,
    ) -> Result<CompareAndSetOutcome, String>;
}

pub trait EnvReader: Send + Sync {
    fn get(&self, key: &str) -> Option<String>;
}

pub trait HttpClient: Send + Sync {
    fn request(&self, url: &str, method: &str, opts: Value) -> Result<Value, String>;
}

pub trait ChatSender: Send + Sync {
    fn send_message(&self, text: &str) -> Result<(), String>;
}

/// A view of a runtime-created resource instance, returned across the
/// `ResourceClient` trait boundary. Mirrors the `ModuleResourceInstance`
/// proto message but stays decoupled from the generated client crate so
/// `lib_sandbox` doesn't take on `prost` / `tonic` dependencies.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceInstance {
    pub canonical_id: String,
    pub module_name: String,
    pub kind: String,
    pub instance_id: String,
    pub display_name: String,
    /// What the instance was created with: the values of its kind's `schema`
    /// fields, as an object. The owning module is the only reader that knows
    /// what they mean.
    pub settings: Value,
}

/// Sandbox-side surface for the runtime-instance system. Concrete
/// implementations live outside `lib_sandbox` (typically in the
/// `barkloader` app, calling the db-proxy via Twirp). Modules invoke
/// this via the `ctx.resources.*` namespace.
///
/// `owning_module_name` is the manifest-local module id (e.g.
/// `"counter"`) — the trait impl resolves it to the engine's UUID
/// internally. Callers should pass `invocation.module_id`.
/// Pre-loads module-level settings as a typed key/value map. Concrete
/// implementations live in barkloader app (HTTP call to db-proxy). The noop
/// impl returns an empty map so tests and builtin invocations compile without
/// a real db-proxy.
pub trait SettingsClient: Send + Sync {
    fn list_by_module(&self, module_id: &str) -> Result<HashMap<String, Value>, String>;
    /// Sets a single setting value, e.g. from `ctx.module.setSetting(key, value)`.
    /// Does not require the key to have been declared in the manifest.
    fn set(&self, module_id: &str, key: &str, value: &str) -> Result<(), String>;
}

pub trait ResourceClient: Send + Sync {
    fn create(
        &self,
        owning_module_name: &str,
        kind: &str,
        instance_id: &str,
        display_name: &str,
        settings: &Value,
    ) -> Result<ResourceInstance, String>;
    fn delete(&self, canonical_id: &str) -> Result<(), String>;
    /// One instance by canonical id, or `None` when nothing has that id.
    fn get(&self, canonical_id: &str) -> Result<Option<ResourceInstance>, String>;
    fn list_by_kind(&self, kind: &str) -> Result<Vec<ResourceInstance>, String>;
}

#[derive(Clone)]
pub struct HostContext {
    pub nats: Arc<dyn NatsPublisher>,
    pub storage: Arc<dyn StorageClient>,
    pub env: Arc<dyn EnvReader>,
    pub http: Arc<dyn HttpClient>,
    pub resources: Arc<dyn ResourceClient>,
    pub settings: Arc<dyn SettingsClient>,
    pub extensions: Arc<ExtensionRegistry>,
}

pub struct InvocationContext {
    pub event: Value,
    pub user: Value,
    pub host: HostContext,
    /// Manifest-local module id resolved from the canonical function path
    /// (`<module_id>:function:<func_id>`). Empty for builtin invocations.
    /// Used by the storage namespace to scope the auto-emitted
    /// `module.storage.<module_id>.changed` event.
    pub module_id: String,
    /// Human-readable module display name (e.g. "Spotify Song Request").
    pub module_name: String,
    /// Semver version string from the manifest (e.g. "1.0.0").
    pub module_version: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct StaticSettingsClient {
        data: HashMap<String, serde_json::Value>,
    }

    impl SettingsClient for StaticSettingsClient {
        fn list_by_module(
            &self,
            _module_id: &str,
        ) -> Result<HashMap<String, serde_json::Value>, String> {
            Ok(self.data.clone())
        }
        fn set(&self, _module_id: &str, _key: &str, _value: &str) -> Result<(), String> {
            Ok(())
        }
    }

    #[test]
    fn settings_client_returns_map() {
        let mut data = HashMap::new();
        data.insert(
            "clientId".to_string(),
            serde_json::Value::String("abc".to_string()),
        );
        let client = StaticSettingsClient { data };
        let result = client.list_by_module("spotify").unwrap();
        assert_eq!(
            result["clientId"],
            serde_json::Value::String("abc".to_string())
        );
    }
}
