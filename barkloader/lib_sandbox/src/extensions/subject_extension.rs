//! Shared implementation for extensions that are, structurally, just a
//! NATS subject plus a lookup table of `(js_name, wire_command)` pairs:
//! `platform.alerts` and `platform.chat`. Each of those namespaces' every
//! function does exactly the same thing (publish `{ command: wire_command,
//! args }` to one fixed subject and return nothing), so the behavior lives
//! once here; each namespace file becomes a name plus a data table.
//!
//! `chat` and `twitch` are deliberately not built on this: `chat` calls a
//! different host trait (`ChatSender`) with its own argument checks, and
//! `twitch` waits for the twitch service's reply and gates some commands on
//! a manifest permission.

use crate::host::{HostExtension, HostFunction, NatsPublisher};
use serde_json::{Value, json};
use std::sync::Arc;

/// One entry in a subject extension's command table: `(js_name, wire_command)`.
pub type CommandEntry = (&'static str, &'static str);

pub struct SubjectExtension {
    namespace: &'static str,
    functions: Vec<HostFunction>,
}

impl SubjectExtension {
    pub fn new(
        namespace: &'static str,
        subject: &'static str,
        commands: &[CommandEntry],
        nats: Arc<dyn NatsPublisher>,
    ) -> Self {
        let functions = commands
            .iter()
            .map(|&(js_name, wire_command)| {
                let nats = nats.clone();
                HostFunction::new(js_name, move |args: Value| {
                    let payload = json!({ "command": wire_command, "args": args });
                    nats.publish(subject, payload)?;
                    Ok(Value::Null)
                })
            })
            .collect();
        Self {
            namespace,
            functions,
        }
    }
}

impl HostExtension for SubjectExtension {
    fn namespace(&self) -> &str {
        self.namespace
    }

    fn functions(&self) -> &[HostFunction] {
        &self.functions
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct CapturingNats {
        published: Mutex<Vec<(String, Value)>>,
    }

    impl NatsPublisher for CapturingNats {
        fn publish(&self, subject: &str, data: Value) -> Result<(), String> {
            self.published
                .lock()
                .unwrap()
                .push((subject.to_string(), data));
            Ok(())
        }
    }

    #[test]
    fn publishes_the_wire_command_with_the_args() {
        let nats = Arc::new(CapturingNats {
            published: Mutex::new(Vec::new()),
        });
        let ext =
            SubjectExtension::new("x", "subj", &[("withArgs", "with_args_cmd")], nats.clone());
        (ext.functions()[0].handler)(json!({"n": 1})).unwrap();
        let published = nats.published.lock().unwrap();
        assert_eq!(
            published[0],
            (
                "subj".to_string(),
                json!({ "command": "with_args_cmd", "args": {"n": 1} })
            )
        );
    }

    #[test]
    fn namespace_and_function_names_are_exposed() {
        let nats = Arc::new(CapturingNats {
            published: Mutex::new(Vec::new()),
        });
        let ext = SubjectExtension::new("my.ns", "subj", &[("a", "cmd_a"), ("b", "cmd_b")], nats);
        assert_eq!(ext.namespace(), "my.ns");
        assert_eq!(ext.functions().len(), 2);
        assert_eq!(ext.functions()[0].name, "a");
        assert_eq!(ext.functions()[1].name, "b");
    }
}
