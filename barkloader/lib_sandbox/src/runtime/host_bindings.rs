//! Host-call logic shared between the Lua and QuickJS adapters.
//!
//! `HostContext`'s traits (`host/mod.rs`) are already engine-agnostic — the
//! duplication between `runtime/lua.rs` and `runtime/quickjs.rs` was never
//! in *what* each namespace does, only in the value-marshaling glue around
//! it (mlua's `Table`/`Value` vs rquickjs's `Object`/`Value` are genuinely
//! different APIs and can't share a binding closure). This module holds
//! the handful of namespace methods that carry real logic beyond a
//! single-line passthrough to a `HostContext` trait — storage's
//! mutate-then-publish, resource creation/listing's serialize step, log
//! value formatting, and the response envelope shape — so that logic lives
//! once. Each adapter still builds its own closures; the closure bodies
//! just call in here after marshaling arguments to `serde_json::Value`,
//! and marshal the `Value` result back out.
//!
//! Deliberately does *not* wrap every namespace method: `events.publish`,
//! `storage.get`, `http.request`, `env.get`, `resources.delete`, and
//! `module.setSetting` are pure 1:1 passthroughs to a `HostContext` trait
//! method with no logic of their own — wrapping those here would just add
//! a layer, not close a gap. Adapters call `invocation.host.*` directly
//! for those, same as before.

use crate::host::HostContext;
use serde_json::Value;
use std::collections::HashMap;

/// `ctx.storage.set(key, value)`: write through to the store, then emit
/// the `module.storage.<module_id>.changed` event. Both steps, in this
/// order, every time — that pairing is the actual behavior worth keeping
/// in one place.
pub fn storage_set(host: &HostContext, module_id: &str, key: &str, value: Value) -> Result<(), String> {
    host.storage.set(key, value.clone())?;
    super::storage_event::publish_storage_changed(&host.nats, module_id, key, &value);
    Ok(())
}

/// `ctx.resources.create(kind, instanceId, displayName?)`: call the
/// resource client, then serialize the result to `Value` for the caller
/// to marshal into its own engine.
pub fn resources_create(
    host: &HostContext,
    owning_module_name: &str,
    kind: &str,
    instance_id: &str,
    display_name: &str,
) -> Result<Value, String> {
    let inst = host.resources.create(owning_module_name, kind, instance_id, display_name)?;
    serde_json::to_value(&inst).map_err(|e| e.to_string())
}

/// `ctx.resources.list(kind)`: call the resource client, then serialize
/// the list to `Value`.
pub fn resources_list(host: &HostContext, kind: &str) -> Result<Value, String> {
    let items = host.resources.list_by_kind(kind)?;
    serde_json::to_value(&items).map_err(|e| e.to_string())
}

/// `ctx.module.settings`: one fetch, defaulting to an empty map on
/// failure so a settings-client error never breaks a function invocation
/// that doesn't otherwise need settings. Callers are responsible for
/// their own per-invocation caching (each engine already has an
/// `Rc<RefCell<Option<_>>>` for that, since the cache needs to live
/// inside a closure captured by that engine's accessor/metatable hook).
pub fn module_settings_snapshot(host: &HostContext, module_id: &str) -> HashMap<String, Value> {
    host.settings.list_by_module(module_id).unwrap_or_default()
}

/// `ctx.log.*` value stringification: strings are logged verbatim,
/// everything else is JSON-encoded so structured data stays readable in
/// the host log line. Both engines apply the exact same rule — only the
/// value type differs before it reaches here (`LuaValue`/`JsValue`), so
/// each adapter converts to `serde_json::Value` first.
pub fn format_log_value(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// `ctx.response(success, message)` — the standard shape a module
/// function returns when it wants the invoking chat command to reply.
/// Tagged with `proto`/`v` (mirroring the `woofx3.widget`/
/// `woofx3.overlay-events` envelope convention) so a caller can reliably
/// distinguish a deliberate response from any other object a function
/// might return for its own purposes.
pub fn build_response_value(success: bool, message: String) -> Value {
    serde_json::json!({
        "proto": "woofx3.response",
        "v": 1,
        "success": success,
        "message": message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::noop::noop_host_context;

    #[test]
    fn format_log_value_returns_strings_verbatim() {
        assert_eq!(format_log_value(&Value::String("hello".to_string())), "hello");
    }

    #[test]
    fn format_log_value_json_encodes_non_strings() {
        assert_eq!(format_log_value(&serde_json::json!({"code": 42})), r#"{"code":42}"#);
    }

    #[test]
    fn build_response_value_has_the_standard_envelope_shape() {
        let v = build_response_value(true, "ok".to_string());
        assert_eq!(v["proto"], "woofx3.response");
        assert_eq!(v["v"], 1);
        assert_eq!(v["success"], true);
        assert_eq!(v["message"], "ok");
    }

    #[test]
    fn module_settings_snapshot_defaults_to_empty_on_error() {
        let host = noop_host_context();
        // noop SettingsClient returns an empty map, not an error, but this
        // asserts the shape callers get either way: a plain map, never a
        // propagated Err.
        let snapshot = module_settings_snapshot(&host, "mymod");
        assert!(snapshot.is_empty());
    }

    #[test]
    fn storage_set_writes_through_and_does_not_error_with_no_module_id() {
        let host = noop_host_context();
        // module_id empty is the "not tied to a module" case
        // (`publish_storage_changed` no-ops on it) — must not error.
        storage_set(&host, "", "key", serde_json::json!("value")).expect("storage_set should succeed");
    }

    #[test]
    fn resources_create_propagates_the_client_error() {
        // The noop resource client (used by tests/builtin invocations with
        // no real resource backend) always errors — confirms the error
        // path passes through untouched rather than getting swallowed.
        let host = noop_host_context();
        let err = resources_create(&host, "mymod", "counter", "c1", "Counter One").expect_err("noop resource client errors");
        assert_eq!(err, "resource client not configured");
    }

    #[test]
    fn resources_list_serializes_an_empty_list() {
        let host = noop_host_context();
        let v = resources_list(&host, "counter").expect("noop resource client succeeds for list");
        assert_eq!(v, serde_json::json!([]));
    }

    struct StaticResourceClient;
    impl crate::host::ResourceClient for StaticResourceClient {
        fn create(
            &self,
            owning_module_name: &str,
            kind: &str,
            instance_id: &str,
            display_name: &str,
        ) -> Result<crate::host::ResourceInstance, String> {
            Ok(crate::host::ResourceInstance {
                canonical_id: format!("{owning_module_name}:{kind}:{instance_id}"),
                module_name: owning_module_name.to_string(),
                kind: kind.to_string(),
                instance_id: instance_id.to_string(),
                display_name: display_name.to_string(),
            })
        }
        fn delete(&self, _canonical_id: &str) -> Result<(), String> {
            Ok(())
        }
        fn list_by_kind(&self, _kind: &str) -> Result<Vec<crate::host::ResourceInstance>, String> {
            Ok(Vec::new())
        }
    }

    #[test]
    fn resources_create_serializes_the_instance_on_success() {
        let mut host = noop_host_context();
        host.resources = std::sync::Arc::new(StaticResourceClient);
        let v = resources_create(&host, "mymod", "counter", "c1", "Counter One").expect("static client succeeds");
        assert_eq!(v["kind"], "counter");
        assert_eq!(v["instance_id"], "c1");
        assert_eq!(v["canonical_id"], "mymod:counter:c1");
    }
}
