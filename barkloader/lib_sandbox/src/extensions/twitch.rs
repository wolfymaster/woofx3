use crate::host::{HostExtension, HostFunction, NatsPublisher};
use serde_json::{json, Value};
use std::sync::Arc;

const SUBJECT: &str = "twitchapi";

pub struct TwitchExtension {
    functions: Vec<HostFunction>,
}

impl TwitchExtension {
    pub fn new(nats: Arc<dyn NatsPublisher>) -> Self {
        let functions = vec![
            command_fn("clip", "clip", nats.clone(), false),
            command_fn("timeout", "timeout", nats.clone(), true),
            command_fn("updateStream", "updateStream", nats.clone(), true),
            command_fn("addModerator", "addChannelModerator", nats.clone(), true),
        ];
        Self { functions }
    }
}

impl HostExtension for TwitchExtension {
    fn namespace(&self) -> &str {
        "twitch"
    }

    fn functions(&self) -> &[HostFunction] {
        &self.functions
    }
}

fn command_fn(
    js_name: &'static str,
    wire_command: &'static str,
    nats: Arc<dyn NatsPublisher>,
    takes_args: bool,
) -> HostFunction {
    HostFunction::new(js_name, move |args: Value| {
        let payload = if takes_args {
            json!({ "command": wire_command, "args": args })
        } else {
            json!({ "command": wire_command })
        };
        nats.publish(SUBJECT, payload)?;
        Ok(Value::Null)
    })
}
