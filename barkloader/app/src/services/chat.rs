use lib_sandbox::host::{ChatSender, NatsPublisher};
use std::sync::Arc;

const SUBJECT_CHAT_SEND: &str = "message.send";

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
        let envelope = serde_json::json!({
            "specversion": "1.0.0",
            "type":        SUBJECT_CHAT_SEND,
            "source":      "barkloader",
            "id":          uuid::Uuid::new_v4().to_string(),
            "time":        chrono::Utc::now().to_rfc3339(),
            "data":        { "platform": self.platform, "message": text },
        });
        self.nats.publish(SUBJECT_CHAT_SEND, envelope)
    }
}
