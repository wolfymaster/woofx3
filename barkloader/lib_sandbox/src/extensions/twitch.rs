use super::subject_extension::{CommandEntry, SubjectExtension};
use crate::host::{HostExtension, HostFunction, NatsPublisher};
use std::sync::Arc;

const SUBJECT: &str = "twitchapi";
const COMMANDS: &[CommandEntry] = &[
    ("clip", "clip", false),
    ("timeout", "timeout", true),
    ("updateStream", "updateStream", true),
    ("addModerator", "addChannelModerator", true),
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
