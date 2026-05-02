use super::{BuiltinAction, BuiltinActionContext};
use serde_json::{json, Value};

pub const ACTION: BuiltinAction = BuiltinAction {
    name: "log",
    description: "Write a log line at the specified level. Useful for debugging workflows.",
    params_schema: r#"[
      {"id":"level","label":"Level","type":"select","required":true,
       "options":[
         {"value":"info","label":"Info"},
         {"value":"warn","label":"Warn"},
         {"value":"error","label":"Error"}
       ],
       "defaultValue":"info",
       "description":"Severity routes to the matching server log channel."},
      {"id":"message","label":"Message","type":"text","required":true,
       "description":"Plain text written verbatim to the log line.",
       "hint":"Useful for confirming a workflow branch was reached during testing."}
    ]"#,
    handler: handle,
};

fn handle(ctx: &BuiltinActionContext, params: Value) -> anyhow::Result<Value> {
    let level = params.get("level").and_then(|v| v.as_str()).unwrap_or("info");
    let message = params.get("message").and_then(|v| v.as_str()).ok_or_else(|| {
        anyhow::anyhow!("log: required param `message` missing or not a string")
    })?;
    match level {
        "warn" => ctx.logger.warn(message),
        "error" => ctx.logger.error(message),
        _ => ctx.logger.info(message),
    }
    Ok(json!({ "logged": true }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{Logger, MessageBusPublisher};
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct SpyLogger {
        info: Mutex<Vec<String>>,
        warn: Mutex<Vec<String>>,
        error: Mutex<Vec<String>>,
    }
    impl Logger for SpyLogger {
        fn info(&self, msg: &str) { self.info.lock().unwrap().push(msg.to_string()); }
        fn warn(&self, msg: &str) { self.warn.lock().unwrap().push(msg.to_string()); }
        fn error(&self, msg: &str) { self.error.lock().unwrap().push(msg.to_string()); }
    }

    struct StubBus;
    impl MessageBusPublisher for StubBus {
        fn publish(&self, _: &str, _: Value) -> anyhow::Result<()> { Ok(()) }
    }

    fn ctx(logger: Arc<SpyLogger>) -> BuiltinActionContext {
        BuiltinActionContext {
            message_bus: Arc::new(StubBus),
            logger,
        }
    }

    #[test]
    fn routes_level_correctly() {
        let logger = Arc::new(SpyLogger::default());
        handle(&ctx(logger.clone()), json!({ "level": "warn", "message": "oops" })).unwrap();
        assert_eq!(logger.warn.lock().unwrap().as_slice(), &["oops"]);
        assert!(logger.info.lock().unwrap().is_empty());
        assert!(logger.error.lock().unwrap().is_empty());
    }

    #[test]
    fn defaults_to_info_when_level_missing() {
        let logger = Arc::new(SpyLogger::default());
        handle(&ctx(logger.clone()), json!({ "message": "plain" })).unwrap();
        assert_eq!(logger.info.lock().unwrap().as_slice(), &["plain"]);
    }

    #[test]
    fn rejects_missing_message() {
        let logger = Arc::new(SpyLogger::default());
        let err = handle(&ctx(logger), json!({ "level": "info" })).unwrap_err();
        assert!(err.to_string().contains("message"));
    }
}
