use serde_json::Value;

/// App-level bridge for native action dispatch. `lib_sandbox` can't see
/// `barkloader::services::builtin_actions` directly (one-way dep: app →
/// lib_sandbox, not the reverse), so the app injects an object implementing
/// this trait at sandbox construction.
pub trait BuiltinDispatcher: Send + Sync {
    /// Invoke the named builtin. Returns Ok(Some(result)) on success,
    /// Ok(None) if the name is unknown, Err(e) on handler failure.
    /// `event` is the trigger event from the InvokeRequest (carries
    /// applicationId, type, source, time, data).
    fn invoke(&self, name: &str, params: Value, event: Value) -> anyhow::Result<Option<Value>>;
}
