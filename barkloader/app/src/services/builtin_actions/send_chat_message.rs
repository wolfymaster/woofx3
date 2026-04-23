use super::{BuiltinAction, BuiltinActionContext};
use serde_json::{json, Value};

pub const ACTION: BuiltinAction = BuiltinAction {
    name: "send_chat_message",
    description: "Publish a chat message to the primary chat bus subject. \
Platform-agnostic; downstream clients bridge to Twitch / Discord / etc.",
    params_schema: r#"[
      {"id":"message","label":"Message","type":"text","required":true},
      {"id":"reply_to","label":"Reply to message ID","type":"text","required":false}
    ]"#,
    handler: handle,
};

fn handle(ctx: &BuiltinActionContext, params: Value) -> anyhow::Result<Value> {
    let message = params.get("message").and_then(|v| v.as_str()).ok_or_else(|| {
        anyhow::anyhow!("send_chat_message: required param `message` missing or not a string")
    })?;
    let reply_to = params.get("reply_to").and_then(|v| v.as_str());

    // Subject matches SubjectChatSend = "message.send" in the Go cloudevents
    // constants; downstream clients (e.g. streamlabs chat bridge) subscribe
    // to it.
    ctx.message_bus.publish(
        "message.send",
        json!({ "message": message, "reply_to": reply_to }),
    )?;
    Ok(json!({ "published": true }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{Logger, MessageBusPublisher};
    use std::sync::{Arc, Mutex};

    struct MockBus(Mutex<Vec<(String, Value)>>);
    impl MessageBusPublisher for MockBus {
        fn publish(&self, subject: &str, payload: Value) -> anyhow::Result<()> {
            self.0.lock().unwrap().push((subject.to_string(), payload));
            Ok(())
        }
    }

    struct NoopLogger;
    impl Logger for NoopLogger {
        fn info(&self, _: &str) {}
        fn warn(&self, _: &str) {}
        fn error(&self, _: &str) {}
    }

    #[test]
    fn publishes_expected_subject_and_payload() {
        let bus: Arc<MockBus> = Arc::new(MockBus(Mutex::new(vec![])));
        let ctx = BuiltinActionContext {
            message_bus: bus.clone(),
            logger: Arc::new(NoopLogger),
        };
        let result = handle(&ctx, json!({ "message": "hi", "reply_to": "m-42" })).unwrap();
        assert_eq!(result, json!({ "published": true }));
        let calls = bus.0.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "message.send");
        assert_eq!(calls[0].1, json!({ "message": "hi", "reply_to": "m-42" }));
    }

    #[test]
    fn rejects_missing_message_param() {
        let bus = Arc::new(MockBus(Mutex::new(vec![])));
        let ctx = BuiltinActionContext {
            message_bus: bus,
            logger: Arc::new(NoopLogger),
        };
        let err = handle(&ctx, json!({ "reply_to": "m-42" })).unwrap_err();
        assert!(err.to_string().contains("message"));
    }
}
