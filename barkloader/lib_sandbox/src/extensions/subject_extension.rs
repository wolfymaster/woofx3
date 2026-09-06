//! Shared implementation for extensions that are, structurally, just a
//! NATS subject plus a lookup table of `(js_name, wire_command)` pairs —
//! `twitch`, `platform.alerts`, and `platform.chat` today. Each of those
//! namespaces' every function does exactly the same thing (publish
//! `{ command: wire_command, args? }` to one fixed subject), so the
//! behavior lives once here; each namespace file becomes a name plus a
//! data table.
//!
//! `chat` is deliberately not built on this: it calls a different host
//! trait (`ChatSender`, not `NatsPublisher`) and has real per-call logic
//! (extracting/validating a string argument) — a lookup table would not
//! fit it.

use crate::host::{HostExtension, HostFunction, NatsPublisher};
use serde_json::{json, Value};
use std::sync::Arc;

/// One entry in a subject extension's command table:
/// `(js_name, wire_command, takes_args)`. `takes_args = false` omits the
/// `args` key from the published payload entirely, rather than sending
/// `args: null` — `twitch.clip` is the one command today that needs this.
pub type CommandEntry = (&'static str, &'static str, bool);

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
            .map(|&(js_name, wire_command, takes_args)| {
                let nats = nats.clone();
                HostFunction::new(js_name, move |args: Value| {
                    let payload = if takes_args {
                        json!({ "command": wire_command, "args": args })
                    } else {
                        json!({ "command": wire_command })
                    };
                    nats.publish(subject, payload)?;
                    Ok(Value::Null)
                })
            })
            .collect();
        Self { namespace, functions }
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
            self.published.lock().unwrap().push((subject.to_string(), data));
            Ok(())
        }
    }

    #[test]
    fn omits_args_key_when_takes_args_is_false() {
        let nats = Arc::new(CapturingNats { published: Mutex::new(Vec::new()) });
        let ext = SubjectExtension::new("x", "subj", &[("noArgs", "no_args_cmd", false)], nats.clone());
        (ext.functions()[0].handler)(serde_json::json!({"ignored": true})).unwrap();
        let published = nats.published.lock().unwrap();
        assert_eq!(published[0], ("subj".to_string(), json!({ "command": "no_args_cmd" })));
    }

    #[test]
    fn includes_args_key_when_takes_args_is_true() {
        let nats = Arc::new(CapturingNats { published: Mutex::new(Vec::new()) });
        let ext = SubjectExtension::new("x", "subj", &[("withArgs", "with_args_cmd", true)], nats.clone());
        (ext.functions()[0].handler)(json!({"n": 1})).unwrap();
        let published = nats.published.lock().unwrap();
        assert_eq!(published[0], ("subj".to_string(), json!({ "command": "with_args_cmd", "args": {"n": 1} })));
    }

    #[test]
    fn namespace_and_function_names_are_exposed() {
        let nats = Arc::new(CapturingNats { published: Mutex::new(Vec::new()) });
        let ext = SubjectExtension::new("my.ns", "subj", &[("a", "cmd_a", true), ("b", "cmd_b", false)], nats);
        assert_eq!(ext.namespace(), "my.ns");
        assert_eq!(ext.functions().len(), 2);
        assert_eq!(ext.functions()[0].name, "a");
        assert_eq!(ext.functions()[1].name, "b");
    }
}
