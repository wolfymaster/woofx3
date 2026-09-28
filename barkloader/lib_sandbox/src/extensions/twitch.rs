use super::subject_extension::{CommandEntry, SubjectExtension};
use crate::host::{HostExtension, HostFunction, NatsPublisher};
use std::sync::Arc;

const SUBJECT: &str = "twitchapi";
const COMMANDS: &[CommandEntry] = &[
    ("clip", "clip", false),
    ("timeout", "timeout", true),
    ("updateStream", "updateStream", true),
    ("addModerator", "addChannelModerator", true),
    ("shoutout", "shoutout", true),
    ("createMarker", "createMarker", true),
];

pub struct TwitchExtension(SubjectExtension);

impl TwitchExtension {
    pub fn new(nats: Arc<dyn NatsPublisher>) -> Self {
        Self(SubjectExtension::new("twitch", SUBJECT, COMMANDS, nats))
    }
}

impl HostExtension for TwitchExtension {
    fn namespace(&self) -> &str {
        self.0.namespace()
    }

    fn functions(&self) -> &[HostFunction] {
        self.0.functions()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use std::sync::Mutex;

    #[derive(Default)]
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

    // The wire command is the twitch service's method name; a mismatch
    // there is answered with "Unknown command" and nothing happens.
    #[test]
    fn each_function_publishes_the_twitch_service_method_it_names() {
        let nats = Arc::new(CapturingNats::default());
        let ext = TwitchExtension::new(nats.clone());
        let names: Vec<&str> = ext.functions().iter().map(|f| f.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "clip",
                "timeout",
                "updateStream",
                "addModerator",
                "shoutout",
                "createMarker"
            ]
        );

        let marker = ext
            .functions()
            .iter()
            .find(|f| f.name == "createMarker")
            .unwrap();
        (marker.handler)(json!({ "description": "clutch" })).unwrap();
        let published = nats.published.lock().unwrap();
        assert_eq!(
            published[0],
            (
                SUBJECT.to_string(),
                json!({ "command": "createMarker", "args": { "description": "clutch" } })
            )
        );
    }
}
