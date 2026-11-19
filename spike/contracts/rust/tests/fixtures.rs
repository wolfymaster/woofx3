use contracts_spike::{Strictness, Validators};
use serde_json::Value;

const FIXTURES: &str = "../../../shared/common/contracts/testdata/platform-gateway";

#[test]
fn test_fixtures_report_disagreements() {
    let strict = Validators::new(Strictness::Strict).expect("strict");
    let lenient = Validators::new(Strictness::Lenient).expect("lenient");
    let suites = [
        ("requests.json", "request", "platform-gateway/gateway-request.json", &strict),
        ("replies.json", "reply", "platform-gateway/gateway-reply.json", &lenient),
        ("capabilities-replies.json", "reply", "platform-gateway/capabilities-reply.json", &lenient),
        ("field-options-requests.json", "request", "platform-gateway/field-options-request.json", &strict),
        ("field-options-replies.json", "reply", "platform-gateway/field-options-reply.json", &lenient),
    ];
    let mut bad = Vec::new();
    let mut total = 0;
    for (file, key, schema, validators) in suites {
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(format!("{FIXTURES}/{file}")).unwrap()).unwrap();
        for case in doc["cases"].as_array().unwrap() {
            total += 1;
            let valid = case["invalidField"].is_null();
            let ok = validators.validate(schema, &case[key]).is_ok();
            if ok != valid {
                bad.push(format!("{file}: {}", case["name"]));
            }
        }
    }
    println!("{total} cases; disagreements: {bad:#?}");
    // The cases JSON Schema cannot express; closing a gap fails this test until the entry is removed.
    let known = [
        "requests.json: \"an empty ids list on an all target counts as absent\"",
        "requests.json: \"a null origin on a platforms target counts as absent\"",
        "capabilities-replies.json: \"a platform listed twice\"",
        "field-options-requests.json: \"an unknown key is ignored\"",
    ];
    assert_eq!(bad, known, "{bad:#?}");
}

#[test]
fn test_typed_decode_after_validation() {
    use contracts_spike::models_gen::{GatewayRequest, PlatformOutcome};
    let req = serde_json::json!({"action":"chat.send","target":{"kind":"all"},"payload":{"message":"hi"},"idempotencyKey":"k","requestedBy":{"kind":"api","ref":"c"}});
    let typed: GatewayRequest = serde_json::from_value(req).expect("decodes");
    assert!(matches!(typed, GatewayRequest::ChatSendRequest(_)));
    let out: PlatformOutcome = serde_json::from_str(r#"{"status":"failed","code":"upstream","message":"m"}"#).expect("decodes");
    assert!(matches!(out, PlatformOutcome::Failed { .. }));
    // Typify's types enforce string bounds on decode but not integer ranges: the schema validator owns those.
    let bad: Result<PlatformOutcome, _> = serde_json::from_str(r#"{"status":"failed","code":"upstream","message":"m","extra":1}"#);
    assert!(bad.is_err());
}
