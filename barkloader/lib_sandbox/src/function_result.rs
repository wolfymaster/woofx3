//! What a module function may ask the engine to publish when it returns.
//!
//! A function that wants to announce something — a counter changed, a timer
//! ran out — returns `ctx.result(value, events)`. The function never touches
//! the bus: the engine checks each event against the triggers the module
//! declares and publishes them itself, then hands only `value` back to the
//! caller as the function's result. See `docs/services/engine-integrity.md`.
//!
//! The rules match the inbound webhook handler's `events` in
//! `api/src/inbound-webhook-result.ts`, so a module sees one contract for both.

use serde_json::{Map, Value};
use std::collections::HashSet;

pub const RESULT_PROTO: &str = "woofx3.result";

/// Most events one invocation may produce.
pub const MAX_EVENTS: usize = 16;
/// Largest `data` one event may carry, serialized.
pub const MAX_EVENT_DATA_BYTES: usize = 64 * 1024;

const RESULT_KEYS: [&str; 4] = ["proto", "v", "value", "events"];
const EVENT_KEYS: [&str; 2] = ["type", "data"];

#[derive(Debug, Clone, PartialEq)]
pub struct ModuleEvent {
    pub event_type: String,
    pub data: Value,
}

/// `ctx.result(value, events)`. Builds the envelope only; nothing is checked or
/// published until the function returns it.
pub fn build_result_value(value: Value, events: Value) -> Value {
    serde_json::json!({
        "proto": RESULT_PROTO,
        "v": 1,
        "value": value,
        "events": events,
    })
}

/// Splits what a function returned into the result its caller sees and the
/// events to publish.
///
/// Anything that is not a `ctx.result` envelope is the result as it stands,
/// with nothing to publish. An envelope that breaks any rule is refused whole,
/// so a module bug can never publish part of what it meant to.
/// `allowed_event_types` are the `event`s of the module's own eventbus
/// triggers.
pub fn resolve_function_result(
    result: Value,
    allowed_event_types: &HashSet<String>,
) -> Result<(Value, Vec<ModuleEvent>), String> {
    let Some(envelope) = as_envelope(&result) else {
        return Ok((result, Vec::new()));
    };
    if let Some(key) = envelope
        .keys()
        .find(|key| !RESULT_KEYS.contains(&key.as_str()))
    {
        return Err(format!("ctx.result has unknown field {key:?}"));
    }
    if envelope.get("v").and_then(Value::as_i64) != Some(1) {
        return Err("ctx.result has an unsupported version".to_string());
    }
    let events = check_events(envelope.get("events"), allowed_event_types)?;
    let value = envelope.get("value").cloned().unwrap_or(Value::Null);
    Ok((value, events))
}

fn as_envelope(result: &Value) -> Option<&Map<String, Value>> {
    let object = result.as_object()?;
    (object.get("proto").and_then(Value::as_str) == Some(RESULT_PROTO)).then_some(object)
}

fn check_events(
    raw: Option<&Value>,
    allowed_event_types: &HashSet<String>,
) -> Result<Vec<ModuleEvent>, String> {
    let entries = match raw {
        None | Some(Value::Null) => return Ok(Vec::new()),
        Some(Value::Array(entries)) => entries,
        Some(_) => return Err("ctx.result events must be an array".to_string()),
    };
    if entries.len() > MAX_EVENTS {
        return Err(format!("ctx.result may carry at most {MAX_EVENTS} events"));
    }
    let mut events = Vec::with_capacity(entries.len());
    for (i, entry) in entries.iter().enumerate() {
        let Some(entry) = entry.as_object() else {
            return Err(format!("events[{i}] must be an object"));
        };
        if let Some(key) = entry.keys().find(|key| !EVENT_KEYS.contains(&key.as_str())) {
            return Err(format!("events[{i}] has unknown field {key:?}"));
        }
        let event_type = entry.get("type").and_then(Value::as_str).unwrap_or("");
        if !allowed_event_types.contains(event_type) {
            return Err(format!(
                "events[{i}].type {event_type:?} is not an eventbus trigger this module declares"
            ));
        }
        let data = match entry.get("data") {
            None | Some(Value::Null) => Value::Object(Map::new()),
            Some(data @ Value::Object(_)) => data.clone(),
            Some(_) => return Err(format!("events[{i}].data must be an object")),
        };
        if data.to_string().len() > MAX_EVENT_DATA_BYTES {
            return Err(format!(
                "events[{i}].data exceeds {MAX_EVENT_DATA_BYTES} bytes"
            ));
        }
        events.push(ModuleEvent {
            event_type: event_type.to_string(),
            data,
        });
    }
    Ok(events)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn allowed() -> HashSet<String> {
        HashSet::from(["counter.changed".to_string()])
    }

    #[test]
    fn a_plain_result_passes_through_with_nothing_to_publish() {
        let (value, events) = resolve_function_result(json!({ "next": 3 }), &allowed()).unwrap();
        assert_eq!(value, json!({ "next": 3 }));
        assert!(events.is_empty());
    }

    #[test]
    fn an_envelope_yields_its_value_and_events() {
        let result = build_result_value(
            json!({ "next": 3 }),
            json!([{ "type": "counter.changed", "data": { "next": 3 } }]),
        );
        let (value, events) = resolve_function_result(result, &allowed()).unwrap();
        assert_eq!(value, json!({ "next": 3 }));
        assert_eq!(
            events,
            vec![ModuleEvent {
                event_type: "counter.changed".into(),
                data: json!({ "next": 3 })
            }]
        );
    }

    #[test]
    fn an_envelope_without_events_publishes_nothing() {
        let result = build_result_value(json!(1), Value::Null);
        let (value, events) = resolve_function_result(result, &allowed()).unwrap();
        assert_eq!(value, json!(1));
        assert!(events.is_empty());
    }

    // The point of the contract: a module announces only what it declared.
    #[test]
    fn refuses_an_event_type_the_module_does_not_declare() {
        let result = build_result_value(json!(null), json!([{ "type": "channel.cheer" }]));
        let err = resolve_function_result(result, &allowed()).unwrap_err();
        assert!(err.contains("not an eventbus trigger"), "{err}");
    }

    #[test]
    fn refuses_a_malformed_envelope_whole() {
        let cases = [
            json!({ "proto": RESULT_PROTO, "v": 2, "value": 1 }),
            json!({ "proto": RESULT_PROTO, "v": 1, "extra": 1 }),
            json!({ "proto": RESULT_PROTO, "v": 1, "events": {} }),
            json!({ "proto": RESULT_PROTO, "v": 1, "events": [{ "type": "counter.changed", "data": [] }] }),
            json!({ "proto": RESULT_PROTO, "v": 1, "events": [{ "type": "counter.changed", "subject": "x" }] }),
        ];
        for case in cases {
            assert!(
                resolve_function_result(case.clone(), &allowed()).is_err(),
                "{case}"
            );
        }
    }

    #[test]
    fn refuses_too_many_or_too_large_events() {
        let many: Vec<Value> = (0..=MAX_EVENTS)
            .map(|_| json!({ "type": "counter.changed" }))
            .collect();
        assert!(
            resolve_function_result(build_result_value(Value::Null, json!(many)), &allowed())
                .is_err()
        );

        let large = json!([{ "type": "counter.changed", "data": { "x": "a".repeat(MAX_EVENT_DATA_BYTES) } }]);
        assert!(
            resolve_function_result(build_result_value(Value::Null, large), &allowed()).is_err()
        );
    }
}
