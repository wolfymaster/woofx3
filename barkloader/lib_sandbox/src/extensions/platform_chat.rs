use crate::host::{HostExtension, HostFunction, NatsPublisher};
use serde_json::{json, Value};
use std::sync::Arc;

const SUBJECT: &str = "woofwoofwoof";

pub struct PlatformChatExtension {
    functions: Vec<HostFunction>,
}

impl PlatformChatExtension {
    pub fn new(nats: Arc<dyn NatsPublisher>) -> Self {
        let functions = vec![HostFunction::new("register", move |args: Value| {
            let payload = json!({ "command": "register", "args": args });
            nats.publish(SUBJECT, payload)?;
            Ok(Value::Null)
        })];
        Self { functions }
    }
}

impl HostExtension for PlatformChatExtension {
    fn namespace(&self) -> &str {
        "platform.chat"
    }

    fn functions(&self) -> &[HostFunction] {
        &self.functions
    }
}
