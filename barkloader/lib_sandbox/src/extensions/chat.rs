use crate::host::{ChatSender, HostExtension, HostFunction};
use serde_json::Value;
use std::sync::Arc;

pub struct ChatExtension {
    functions: Vec<HostFunction>,
}

impl ChatExtension {
    pub fn new(sender: Arc<dyn ChatSender>) -> Self {
        let functions = vec![HostFunction::new("sendMessage", move |args: Value| {
            let text = match args {
                Value::String(s) => s,
                Value::Null => {
                    return Err("chat.sendMessage requires a string argument".to_string());
                }
                other => other.to_string(),
            };
            sender.send_message(&text)?;
            Ok(Value::Null)
        })];
        Self { functions }
    }
}

impl HostExtension for ChatExtension {
    fn namespace(&self) -> &str {
        "chat"
    }

    fn functions(&self) -> &[HostFunction] {
        &self.functions
    }
}
