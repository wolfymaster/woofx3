//! The generated companion gateway contract against the shared fixtures that
//! connectors' TypeScript parser is tested with
//! (shared/common/typescript/cloudevents/Companion/module-request.test.ts),
//! so both languages accept and refuse the same messages, plus golden JSON
//! for the values barkloader builds and reads.
//!
//! Rust refuses a wrong JSON type, a missing required field or an unknown key
//! while decoding, before validation runs. serde names the field of an
//! unknown or missing key, which must be the fixture's field; a wrong type
//! carries no field name from serde. A case validation refuses must name the
//! fixture's whole dotted field.

use lib_sandbox::contracts::companion_gateway::{
    DecodeError, ModuleEndpointFailed, ModuleEndpointFailureCode, ModuleEndpointMatch,
    ModuleEndpointMatchRequest, ModuleEndpointMatchValue, ModuleEndpointOk, ModuleEndpointReply,
    ModuleEndpointRequest, ModuleEndpointSend, SUBJECT_MODULE_REQUEST,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::PathBuf;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    name: String,
    invalid_field: Option<String>,
    #[serde(default)]
    request: Value,
    #[serde(default)]
    reply: Value,
}

#[derive(Deserialize)]
struct FixtureFile {
    cases: Vec<Fixture>,
}

fn read_fixtures(name: &str) -> Vec<Fixture> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../shared/common/contracts/testdata/companion-gateway")
        .join(name);
    let raw = std::fs::read(&path).unwrap_or_else(|e| panic!("reading {path:?}: {e}"));
    let file: FixtureFile =
        serde_json::from_slice(&raw).unwrap_or_else(|e| panic!("parsing {path:?}: {e}"));
    assert!(!file.cases.is_empty(), "{path:?} has no cases");
    file.cases
}

/// Checks one fixture's outcome; returns a description of the mismatch.
fn check_case<T>(fixture: &Fixture, outcome: Result<T, DecodeError>) -> Option<String> {
    match (&fixture.invalid_field, outcome) {
        (None, Ok(_)) => None,
        (None, Err(e)) => Some(format!("{}: refused: {e}", fixture.name)),
        (Some(field), Ok(_)) => Some(format!("{}: accepted, want {field} refused", fixture.name)),
        (Some(field), Err(DecodeError::Invalid(e))) if e.field != *field => Some(format!(
            "{}: refused at {}, want {field}",
            fixture.name, e.field
        )),
        (Some(_), Err(DecodeError::Invalid(_))) => None,
        (Some(field), Err(DecodeError::Json(e))) => serde_field_mismatch(&fixture.name, field, &e),
    }
}

/// serde names the offending field of an unknown or missing key in backticks
/// ("unknown field `match`", "missing field `budgetMs`"); that name must be
/// the leaf of the fixture's field. A wrong type or an unknown discriminant
/// carries no field name, so those are only known to be refused.
fn serde_field_mismatch(name: &str, field: &str, error: &serde_json::Error) -> Option<String> {
    let message = error.to_string();
    let named = ["unknown field `", "missing field `"]
        .iter()
        .find_map(|prefix| message.strip_prefix(prefix))
        .and_then(|rest| rest.split('`').next());
    let leaf = field.rsplit('.').next().unwrap_or(field);
    match named {
        Some(found) if found != leaf => Some(format!(
            "{name}: serde refused field {found}, want {field}: {message}"
        )),
        _ => None,
    }
}

fn assert_cases<T>(fixtures: &[Fixture], decode: impl Fn(&Fixture) -> Result<T, DecodeError>) {
    let failures: Vec<String> = fixtures
        .iter()
        .filter_map(|fixture| check_case(fixture, decode(fixture)))
        .collect();
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn test_companion_gateway_request_fixtures() {
    assert_cases(&read_fixtures("requests.json"), |fixture| {
        ModuleEndpointRequest::decode(&serde_json::to_vec(&fixture.request).unwrap())
    });
}

#[test]
fn test_companion_gateway_reply_fixtures() {
    assert_cases(&read_fixtures("replies.json"), |fixture| {
        ModuleEndpointReply::decode(&serde_json::to_vec(&fixture.reply).unwrap())
    });
}

fn send_with_message(message: String) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "op": "send",
        "moduleId": "vtube_studio",
        "endpointId": "vts",
        "message": message,
        "budgetMs": 1000,
    }))
    .unwrap()
}

/// JSON.parse turns `1000.0` into the integer 1000, so connectors' TypeScript
/// accepts it where serde refuses a float for an integer field. barkloader
/// writes plain integers, so the difference is never exercised; it is pinned
/// here, and in module-request.test.ts, rather than papered over.
#[test]
fn test_companion_gateway_integral_float_is_refused() {
    let raw = br#"{"op":"send","moduleId":"vtube_studio","endpointId":"vts","message":"x","budgetMs":1000.0}"#;
    assert!(matches!(
        ModuleEndpointRequest::decode(raw),
        Err(DecodeError::Json(_))
    ));
}

#[test]
fn test_companion_gateway_message_bound_counts_bytes() {
    assert!(ModuleEndpointRequest::decode(&send_with_message("é".repeat(32768))).is_ok());
    match ModuleEndpointRequest::decode(&send_with_message(format!("{}x", "é".repeat(32768)))) {
        Err(DecodeError::Invalid(e)) => assert_eq!(e.field, "message"),
        other => panic!("want message refused, got {other:?}"),
    }
}

#[test]
fn test_companion_gateway_validation_error_names_nested_field() {
    let request = ModuleEndpointRequest::Request(ModuleEndpointMatchRequest {
        module_id: "vtube_studio".to_string(),
        endpoint_id: "vts".to_string(),
        message: "{}".to_string(),
        budget_ms: 1000,
        r#match: ModuleEndpointMatch {
            field: "request-id".to_string(),
            value: ModuleEndpointMatchValue::Integer(1),
        },
    });
    let error = request.validate().unwrap_err();
    assert_eq!(error.field, "match.field");
    assert_eq!(
        error.to_string(),
        "match.field: must match ^[A-Za-z0-9_]{1,40}$"
    );
}

#[test]
fn test_companion_gateway_request_golden_json() {
    let send = ModuleEndpointRequest::Send(ModuleEndpointSend {
        module_id: "vtube_studio".to_string(),
        endpoint_id: "vts".to_string(),
        message: "hello".to_string(),
        budget_ms: 4500,
    });
    assert_eq!(
        serde_json::to_value(&send).unwrap(),
        json!({"op": "send", "moduleId": "vtube_studio", "endpointId": "vts", "message": "hello", "budgetMs": 4500})
    );

    let cases = [
        (
            ModuleEndpointMatchValue::Text("r1".to_string()),
            json!("r1"),
        ),
        (ModuleEndpointMatchValue::Integer(42), json!(42)),
    ];
    for (value, wire) in cases {
        let request = ModuleEndpointRequest::Request(ModuleEndpointMatchRequest {
            module_id: "vtube_studio".to_string(),
            endpoint_id: "vts".to_string(),
            message: "{}".to_string(),
            budget_ms: 100,
            r#match: ModuleEndpointMatch {
                field: "requestID".to_string(),
                value,
            },
        });
        let expected = json!({
            "op": "request",
            "moduleId": "vtube_studio",
            "endpointId": "vts",
            "message": "{}",
            "budgetMs": 100,
            "match": {"field": "requestID", "value": wire},
        });
        assert_eq!(serde_json::to_value(&request).unwrap(), expected);
        let decoded =
            ModuleEndpointRequest::decode(&serde_json::to_vec(&expected).unwrap()).unwrap();
        assert_eq!(decoded, request);
    }
}

#[test]
fn test_companion_gateway_reply_golden_json() {
    let cases = [
        (
            ModuleEndpointReply::Ok(ModuleEndpointOk {
                reply: Some("{\"requestID\":\"r1\"}".to_string()),
                session_epoch: "e-1".to_string(),
            }),
            json!({"status": "ok", "reply": "{\"requestID\":\"r1\"}", "sessionEpoch": "e-1"}),
        ),
        (
            ModuleEndpointReply::Ok(ModuleEndpointOk {
                reply: None,
                session_epoch: "e-1".to_string(),
            }),
            json!({"status": "ok", "sessionEpoch": "e-1"}),
        ),
        (
            ModuleEndpointReply::Failed(ModuleEndpointFailed {
                code: ModuleEndpointFailureCode::AdapterOwned,
                message: "the obs adapter owns this endpoint".to_string(),
                session_epoch: None,
            }),
            json!({"status": "failed", "code": "adapter_owned", "message": "the obs adapter owns this endpoint"}),
        ),
    ];
    for (reply, wire) in cases {
        assert_eq!(serde_json::to_value(&reply).unwrap(), wire);
        let decoded = ModuleEndpointReply::decode(&serde_json::to_vec(&wire).unwrap()).unwrap();
        assert_eq!(decoded, reply);
    }
}

#[test]
fn test_companion_gateway_wire_names() {
    assert_eq!(SUBJECT_MODULE_REQUEST, "engine.companion.module.request");
    assert_eq!(
        ModuleEndpointFailureCode::StoreUnreadable.to_string(),
        "store_unreadable"
    );
}
