use lib_sandbox::host::{ChatSender, NatsPublisher};
use std::sync::Arc;
use woofx3_cloudevents::BaseEvent;

const SUBJECT_CHAT_SEND: &str = "message.send";
const SOURCE: &str = "barkloader";

pub struct BusChatSender {
    nats: Arc<dyn NatsPublisher>,
    platform: String,
}

impl BusChatSender {
    pub fn new(nats: Arc<dyn NatsPublisher>, platform: impl Into<String>) -> Self {
        Self {
            nats,
            platform: platform.into(),
        }
    }
}

impl ChatSender for BusChatSender {
    fn send_message(&self, text: &str) -> Result<(), String> {
        // `platform` names where the message is being sent, not where the
        // event came from, so it belongs in `data` rather than the envelope's
        // provenance attribute.
        let event = BaseEvent::new(
            SUBJECT_CHAT_SEND,
            SOURCE,
            serde_json::json!({ "platform": self.platform, "message": text }),
        );
        let envelope = event.to_value().map_err(|err| err.to_string())?;
        self.nats.publish(SUBJECT_CHAT_SEND, envelope)
    }
}
