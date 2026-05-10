use crate::host::{HostExtension, HostFunction, NatsPublisher};
use serde_json::{json, Value};
use std::sync::Arc;

const SUBJECT: &str = "slobs";

pub struct PlatformAlertsExtension {
    functions: Vec<HostFunction>,
}

impl PlatformAlertsExtension {
    pub fn new(nats: Arc<dyn NatsPublisher>) -> Self {
        let functions = vec![
            command_fn("alert", "alert_message", nats.clone()),
            command_fn("setTimer", "setTime", nats.clone()),
        ];
        Self { functions }
    }
}

impl HostExtension for PlatformAlertsExtension {
    fn namespace(&self) -> &str {
        "platform.alerts"
    }

    fn functions(&self) -> &[HostFunction] {
        &self.functions
    }
}

fn command_fn(
    js_name: &'static str,
    wire_command: &'static str,
    nats: Arc<dyn NatsPublisher>,
) -> HostFunction {
    HostFunction::new(js_name, move |args: Value| {
        let payload = json!({ "command": wire_command, "args": args });
        nats.publish(SUBJECT, payload)?;
        Ok(Value::Null)
    })
}
