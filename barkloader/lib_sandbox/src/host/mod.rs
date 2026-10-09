pub mod extension;
pub mod noop;
#[cfg(test)]
pub(crate) mod recording;

pub use extension::{
    CallScope, ExtensionRegistry, HandlerFn, HostError, HostExtension, HostFunction,
    PERMISSION_DENIED,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// How long an invocation may run: the longest wait of any barkloader client
/// (shared/clients/golang/barkloader/client.go). A caller may ask for less
/// with `InvokeRequest::timeout_ms`, never more, since host calls past the
/// point every caller has given up only hold a blocking thread.
pub const MAX_INVOCATION_TIMEOUT: Duration = Duration::from_secs(30);

pub trait NatsPublisher: Send + Sync {
    fn publish(&self, subject: &str, data: Value) -> Result<(), String>;
}

/// Why a bus request got no reply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RequestError {
    /// Something is subscribed but did not answer in time. The request may
    /// still have been acted on.
    TimedOut,
    /// Nothing is subscribed to the subject.
    NoResponders,
    /// The request could not be sent or its reply could not be read.
    Failed(String),
}

/// A request/reply on the message bus, for host functions that return what
/// the answering service said.
///
/// Called from the sandbox's blocking thread; implementations block until the
/// reply arrives or `timeout` passes, and never run past `timeout`.
pub trait NatsRequester: Send + Sync {
    /// Send `data` as JSON on `subject` and return the reply decoded as JSON.
    fn request(&self, subject: &str, data: Value, timeout: Duration)
    -> Result<Value, RequestError>;
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

/// The HTTP request a module makes, and where its module may connect.
pub struct HttpRequest<'a> {
    /// The invoking module's manifest-local id, for the log line a refusal
    /// writes.
    pub module_id: &'a str,
    /// The invocation's grants: its declared permissions, including `net:`
    /// hosts, plus the `origin:` grants of its `url` settings. See
    /// `crate::net`.
    pub grants: &'a HashSet<String>,
    pub url: &'a str,
    pub method: &'a str,
    pub opts: Value,
}

pub trait HttpClient: Send + Sync {
    fn request(&self, request: HttpRequest<'_>) -> Result<Value, String>;
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

/// Whether two setting values are the same as a module reads them. Numbers
/// compare by value (`1` and `1.0` are equal), objects regardless of key
/// order, and an empty object equals an empty array, because Lua has one
/// empty table for both and a Lua module reading `[]` would otherwise never
/// match it.
pub fn setting_values_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(x, y)| setting_values_equal(x, y))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| setting_values_equal(v, w)))
        }
        (Value::Array(list), Value::Object(map)) | (Value::Object(map), Value::Array(list)) => {
            list.is_empty() && map.is_empty()
        }
        _ => a == b,
    }
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
    /// `ctx.module.compareAndSetSetting(key, expected, value)`: writes `value`
    /// only while the setting still holds `expected`, compared as the module
    /// reads it (`setting_values_equal`), not
    /// byte for byte, so a list the dashboard saved compares equal to the
    /// same list a function read. `value` is stored as is when it is a
    /// string, as JSON otherwise.
    ///
    /// `current` in the outcome is the setting as the module would read it
    /// now, `None` when the module has no such setting.
    fn compare_and_set(
        &self,
        _module_id: &str,
        _key: &str,
        _expected: &Value,
        _value: &Value,
    ) -> Result<CompareAndSetOutcome, String> {
        Err("ctx.module.compareAndSetSetting is not available on this engine".to_string())
    }
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

/// One-shot invocations a module schedules against the deadlines its manifest
/// declares (`ctx.schedule.*`). The concrete scheduler lives in the barkloader
/// app; it knows each module's declarations and enforces them.
///
/// Called from the sandbox's blocking thread, so implementations must not
/// block on async work: taking a lock and waking the scheduler is the whole
/// budget.
///
/// `module_id` is always the invoking module, bound by the host, never
/// supplied by module code: that is what keeps one module from scheduling or
/// cancelling another's entries.
pub trait ScheduleClient: Send + Sync {
    /// Arm `(module_id, deadline_id, key)` to fire at `when_ms` (Unix epoch
    /// milliseconds), replacing any entry already under that identity. A
    /// time in the past fires as soon as possible.
    fn at(
        &self,
        module_id: &str,
        deadline_id: &str,
        key: &str,
        when_ms: i64,
        params: Value,
    ) -> Result<(), String>;
    /// Drop the entry if there is one. Cancelling nothing is not an error.
    fn cancel(&self, module_id: &str, deadline_id: &str, key: &str) -> Result<(), String>;
    /// Drop every entry, of any module and deadline, whose key is `key`.
    /// Called by the host when the resource instance with that canonical id
    /// is deleted, so a module keying entries by instance never fires for one
    /// that is gone.
    fn cancel_key(&self, key: &str);
}

/// Who is asking `ActionRunner::run` to act: the invoking module, bound by the
/// host and never supplied by module code.
pub struct RunCaller<'a> {
    pub module_id: &'a str,
    /// The invocation's grants, which must cover the providing module's.
    pub permissions: &'a HashSet<String>,
    /// When the caller stops waiting; the action runs within it.
    pub deadline: Instant,
}

/// `ctx.resources.run(canonicalId, verb, params)`: runs the `{kind}.{verb}`
/// action of the module that provides the instance's kind, on that instance,
/// as that module — its code, its storage. How a module drives a timer or a
/// counter it does not own.
///
/// A module may act only on an instance it owns or one its own settings link
/// to, which is the streamer having chosen it. Called from the sandbox's
/// blocking thread.
pub trait ActionRunner: Send + Sync {
    fn run(
        &self,
        caller: &RunCaller<'_>,
        canonical_id: &str,
        verb: &str,
        params: Value,
    ) -> Result<Value, String>;
}

#[derive(Clone)]
pub struct HostContext {
    pub nats: Arc<dyn NatsPublisher>,
    pub storage: Arc<dyn StorageClient>,
    pub http: Arc<dyn HttpClient>,
    pub resources: Arc<dyn ResourceClient>,
    pub settings: Arc<dyn SettingsClient>,
    pub schedule: Arc<dyn ScheduleClient>,
    pub actions: Arc<dyn ActionRunner>,
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
    /// The invocation's grants: the permissions the invoking module's
    /// manifest declares (see `crate::permissions`), plus the `origin:`
    /// grants of its `url` settings (see `crate::net`). Empty for builtin
    /// invocations.
    pub permissions: HashSet<String>,
    /// The ids of the module's `url` settings. Module code may not write
    /// them (`ctx.module.setSetting`): a value there grants `ctx.http` its
    /// origin, so only the streamer may set it.
    pub url_settings: HashSet<String>,
    /// When the caller stops waiting for the result. Host calls that wait on
    /// another service are bounded by it.
    pub deadline: Instant,
}

impl InvocationContext {
    /// The scope every host function bound into this invocation shares.
    pub fn call_scope(&self) -> CallScope {
        CallScope::new(self.permissions.clone(), self.deadline)
            .with_module_id(self.module_id.clone())
    }
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

#[cfg(test)]
mod setting_values_equal_tests {
    use super::setting_values_equal;
    use serde_json::json;

    #[test]
    fn numbers_compare_by_value() {
        assert!(setting_values_equal(&json!(1), &json!(1.0)));
        assert!(!setting_values_equal(&json!(1), &json!(2)));
    }

    #[test]
    fn objects_compare_regardless_of_key_order() {
        let a: serde_json::Value = serde_json::from_str(r#"{"a":1,"b":"x"}"#).unwrap();
        let b: serde_json::Value = serde_json::from_str(r#"{"b":"x","a":1}"#).unwrap();
        assert!(setting_values_equal(&a, &b));
        assert!(!setting_values_equal(&a, &json!({ "a": 1 })));
    }

    #[test]
    fn lists_compare_in_order() {
        assert!(setting_values_equal(&json!([{ "label": "A" }]), &json!([{ "label": "A" }])));
        assert!(!setting_values_equal(&json!(["A", "B"]), &json!(["B", "A"])));
    }

    #[test]
    fn an_empty_object_equals_an_empty_list_and_nothing_else_does() {
        assert!(setting_values_equal(&json!([]), &json!({})));
        assert!(!setting_values_equal(&json!(["A"]), &json!({})));
        assert!(!setting_values_equal(&json!([]), &json!(null)));
    }
}
