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
use woofx3_cloudevents::messages_gen::ModuleStorageChange;
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
    let change = match storage_change(module_id, key, value, &occurred_at) {
        Ok(change) => change,
        Err(err) => {
            tracing::warn!(
                "module.storage.changed breaks its contract (continuing): module={} key={} err={}",
                module_id,
                key,
                err
            );
            return;
        }
    };
    let event = BaseEvent::new(EVENT_TYPE, SOURCE, change).with_time(occurred_at);

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

/// The event's data, checked against the contract on the way in.
fn storage_change(
    module_id: &str,
    key: &str,
    value: &Value,
    occurred_at: &str,
) -> Result<ModuleStorageChange, String> {
    Ok(ModuleStorageChange {
        module_id: module_id.try_into().map_err(|e| format!("moduleId: {e}"))?,
        key: key.try_into().map_err(|e| format!("key: {e}"))?,
        value: value.clone(),
        occurred_at: occurred_at
            .try_into()
            .map_err(|e| format!("occurredAt: {e}"))?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use woofx3_cloudevents::messages_gen::ModuleStorageChangedEvent;

    #[test]
    fn test_storage_change_event_is_the_contracts_envelope() {
        let occurred_at = now_iso8601();
        let change = storage_change(
            "counter",
            "counter:state:count",
            &json!({"n": 1}),
            &occurred_at,
        )
        .unwrap();
        let envelope = BaseEvent::new(EVENT_TYPE, SOURCE, change)
            .with_time(occurred_at)
            .to_value()
            .unwrap();

        serde_json::from_value::<ModuleStorageChangedEvent>(envelope).unwrap();
    }

    #[test]
    fn test_storage_change_refuses_an_empty_key() {
        assert!(storage_change("counter", "", &json!(1), &now_iso8601()).is_err());
    }
}
