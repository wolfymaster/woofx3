// Adapts the compile-time REGISTRY into the `BuiltinDispatcher` trait the
// sandbox accepts. The sandbox crate can't see `BuiltinActionContext`
// directly (one-way dep: app → lib_sandbox), so we keep the bridge on the
// app side and hand the sandbox an `Arc<dyn BuiltinDispatcher>` at startup.

use super::{dispatch, BuiltinActionContext, Logger, MessageBusPublisher};
use lib_sandbox::builtin_dispatch::BuiltinDispatcher;
use serde_json::Value;
use std::sync::Arc;

pub struct BuiltinActionBridge {
    ctx: Arc<BuiltinActionContext>,
}

impl BuiltinActionBridge {
    pub fn new(
        message_bus: Arc<dyn MessageBusPublisher>,
        logger: Arc<dyn Logger>,
    ) -> Self {
        Self {
            ctx: Arc::new(BuiltinActionContext { message_bus, logger }),
        }
    }
}

impl BuiltinDispatcher for BuiltinActionBridge {
    fn invoke(&self, name: &str, params: Value) -> anyhow::Result<Option<Value>> {
        match dispatch(name, &self.ctx, params) {
            Some(Ok(value)) => Ok(Some(value)),
            Some(Err(err)) => Err(err),
            None => Ok(None),
        }
    }
}
