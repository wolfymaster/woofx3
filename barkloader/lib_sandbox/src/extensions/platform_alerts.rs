use super::subject_extension::{CommandEntry, SubjectExtension};
use crate::host::{HostExtension, HostFunction, NatsPublisher};
use std::sync::Arc;

const SUBJECT: &str = "slobs";
const COMMANDS: &[CommandEntry] = &[
    ("alert", "alert_message", true),
    ("setTimer", "setTime", true),
];

pub struct PlatformAlertsExtension(SubjectExtension);

impl PlatformAlertsExtension {
    pub fn new(nats: Arc<dyn NatsPublisher>) -> Self {
        Self(SubjectExtension::new("platform.alerts", SUBJECT, COMMANDS, nats))
    }
}

impl HostExtension for PlatformAlertsExtension {
    fn namespace(&self) -> &str {
        self.0.namespace()
    }

    fn functions(&self) -> &[HostFunction] {
        self.0.functions()
    }
}
