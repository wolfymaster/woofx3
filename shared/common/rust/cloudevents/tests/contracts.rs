//! Runs the shared fixtures in shared/contracts/<domain>/fixtures through the generated types (serde) and through
//! the `jsonschema` crate reading the embedded contract document. The Go and TypeScript tests run the same files,
//! so a case fixes the verdict of all three languages.

use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use woofx3_cloudevents::{barkloader_gen, module_gen, outbox_gen, scene_gen};

struct Case {
    name: String,
    valid: bool,
    unknown_fields: bool,
    value: Value,
}

fn fixtures(domain: &str, file: &str, schema: &str) -> Vec<Case> {
    let path = format!(
        "{}/../../../contracts/{domain}/fixtures/{file}",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let suite: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(suite["schema"], schema, "{file} is for another schema");
    suite["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| Case {
            name: c["name"].as_str().unwrap().to_string(),
            valid: c["valid"].as_bool().unwrap(),
            unknown_fields: c["unknownFields"].as_bool().unwrap_or(false),
            value: c["value"].clone(),
        })
        .collect()
}

fn validator(document: &str, schema: &str) -> jsonschema::Validator {
    let mut root: Value = serde_json::from_str(document).unwrap();
    root = json!({ "$ref": format!("#/components/schemas/{schema}"), "components": root["components"] });
    jsonschema::validator_for(&root).unwrap()
}

/// Equal as JSON: a number typed as a float and one written as an integer are the same value.
fn same_json(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same_json(p, q))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, v)| y.get(k).is_some_and(|w| same_json(v, w)))
        }
        _ => a == b,
    }
}

fn run<T: DeserializeOwned + Serialize>(domain: &str, file: &str, schema: &str, document: &str) {
    let validator = validator(document, schema);
    for case in fixtures(domain, file, schema) {
        let label = format!("{file}/{}", case.name);
        let typed = serde_json::from_value::<T>(case.value.clone());
        let schema_ok = validator.is_valid(&case.value);
        assert_eq!(schema_ok, case.valid, "jsonschema: {label}");
        // serde reads a null as an absent optional field, so the types alone cannot refuse one; the validator does.
        // typify reads a union discriminated by a string as an adjacently tagged enum, which refuses a field beside a
        // variant that has none, such as `error` on `{"status":"ok"}`, though an open reply allows it.
        let tolerated = (case.value.to_string().contains("null") && !case.valid)
            || (case.valid && case.unknown_fields);
        if !tolerated {
            assert_eq!(typed.is_ok(), case.valid, "typify types: {label}");
        }
        if case.valid && !case.unknown_fields {
            let encoded = serde_json::to_value(typed.unwrap()).unwrap();
            assert!(
                same_json(&encoded, &case.value),
                "round trip: {label}\n got  {encoded}\n want {}",
                case.value
            );
        }
    }
}

#[test]
fn test_scene_command_request_fixtures() {
    run::<scene_gen::SceneCommandRequest>(
        "scene",
        "scene-command-request.json",
        "SceneCommandRequest",
        scene_gen::DOCUMENT,
    );
}

#[test]
fn test_scene_command_reply_fixtures() {
    run::<scene_gen::SceneCommandReply>(
        "scene",
        "scene-command-reply.json",
        "SceneCommandReply",
        scene_gen::DOCUMENT,
    );
}

#[test]
fn test_module_field_options_request_fixtures() {
    run::<barkloader_gen::ModuleFieldOptionsRequest>(
        "barkloader",
        "module-field-options-request.json",
        "ModuleFieldOptionsRequest",
        barkloader_gen::DOCUMENT,
    );
}

#[test]
fn test_module_storage_changed_event_fixtures() {
    run::<module_gen::ModuleStorageChangedEvent>(
        "module",
        "module-storage-changed-event.json",
        "ModuleStorageChangedEvent",
        module_gen::DOCUMENT,
    );
}

#[test]
fn test_database_record_changed_event_fixtures() {
    run::<outbox_gen::DatabaseRecordChangedEvent>(
        "outbox",
        "database-record-changed-event.json",
        "DatabaseRecordChangedEvent",
        outbox_gen::DOCUMENT,
    );
}

#[test]
fn test_user_page_form_submitted_event_fixtures() {
    run::<outbox_gen::UserPageFormSubmittedEvent>(
        "outbox",
        "userpage-form-submitted-event.json",
        "UserPageFormSubmittedEvent",
        outbox_gen::DOCUMENT,
    );
}

#[test]
fn test_viewer_segment_entered_event_fixtures() {
    run::<outbox_gen::ViewerSegmentEnteredEvent>(
        "outbox",
        "viewer-segment-entered-event.json",
        "ViewerSegmentEnteredEvent",
        outbox_gen::DOCUMENT,
    );
}

#[test]
fn test_viewer_segment_left_event_fixtures() {
    run::<outbox_gen::ViewerSegmentLeftEvent>(
        "outbox",
        "viewer-segment-left-event.json",
        "ViewerSegmentLeftEvent",
        outbox_gen::DOCUMENT,
    );
}

#[test]
fn test_request_type_is_the_subject() {
    assert_eq!(
        barkloader_gen::ModuleFieldOptionsRequestType::BarkloaderModuleFieldOptions.to_string(),
        "barkloader.module.field_options"
    );
    assert_eq!(
        scene_gen::SceneCommandRequestType::EngineSceneCommand.to_string(),
        "engine.scene.command"
    );
}
