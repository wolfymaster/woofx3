//! Auto-emitted notification fired when a module function calls
//! `ctx.storage.set()`. Both the QuickJS and Lua runtimes invoke
//! `publish_storage_changed` from inside the storage namespace's `set`
//! binding so module authors get reactive widgets for free.
//!
//! The CloudEvent type is documented in
//! `shared/common/golang/cloudevents/subjects.go` and consumed by
//! `api/src/storage-change-emitter.ts`.

use crate::host::NatsPublisher;
use serde_json::Value;
use std::sync::Arc;
use woofx3_cloudevents::{BaseEvent, now_iso8601};

const EVENT_TYPE: &str = "module.storage.changed";
const SOURCE: &str = "barkloader";

/// Best-effort fire of `module.storage.<module_id>.changed`. Failures
/// are logged and swallowed: the storage write is the source of truth
/// and a missed notification must never roll back a persisted value or
/// fail the module function.
pub fn publish_storage_changed(
    nats: &Arc<dyn NatsPublisher>,
    module_id: &str,
    key: &str,
    value: &Value,
) {
    if module_id.is_empty() {
        return;
    }
    let subject = format!("module.storage.{}.changed", module_id);
    let occurred_at = now_iso8601();
    let event = BaseEvent::new(
        EVENT_TYPE,
        SOURCE,
        serde_json::json!({
            "moduleId": module_id,
            "key": key,
            "value": value,
            "occurredAt": occurred_at.clone(),
        }),
    )
    .with_time(occurred_at);

    let envelope = match event.to_value() {
        Ok(envelope) => envelope,
        Err(err) => {
            tracing::warn!(
                "module.storage.changed encode failed (continuing): module={} key={} err={}",
                module_id,
                key,
                err
            );
            return;
        }
    };

    if let Err(err) = nats.publish(&subject, envelope) {
        tracing::warn!(
            "module.storage.changed publish failed (continuing): module={} key={} err={}",
            module_id,
            key,
            err
        );
    }
}
