// Built-in actions are compiled-in native Rust handlers registered alongside
// module-provided actions at barkloader startup. The workflow engine dispatches
// them uniformly via the same RPC path as module actions; only the sandbox
// invoke path branches on the `builtin:<name>` call prefix (see Phase D3).

pub mod autoload;
mod log;
mod send_chat_message;

use serde_json::Value;
use std::sync::Arc;

/// Injected at dispatch time so native actions can publish events, log, etc.
/// Minimal on purpose — adding fields forces every action to care, which
/// defeats the composition benefit of this registry.
pub struct BuiltinActionContext {
    pub message_bus: Arc<dyn MessageBusPublisher>,
    pub logger: Arc<dyn Logger>,
}

pub trait MessageBusPublisher: Send + Sync {
    fn publish(&self, subject: &str, payload: Value) -> anyhow::Result<()>;
}

pub trait Logger: Send + Sync {
    fn info(&self, msg: &str);
    fn warn(&self, msg: &str);
    fn error(&self, msg: &str);
}

pub type BuiltinActionFn =
    fn(ctx: &BuiltinActionContext, params: Value) -> anyhow::Result<Value>;

pub struct BuiltinAction {
    pub name: &'static str,
    pub description: &'static str,
    pub params_schema: &'static str, // JSON-encoded ConfigField[]
    pub handler: BuiltinActionFn,
}

pub const REGISTRY: &[BuiltinAction] = &[
    send_chat_message::ACTION,
    log::ACTION,
];

/// Look up a built-in by name and invoke it. Returns None if the name isn't
/// registered (caller should treat that as "not a builtin" and fall through
/// to the sandbox path).
pub fn dispatch(
    name: &str,
    ctx: &BuiltinActionContext,
    params: Value,
) -> Option<anyhow::Result<Value>> {
    REGISTRY
        .iter()
        .find(|a| a.name == name)
        .map(|a| (a.handler)(ctx, params))
}
