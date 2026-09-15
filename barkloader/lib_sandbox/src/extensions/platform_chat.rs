use super::subject_extension::{CommandEntry, SubjectExtension};
use crate::host::{HostExtension, HostFunction, NatsPublisher};
use std::sync::Arc;

const SUBJECT: &str = "woofwoofwoof";
const COMMANDS: &[CommandEntry] = &[("register", "register", true)];

pub struct PlatformChatExtension(SubjectExtension);

impl PlatformChatExtension {
    pub fn new(nats: Arc<dyn NatsPublisher>) -> Self {
        Self(SubjectExtension::new(
            "platform.chat",
            SUBJECT,
            COMMANDS,
            nats,
        ))
    }
}

impl HostExtension for PlatformChatExtension {
    fn namespace(&self) -> &str {
        self.0.namespace()
    }

    fn functions(&self) -> &[HostFunction] {
        self.0.functions()
    }
}
