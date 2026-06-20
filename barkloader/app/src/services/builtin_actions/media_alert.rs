use super::{BuiltinAction, BuiltinActionContext};
use chrono::Utc;
use serde_json::{json, Value};
use uuid::Uuid;

pub const ACTION: BuiltinAction = BuiltinAction {
    name: "media_alert",
    description: "Publish a media alert to connected overlay clients. The overlay's \
media_alert widget renders the configured text, image/video, and audio \
for the given duration, then reports completion.",
    params_schema: r#"[
      {"id":"textTemplate","label":"Alert text","type":"text","required":false,
       "description":"Supports {path.to.value} substitution from the trigger event data.",
       "hint":"Example: \"{username} just followed!\""},
      {"id":"mediaUrlTemplate","label":"Media URL","type":"text","required":false,
       "description":"URL of an image (jpg/png/gif/webp) or video (mp4/webm/mov) to display.",
       "hint":"Supports {path.to.value} substitution. Leave blank for text-only alerts."},
      {"id":"audioUrlTemplate","label":"Audio URL","type":"text","required":false,
       "description":"URL of an audio file to play alongside the media.",
       "hint":"When set and duration is blank, the alert lasts until the audio ends."},
      {"id":"duration","label":"Duration (seconds)","type":"number","required":false,
       "description":"How long to display the alert. Omit to use audio length or the widget default (5 s)."}
    ]"#,
    handler: handle,
};

fn handle(ctx: &BuiltinActionContext, params: Value, event: Value) -> anyhow::Result<Value> {
    let application_id = event
        .get("applicationId")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("media_alert: event.applicationId is required and must be a non-empty string"))?;

    let event_type = event
        .get("type")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("media_alert: event.type is required and must be a non-empty string"))?;

    let source = event.get("source").and_then(|v| v.as_str()).unwrap_or("");
    let time = event
        .get("time")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let time = if time.is_empty() {
        Utc::now().to_rfc3339()
    } else {
        time
    };
    let data = event.get("data").cloned().unwrap_or(Value::Null);

    // Build parameters object — only include keys that were actually provided.
    let mut parameters = serde_json::Map::new();
    if let Some(v) = params.get("textTemplate") {
        parameters.insert("textTemplate".to_string(), v.clone());
    }
    if let Some(v) = params.get("mediaUrlTemplate") {
        parameters.insert("mediaUrlTemplate".to_string(), v.clone());
    }
    if let Some(v) = params.get("audioUrlTemplate") {
        parameters.insert("audioUrlTemplate".to_string(), v.clone());
    }
    if let Some(v) = params.get("duration") {
        parameters.insert("duration".to_string(), v.clone());
    }

    let envelope = json!({
        "id": Uuid::new_v4().to_string(),
        "applicationId": application_id,
        "event": {
            "type": event_type,
            "source": source,
            "time": time,
            "data": data,
        },
        "parameters": Value::Object(parameters),
    });

    ctx.message_bus.publish("ui.notify.alert", envelope)?;

    ctx.logger.info(&format!(
        "media_alert: published ui.notify.alert for applicationId={} eventType={}",
        application_id, event_type
    ));

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

    fn make_ctx() -> (Arc<MockBus>, BuiltinActionContext) {
        let bus = Arc::new(MockBus(Mutex::new(vec![])));
        let ctx = BuiltinActionContext {
            message_bus: bus.clone(),
            logger: Arc::new(NoopLogger),
        };
        (bus, ctx)
    }

    fn follow_event(app_id: &str) -> Value {
        json!({
            "applicationId": app_id,
            "type": "builtin:trigger:follow.user.twitch",
            "source": "twitch",
            "time": "2026-06-20T00:00:00Z",
            "data": { "username": "coolguy" }
        })
    }

    #[test]
    fn publishes_to_ui_notify_alert_subject() {
        let (bus, ctx) = make_ctx();
        handle(
            &ctx,
            json!({ "mediaUrlTemplate": "https://example.com/follow.gif", "duration": 5 }),
            follow_event("app-123"),
        )
        .unwrap();
        let calls = bus.0.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "ui.notify.alert");
    }

    #[test]
    fn envelope_contains_required_fields() {
        let (bus, ctx) = make_ctx();
        handle(
            &ctx,
            json!({ "textTemplate": "{username} followed!", "duration": 7 }),
            follow_event("app-xyz"),
        )
        .unwrap();
        let calls = bus.0.lock().unwrap();
        let envelope = &calls[0].1;
        // Top-level required fields
        assert!(envelope["id"].is_string(), "id must be a string");
        assert!(!envelope["id"].as_str().unwrap().is_empty(), "id must be non-empty");
        assert_eq!(envelope["applicationId"], "app-xyz");
        // Embedded event
        assert_eq!(envelope["event"]["type"], "builtin:trigger:follow.user.twitch");
        assert_eq!(envelope["event"]["source"], "twitch");
        assert!(envelope["event"]["time"].is_string());
        assert_eq!(envelope["event"]["data"]["username"], "coolguy");
        // Parameters
        assert_eq!(envelope["parameters"]["textTemplate"], "{username} followed!");
        assert_eq!(envelope["parameters"]["duration"], 7);
    }

    #[test]
    fn optional_params_are_omitted_when_not_provided() {
        let (bus, ctx) = make_ctx();
        handle(&ctx, json!({}), follow_event("app-1")).unwrap();
        let calls = bus.0.lock().unwrap();
        let params = &calls[0].1["parameters"];
        assert!(params["textTemplate"].is_null() || !params.get("textTemplate").is_some_and(|v| v.is_string()),
            "textTemplate should be absent or null when not provided");
    }

    #[test]
    fn rejects_missing_application_id() {
        let (_, ctx) = make_ctx();
        let event = json!({
            "type": "builtin:trigger:follow.user.twitch",
            "source": "twitch",
            "time": "2026-06-20T00:00:00Z",
            "data": {}
        });
        let err = handle(&ctx, json!({}), event).unwrap_err();
        assert!(
            err.to_string().contains("applicationId"),
            "error must mention applicationId, got: {}",
            err
        );
    }

    #[test]
    fn rejects_missing_event_type() {
        let (_, ctx) = make_ctx();
        let event = json!({
            "applicationId": "app-1",
            "source": "twitch",
            "time": "2026-06-20T00:00:00Z",
            "data": {}
        });
        let err = handle(&ctx, json!({}), event).unwrap_err();
        assert!(
            err.to_string().contains("type"),
            "error must mention type, got: {}",
            err
        );
    }

    #[test]
    fn handler_returns_published_true() {
        let (_, ctx) = make_ctx();
        let result = handle(&ctx, json!({}), follow_event("app-1")).unwrap();
        assert_eq!(result, json!({ "published": true }));
    }
}
