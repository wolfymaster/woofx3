//! Shared platform-gateway fixtures through typify's types (serde) and through the `jsonschema` crate reading the same document.
use generators_spike::models_gen::{CapabilitiesReply, FieldOptionsReply, FieldOptionsRequest, GatewayReply, GatewayRequest};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;

const FIXTURE_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../in/fixtures");
const DOC: &str = include_str!("../../work/nats.31.json");

struct Case {
    suite: &'static str,
    schema: &'static str,
    name: String,
    valid: bool,
    value: Value,
}

fn cases() -> Vec<Case> {
    let suites = [
        ("requests.json", "request", "GatewayRequest"),
        ("replies.json", "reply", "GatewayReply"),
        ("capabilities-replies.json", "reply", "CapabilitiesReply"),
        ("field-options-requests.json", "request", "FieldOptionsRequest"),
        ("field-options-replies.json", "reply", "FieldOptionsReply"),
    ];
    let mut out = vec![];
    for (file, key, schema) in suites {
        let text = std::fs::read_to_string(format!("{FIXTURE_DIR}/{file}")).unwrap();
        let doc: Value = serde_json::from_str(&text).unwrap();
        for c in doc["cases"].as_array().unwrap() {
            out.push(Case { suite: file, schema, name: c["name"].as_str().unwrap().into(), valid: c["invalidField"].is_null(), value: c[key].clone() });
        }
    }
    out
}

fn round_trip<T: DeserializeOwned + Serialize>(v: &Value) -> Result<Value, String> {
    let t: T = serde_json::from_value(v.clone()).map_err(|e| e.to_string())?;
    serde_json::to_value(&t).map_err(|e| e.to_string())
}

fn typify_run(c: &Case) -> Result<Value, String> {
    match c.schema {
        "GatewayRequest" => round_trip::<GatewayRequest>(&c.value),
        "GatewayReply" => round_trip::<GatewayReply>(&c.value),
        "CapabilitiesReply" => round_trip::<CapabilitiesReply>(&c.value),
        "FieldOptionsRequest" => round_trip::<FieldOptionsRequest>(&c.value),
        "FieldOptionsReply" => round_trip::<FieldOptionsReply>(&c.value),
        other => panic!("{other}"),
    }
}

fn strip_extra(v: &mut Value) {
    match v {
        Value::Object(m) => {
            if m.get("additionalProperties") == Some(&Value::Bool(false)) {
                m.remove("additionalProperties");
            }
            m.values_mut().for_each(strip_extra);
        }
        Value::Array(a) => a.iter_mut().for_each(strip_extra),
        _ => {}
    }
}

#[test]
fn test_fixtures_typify_and_jsonschema() {
    let doc: Value = serde_json::from_str(DOC).unwrap();
    let mut lenient = doc.clone();
    strip_extra(&mut lenient);
    let validator = |d: &Value, schema: &str| {
        let mut root = serde_json::json!({ "$ref": format!("#/components/schemas/{schema}") });
        root["components"] = d["components"].clone();
        jsonschema::options().build(&root).unwrap_or_else(|e| panic!("{schema}: {e}"))
    };
    let (mut ty_bad_valid, mut ty_bad_invalid, mut js_bad_valid, mut js_bad_invalid) = (vec![], vec![], vec![], vec![]);
    let all = cases();
    for c in &all {
        let label = format!("{}/{}", c.suite, c.name);
        match typify_run(c) {
            Err(e) if c.valid => ty_bad_valid.push(format!("REJECTS VALID   {label}: {}", &e[..e.len().min(110)])),
            Ok(back) if c.valid && back != c.value => ty_bad_valid.push(format!("LOSSY ROUNDTRIP {label}")),
            Ok(_) if !c.valid => ty_bad_invalid.push(format!("ACCEPTS INVALID {label}")),
            _ => {}
        }
        let d = if c.suite.contains("replies") { &lenient } else { &doc };
        let ok = validator(d, c.schema).is_valid(&c.value);
        if c.valid && !ok { js_bad_valid.push(format!("REJECTS VALID   {label}")); }
        if !c.valid && ok { js_bad_invalid.push(format!("ACCEPTS INVALID {label}")); }
    }
    println!("== typify types: {} cases, {} valid mishandled, {} invalid accepted", all.len(), ty_bad_valid.len(), ty_bad_invalid.len());
    ty_bad_valid.iter().chain(&ty_bad_invalid).for_each(|l| println!("  {l}"));
    println!("== jsonschema crate on 3.1 doc: {} valid mishandled, {} invalid accepted", js_bad_valid.len(), js_bad_invalid.len());
    js_bad_valid.iter().chain(&js_bad_invalid).for_each(|l| println!("  {l}"));
}

#[test]
fn test_bound_read_from_document() {
    let doc: Value = serde_json::from_str(DOC).unwrap();
    let max = doc.pointer("/components/schemas/StreamOnlineEvent/properties/twitchUserId/maxLength").and_then(Value::as_u64);
    assert_eq!(max, Some(200));
}
