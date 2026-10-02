use lib_sandbox::extensions::{ChatExtension, TwitchExtension};
use lib_sandbox::host::noop::noop_host_context;
use lib_sandbox::host::{
    ChatSender, ExtensionRegistry, HostExtension, HostFunction, NatsPublisher, NatsRequester,
    RequestError,
};
use lib_sandbox::models::function::Function;
use lib_sandbox::models::request::InvokeRequest;
use lib_sandbox::{ModuleMetadata, ModuleRegistry, ModuleState, RegisteredModule, Sandbox};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

fn build_registry() -> Arc<ModuleRegistry> {
    let registry = Arc::new(ModuleRegistry::new());

    let test_dir = std::env::current_dir()
        .unwrap()
        .join("tests/modules/example");

    let mut functions = HashMap::new();

    let echo_code = std::fs::read_to_string(test_dir.join("example.echo")).unwrap();
    functions.insert(
        "example".to_string(),
        Function::new(
            "example".to_string(),
            "example.echo".to_string(),
            echo_code,
            false,
        ),
    );

    let lua_code = std::fs::read_to_string(test_dir.join("helloworld.lua")).unwrap();
    functions.insert(
        "helloworld".to_string(),
        Function::new(
            "helloworld".to_string(),
            "helloworld.lua".to_string(),
            lua_code,
            false,
        ),
    );

    let js_code = std::fs::read_to_string(test_dir.join("sayhello.js")).unwrap();
    functions.insert(
        "sayhello".to_string(),
        Function::new(
            "sayhello".to_string(),
            "sayhello.js".to_string(),
            js_code,
            false,
        ),
    );

    let module = RegisteredModule {
        metadata: ModuleMetadata {
            name: "example".to_string(),
            version: "1.0.0".to_string(),
            installed_at: 0,
            updated_at: 0,
        },
        functions,
        state: ModuleState::Active,
        event_types: Default::default(),
        permissions: Default::default(),
        url_settings: Default::default(),
        oauth: Default::default(),
    };

    registry
        .register_module("example".to_string(), module)
        .unwrap();
    registry
}

fn test_sandbox_instance() -> Sandbox {
    let registry = build_registry();
    Sandbox::new(registry, noop_host_context()).unwrap()
}

#[test]
fn test_sandbox() {
    let mut sandbox = test_sandbox_instance();

    let result = sandbox
        .invoke(InvokeRequest {
            function: "example:function:example".to_string(),
            event: serde_json::json!({ "input": "test" }),
            user: None,
            params: serde_json::Value::Null,
            workflow_chain: None,
            timeout_ms: None,
        })
        .unwrap();

    assert_eq!(
        result["code"],
        serde_json::json!("// This file is intentionally empty")
    );
    assert_eq!(result["event"], serde_json::json!({ "input": "test" }));
}

#[test]
fn test_lua_adapter() {
    let mut sandbox = test_sandbox_instance();

    let result = sandbox
        .invoke(InvokeRequest {
            function: "example:function:helloworld".to_string(),
            event: serde_json::json!({ "name": "wolfy" }),
            user: None,
            params: serde_json::Value::Null,
            workflow_chain: None,
            timeout_ms: None,
        })
        .unwrap();

    assert_eq!(result["response"], serde_json::json!("Hello wolfy"));
}

#[test]
fn test_quickjs_adapter() {
    let mut sandbox = test_sandbox_instance();

    let result = sandbox
        .invoke(InvokeRequest {
            function: "example:function:sayhello".to_string(),
            event: serde_json::json!({ "name": "wolfy" }),
            user: None,
            params: serde_json::Value::Null,
            workflow_chain: None,
            timeout_ms: None,
        })
        .unwrap();

    assert_eq!(result["response"], serde_json::json!("Hello wolfy"));
}

#[test]
fn test_null_event() {
    let mut sandbox = test_sandbox_instance();

    let result = sandbox
        .invoke(InvokeRequest {
            function: "example:function:sayhello".to_string(),
            event: serde_json::Value::Null,
            user: None,
            params: serde_json::Value::Null,
            workflow_chain: None,
            timeout_ms: None,
        })
        .unwrap();

    assert_eq!(result["response"], serde_json::json!("Hello World"));
}

#[test]
fn test_js_instruction_limit() {
    let registry = build_registry();
    let code = r#"function infinite(ctx) { while(true) {} }"#;

    let mut functions = HashMap::new();
    functions.insert(
        "infinite".to_string(),
        Function::new(
            "infinite".to_string(),
            "infinite.js".to_string(),
            code.to_string(),
            false,
        ),
    );

    let module = RegisteredModule {
        metadata: ModuleMetadata {
            name: "limits".to_string(),
            version: "1.0.0".to_string(),
            installed_at: 0,
            updated_at: 0,
        },
        functions,
        state: ModuleState::Active,
        event_types: Default::default(),
        permissions: Default::default(),
        url_settings: Default::default(),
        oauth: Default::default(),
    };

    registry
        .register_module("limits".to_string(), module)
        .unwrap();

    let mut sandbox = Sandbox::new(registry, noop_host_context()).unwrap();

    let result = sandbox.invoke(InvokeRequest {
        function: "limits:function:infinite".to_string(),
        event: serde_json::Value::Null,
        user: None,
        params: serde_json::Value::Null,
        workflow_chain: None,
        timeout_ms: None,
    });

    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.to_string().contains("Instruction limit")
            || err.to_string().contains("instruction limit"),
        "Expected instruction limit error, got: {}",
        err
    );
}

#[test]
fn test_js_isolation() {
    let code = r#"
var counter = 0;
function isolation(ctx) {
    counter += 1;
    return { count: counter };
}
"#;

    let registry = Arc::new(ModuleRegistry::new());

    let mut functions = HashMap::new();
    functions.insert(
        "isolation".to_string(),
        Function::new(
            "isolation".to_string(),
            "isolation.js".to_string(),
            code.to_string(),
            false,
        ),
    );

    let module = RegisteredModule {
        metadata: ModuleMetadata {
            name: "example".to_string(),
            version: "1.0.0".to_string(),
            installed_at: 0,
            updated_at: 0,
        },
        functions,
        state: ModuleState::Active,
        event_types: Default::default(),
        permissions: Default::default(),
        url_settings: Default::default(),
        oauth: Default::default(),
    };

    registry
        .register_module("example".to_string(), module)
        .unwrap();

    let mut sandbox = Sandbox::new(registry, noop_host_context()).unwrap();

    let result1 = sandbox
        .invoke(InvokeRequest {
            function: "example:function:isolation".to_string(),
            event: serde_json::Value::Null,
            user: None,
            params: serde_json::Value::Null,
            workflow_chain: None,
            timeout_ms: None,
        })
        .unwrap();

    let result2 = sandbox
        .invoke(InvokeRequest {
            function: "example:function:isolation".to_string(),
            event: serde_json::Value::Null,
            user: None,
            params: serde_json::Value::Null,
            workflow_chain: None,
            timeout_ms: None,
        })
        .unwrap();

    assert_eq!(result1["count"], serde_json::json!(1));
    assert_eq!(result2["count"], serde_json::json!(1));
}

#[test]
fn test_custom_entry_point() {
    let _sandbox = test_sandbox_instance();
}

#[test]
fn test_ctx_event_data() {
    let code = r#"function ctx_test(ctx) {
    return {
        has_event: ctx.event !== null && ctx.event !== undefined,
        amount: ctx.event ? ctx.event.amount : 0,
    };
}"#;

    let registry = Arc::new(ModuleRegistry::new());

    let mut functions = HashMap::new();
    functions.insert(
        "ctx_test".to_string(),
        Function::new(
            "ctx_test".to_string(),
            "ctx_test.js".to_string(),
            code.to_string(),
            false,
        ),
    );

    let module = RegisteredModule {
        metadata: ModuleMetadata {
            name: "example".to_string(),
            version: "1.0.0".to_string(),
            installed_at: 0,
            updated_at: 0,
        },
        functions,
        state: ModuleState::Active,
        event_types: Default::default(),
        permissions: Default::default(),
        url_settings: Default::default(),
        oauth: Default::default(),
    };

    registry
        .register_module("example".to_string(), module)
        .unwrap();

    let mut sandbox = Sandbox::new(registry, noop_host_context()).unwrap();

    let result = sandbox
        .invoke(InvokeRequest {
            function: "example:function:ctx_test".to_string(),
            event: serde_json::json!({ "amount": 500 }),
            user: None,
            params: serde_json::Value::Null,
            workflow_chain: None,
            timeout_ms: None,
        })
        .unwrap();

    assert_eq!(result["has_event"], serde_json::json!(true));
    assert_eq!(result["amount"], serde_json::json!(500));
}

#[derive(Default)]
struct CapturingChatSender {
    sent: Mutex<Vec<String>>,
}

impl ChatSender for CapturingChatSender {
    fn send_message(&self, text: &str) -> Result<(), String> {
        self.sent.lock().unwrap().push(text.to_string());
        Ok(())
    }
}

#[test]
fn test_ctx_chat_send_message_routes_to_host() {
    let code = r#"function send(ctx) {
    ctx.chat.sendMessage(ctx.event.text);
    return { ok: true };
}"#;

    let registry = Arc::new(ModuleRegistry::new());
    let mut functions = HashMap::new();
    functions.insert(
        "send".to_string(),
        Function::new(
            "send".to_string(),
            "send.js".to_string(),
            code.to_string(),
            false,
        ),
    );
    let module = RegisteredModule {
        metadata: ModuleMetadata {
            name: "chat_test".to_string(),
            version: "1.0.0".to_string(),
            installed_at: 0,
            updated_at: 0,
        },
        functions,
        state: ModuleState::Active,
        event_types: Default::default(),
        permissions: Default::default(),
        url_settings: Default::default(),
        oauth: Default::default(),
    };
    registry
        .register_module("chat_test".to_string(), module)
        .unwrap();

    let capturing = Arc::new(CapturingChatSender::default());
    let mut host_ctx = noop_host_context();
    host_ctx.extensions =
        Arc::new(ExtensionRegistry::new().with(Arc::new(ChatExtension::new(capturing.clone()))));

    let mut sandbox = Sandbox::new(registry, host_ctx).unwrap();
    let result = sandbox
        .invoke(InvokeRequest {
            function: "chat_test:function:send".to_string(),
            event: serde_json::json!({ "text": "hi from sandbox" }),
            user: None,
            params: serde_json::Value::Null,
            workflow_chain: None,
            timeout_ms: None,
        })
        .unwrap();

    assert_eq!(result["ok"], serde_json::json!(true));
    let captured = capturing.sent.lock().unwrap();
    assert_eq!(captured.as_slice(), &["hi from sandbox".to_string()]);
}

#[derive(Default)]
struct CapturingNats {
    published: Mutex<Vec<(String, serde_json::Value)>>,
}

impl NatsPublisher for CapturingNats {
    fn publish(&self, subject: &str, data: serde_json::Value) -> Result<(), String> {
        self.published
            .lock()
            .unwrap()
            .push((subject.to_string(), data));
        Ok(())
    }
}

fn extension_test_module(
    name: &str,
    func_name: &str,
    code: &str,
    ext: &str,
) -> Arc<ModuleRegistry> {
    let registry = Arc::new(ModuleRegistry::new());
    let mut functions = HashMap::new();
    functions.insert(
        func_name.to_string(),
        Function::new(
            func_name.to_string(),
            format!("{}.{}", func_name, ext),
            code.to_string(),
            false,
        ),
    );
    let module = RegisteredModule {
        metadata: ModuleMetadata {
            name: name.to_string(),
            version: "1.0.0".to_string(),
            installed_at: 0,
            updated_at: 0,
        },
        functions,
        state: ModuleState::Active,
        event_types: Default::default(),
        permissions: Default::default(),
        url_settings: Default::default(),
        oauth: Default::default(),
    };
    registry.register_module(name.to_string(), module).unwrap();
    registry
}

/// Stands in for the twitch service: answers every `twitchapi` request with
/// `reply` and records what it was asked.
struct FakeTwitchService {
    reply: Result<serde_json::Value, RequestError>,
    requests: Mutex<Vec<serde_json::Value>>,
}

impl FakeTwitchService {
    fn answering(reply: Result<serde_json::Value, RequestError>) -> Arc<Self> {
        Arc::new(Self {
            reply,
            requests: Mutex::new(Vec::new()),
        })
    }
}

impl NatsRequester for FakeTwitchService {
    fn request(
        &self,
        subject: &str,
        data: serde_json::Value,
        _timeout: Duration,
    ) -> Result<serde_json::Value, RequestError> {
        assert_eq!(subject, "twitchapi");
        self.requests.lock().unwrap().push(data);
        self.reply.clone()
    }
}

/// Runs `code` as a function of module `twitch_test`, which declares
/// `permissions`, against `twitch`.
fn invoke_with_twitch(
    code: &str,
    ext: &str,
    permissions: &[&str],
    twitch: Arc<FakeTwitchService>,
) -> Result<serde_json::Value, String> {
    let registry = extension_test_module("twitch_test", "run", code, ext);
    let mut module = registry
        .list_registered_modules()
        .into_iter()
        .next()
        .unwrap();
    module.permissions = permissions.iter().map(|p| p.to_string()).collect();
    registry
        .update_module("twitch_test".to_string(), module)
        .unwrap();

    let mut host_ctx = noop_host_context();
    host_ctx.extensions =
        Arc::new(ExtensionRegistry::new().with(Arc::new(TwitchExtension::new(twitch))));
    Sandbox::new(registry, host_ctx)
        .unwrap()
        .invoke(InvokeRequest {
            function: "twitch_test:function:run".to_string(),
            event: serde_json::Value::Null,
            user: None,
            params: serde_json::Value::Null,
            workflow_chain: None,
            timeout_ms: None,
        })
        .map_err(|e| e.to_string())
}

fn marker_reply() -> Result<serde_json::Value, RequestError> {
    Ok(serde_json::json!({
        "type": "twitchapi.createMarker.result",
        "source": "twitchapi",
        "data": { "id": "m1", "positionSeconds": 42 }
    }))
}

fn not_live_reply() -> Result<serde_json::Value, RequestError> {
    Ok(serde_json::json!({
        "type": "twitchapi.error",
        "source": "twitchapi",
        "data": { "error": "createMarker: the channel is not live", "code": "not_live" }
    }))
}

#[test]
fn test_quickjs_twitch_call_returns_the_twitch_service_result() {
    let code = r#"function run(ctx) {
    const marker = ctx.twitch.createMarker({ description: "clutch" });
    return { at: marker.positionSeconds };
}"#;
    let twitch = FakeTwitchService::answering(marker_reply());
    let result = invoke_with_twitch(code, "js", &[], twitch.clone()).unwrap();

    assert_eq!(result, serde_json::json!({ "at": 42 }));
    assert_eq!(
        *twitch.requests.lock().unwrap(),
        vec![serde_json::json!({ "command": "createMarker", "args": { "description": "clutch" } })]
    );
}

#[test]
fn test_lua_twitch_call_returns_the_twitch_service_result() {
    let code = r#"
function run(ctx)
    local marker = ctx.twitch.createMarker({ description = "clutch" })
    return { at = marker.positionSeconds }
end
"#;
    let twitch = FakeTwitchService::answering(marker_reply());
    let result = invoke_with_twitch(code, "lua", &[], twitch.clone()).unwrap();

    assert_eq!(result, serde_json::json!({ "at": 42 }));
    assert_eq!(twitch.requests.lock().unwrap().len(), 1);
}

#[test]
fn test_quickjs_twitch_refusal_throws_an_error_with_message_and_code() {
    let code = r#"function run(ctx) {
    try {
        ctx.twitch.createMarker();
        return { threw: false };
    } catch (e) {
        return { threw: e instanceof Error, message: e.message, code: e.code };
    }
}"#;
    let result = invoke_with_twitch(
        code,
        "js",
        &[],
        FakeTwitchService::answering(not_live_reply()),
    )
    .unwrap();
    assert_eq!(
        result,
        serde_json::json!({
            "threw": true,
            "message": "createMarker: the channel is not live",
            "code": "not_live"
        })
    );
}

#[test]
fn test_lua_twitch_refusal_raises_a_table_with_message_and_code() {
    let code = r#"
function run(ctx)
    local ok, err = pcall(ctx.twitch.createMarker)
    return { ok = ok, message = err.message, code = err.code, text = tostring(err) }
end
"#;
    let result = invoke_with_twitch(
        code,
        "lua",
        &[],
        FakeTwitchService::answering(not_live_reply()),
    )
    .unwrap();
    assert_eq!(
        result,
        serde_json::json!({
            "ok": false,
            "message": "createMarker: the channel is not live",
            "code": "not_live",
            "text": "createMarker: the channel is not live"
        })
    );
}

#[test]
fn test_an_uncaught_twitch_refusal_fails_the_invocation_with_its_message() {
    for (code, ext) in [
        (
            "function run(ctx) { ctx.twitch.createMarker(); return {}; }",
            "js",
        ),
        (
            "function run(ctx) ctx.twitch.createMarker() return {} end",
            "lua",
        ),
    ] {
        let err = invoke_with_twitch(
            code,
            ext,
            &[],
            FakeTwitchService::answering(not_live_reply()),
        )
        .unwrap_err();
        assert!(err.contains("the channel is not live"), "{ext}: {err}");
    }
}

#[test]
fn test_a_timeout_throws_with_the_timeout_code() {
    let code = r#"function run(ctx) {
    try { ctx.twitch.clip(); return {}; } catch (e) { return { code: e.code }; }
}"#;
    let result = invoke_with_twitch(
        code,
        "js",
        &[],
        FakeTwitchService::answering(Err(RequestError::TimedOut)),
    )
    .unwrap();
    assert_eq!(result, serde_json::json!({ "code": "timeout" }));
}

#[test]
fn test_privileged_twitch_calls_need_the_manifest_permission() {
    let js = r#"function run(ctx) {
    try {
        ctx.twitch.timeout({ userId: "u1", durationSeconds: 60 });
        return { ok: true };
    } catch (e) {
        return { ok: false, code: e.code, message: e.message };
    }
}"#;
    let lua = r#"
function run(ctx)
    local ok, err = pcall(ctx.twitch.timeout, { userId = "u1", durationSeconds = 60 })
    if ok then
        return { ok = true }
    end
    return { ok = false, code = err.code, message = err.message }
end
"#;
    let reply = || {
        Ok(serde_json::json!({
            "type": "twitchapi.timeout.result",
            "data": { "ok": true, "userId": "u1", "durationSeconds": 60 }
        }))
    };
    for (code, ext) in [(js, "js"), (lua, "lua")] {
        let twitch = FakeTwitchService::answering(reply());
        let refused = invoke_with_twitch(code, ext, &["twitch.channel"], twitch.clone()).unwrap();
        assert_eq!(refused["ok"], serde_json::json!(false), "{ext}");
        assert_eq!(
            refused["code"],
            serde_json::json!("permission_denied"),
            "{ext}"
        );
        assert!(
            refused["message"]
                .as_str()
                .unwrap()
                .contains("twitch.moderation"),
            "{ext}: {refused}"
        );
        assert!(twitch.requests.lock().unwrap().is_empty(), "{ext}");

        let allowed =
            invoke_with_twitch(code, ext, &["twitch.moderation"], twitch.clone()).unwrap();
        assert_eq!(allowed, serde_json::json!({ "ok": true }), "{ext}");
        assert_eq!(twitch.requests.lock().unwrap().len(), 1, "{ext}");
    }
}

/// Test-only extension under a dotted namespace. The runtimes build one
/// nested object (JS) or table (Lua) per namespace segment, so a call like
/// `ctx.demo.nested.ping(args)` must reach this handler.
struct NestedNamespaceExtension {
    functions: Vec<HostFunction>,
}

impl NestedNamespaceExtension {
    fn new(nats: Arc<dyn NatsPublisher>) -> Self {
        let ping = HostFunction::new("ping", move |args: serde_json::Value| {
            nats.publish(
                "demo",
                serde_json::json!({ "command": "ping", "args": args }),
            )?;
            Ok(serde_json::Value::Null)
        });
        Self {
            functions: vec![ping],
        }
    }
}

impl HostExtension for NestedNamespaceExtension {
    fn namespace(&self) -> &str {
        "demo.nested"
    }

    fn functions(&self) -> &[HostFunction] {
        &self.functions
    }
}

fn assert_nested_namespace_call_publishes(module: &str, func_name: &str, code: &str, lang: &str) {
    let registry = extension_test_module(module, func_name, code, lang);

    let nats = Arc::new(CapturingNats::default());
    let mut host_ctx = noop_host_context();
    host_ctx.extensions = Arc::new(
        ExtensionRegistry::new().with(Arc::new(NestedNamespaceExtension::new(nats.clone()))),
    );

    let mut sandbox = Sandbox::new(registry, host_ctx).unwrap();
    sandbox
        .invoke(InvokeRequest {
            function: format!("{module}:function:{func_name}"),
            event: serde_json::Value::Null,
            user: None,
            params: serde_json::Value::Null,
            workflow_chain: None,
            timeout_ms: None,
        })
        .unwrap();

    let published = nats.published.lock().unwrap();
    assert_eq!(published.len(), 1);
    assert_eq!(published[0].0, "demo");
    assert_eq!(
        published[0].1,
        serde_json::json!({
            "command": "ping",
            "args": { "type": "follow", "message": "hi" }
        })
    );
}

#[test]
fn test_quickjs_nested_namespace_extension() {
    let code = r#"function nested_test(ctx) {
    ctx.demo.nested.ping({ type: "follow", message: "hi" });
    return { ok: true };
}"#;
    assert_nested_namespace_call_publishes("nested_test", "nested_test", code, "js");
}

#[test]
fn test_lua_nested_namespace_extension() {
    let code = r#"
function nested_test(ctx)
    ctx.demo.nested.ping({ type = "follow", message = "hi" })
    return { ok = true }
end
"#;
    assert_nested_namespace_call_publishes("nested_test", "nested_test", code, "lua");
}

#[test]
fn test_unregistered_extension_namespace_is_undefined() {
    let code = r#"function probe(ctx) {
    return { has_twitch: typeof ctx.twitch !== "undefined" };
}"#;
    let registry = extension_test_module("noext_test", "probe", code, "js");

    let host_ctx = noop_host_context();
    let mut sandbox = Sandbox::new(registry, host_ctx).unwrap();
    let result = sandbox
        .invoke(InvokeRequest {
            function: "noext_test:function:probe".to_string(),
            event: serde_json::Value::Null,
            user: None,
            params: serde_json::Value::Null,
            workflow_chain: None,
            timeout_ms: None,
        })
        .unwrap();

    assert_eq!(result["has_twitch"], serde_json::json!(false));
}

fn invoke_probe(
    module: &str,
    func: &str,
    code: &str,
    ext: &str,
) -> Result<serde_json::Value, String> {
    let registry = extension_test_module(module, func, code, ext);
    let mut sandbox = Sandbox::new(registry, noop_host_context()).unwrap();
    sandbox
        .invoke(InvokeRequest {
            function: format!("{module}:function:{func}"),
            event: serde_json::Value::Null,
            user: None,
            params: serde_json::Value::Null,
            workflow_chain: None,
            timeout_ms: None,
        })
        .map_err(|e| e.to_string())
}

// RFC 4231 test case 2, HMAC-SHA256.
const JEFE_HMAC_SHA256: &str = "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843";

#[test]
fn test_quickjs_binds_ctx_crypto_and_no_ctx_events() {
    let code = r#"function check(ctx) {
    return {
        hmac: ctx.crypto.hmac("sha256", "Jefe", "what do ya want for nothing?"),
        same: ctx.crypto.timingSafeEqual("a", "a"),
        hasEvents: typeof ctx.events !== "undefined"
    };
}"#;
    let result = invoke_probe("crypto_test", "check", code, "js").unwrap();

    assert_eq!(result["hmac"], serde_json::json!(JEFE_HMAC_SHA256));
    assert_eq!(result["same"], serde_json::json!(true));
    assert_eq!(result["hasEvents"], serde_json::json!(false));
}

#[test]
fn test_lua_binds_ctx_crypto_and_no_ctx_events() {
    let code = r#"
function check(ctx)
    return {
        hmac = ctx.crypto.hmac("sha256", "Jefe", "what do ya want for nothing?"),
        same = ctx.crypto.timingSafeEqual("a", "a"),
        hasEvents = ctx.events ~= nil
    }
end
"#;
    let result = invoke_probe("crypto_test", "check", code, "lua").unwrap();

    assert_eq!(result["hmac"], serde_json::json!(JEFE_HMAC_SHA256));
    assert_eq!(result["same"], serde_json::json!(true));
    assert_eq!(result["hasEvents"], serde_json::json!(false));
}

// The adapter reports any uncaught exception as a generic error, so the
// message is checked where a module author would see it: inside the catch.
#[test]
fn test_quickjs_ctx_crypto_throws_for_an_unknown_algorithm() {
    let code = r#"function check(ctx) {
    try {
        ctx.crypto.hmac("md5", "key", "data");
        return { threw: false };
    } catch (e) {
        return { threw: true, message: String(e && e.message ? e.message : e) };
    }
}"#;
    let result = invoke_probe("crypto_test", "check", code, "js").unwrap();

    assert_eq!(result["threw"], serde_json::json!(true));
    let message = result["message"].as_str().unwrap_or_default();
    assert!(message.contains("md5"), "names the algorithm: {message}");
}

/// A registry holding one function of a module that declares one eventbus
/// trigger, `thing.happened`.
fn announcing_module(func_name: &str, code: &str, ext: &str) -> Arc<ModuleRegistry> {
    let registry = extension_test_module("announcer", func_name, code, ext);
    let mut module = registry
        .list_registered_modules()
        .into_iter()
        .next()
        .unwrap();
    module.event_types = ["thing.happened".to_string()].into_iter().collect();
    registry
        .update_module("announcer".to_string(), module)
        .unwrap();
    registry
}

fn invoke_announcer(
    registry: Arc<ModuleRegistry>,
    func_name: &str,
    workflow_chain: Option<&str>,
) -> (Result<serde_json::Value, String>, Arc<CapturingNats>) {
    let nats = Arc::new(CapturingNats::default());
    let mut host_ctx = noop_host_context();
    host_ctx.nats = nats.clone();
    let result = Sandbox::new(registry, host_ctx)
        .unwrap()
        .invoke(InvokeRequest {
            function: format!("announcer:function:{func_name}"),
            event: serde_json::Value::Null,
            user: None,
            params: serde_json::Value::Null,
            workflow_chain: workflow_chain.map(String::from),
            timeout_ms: None,
        })
        .map_err(|err| err.to_string());
    (result, nats)
}

#[test]
fn test_ctx_result_publishes_declared_events_and_returns_only_the_value() {
    for (code, ext) in [
        (
            r#"function run(ctx) { return ctx.result({ n: 1 }, [{ type: "thing.happened", data: { n: 1 } }]); }"#,
            "js",
        ),
        (
            r#"function run(ctx) return ctx.result({ n = 1 }, { { type = "thing.happened", data = { n = 1 } } }) end"#,
            "lua",
        ),
    ] {
        let (result, nats) = invoke_announcer(announcing_module("run", code, ext), "run", None);
        assert_eq!(result.unwrap(), serde_json::json!({ "n": 1 }), "{ext}");

        let published = nats.published.lock().unwrap();
        assert_eq!(published.len(), 1, "{ext}");
        let (subject, envelope) = &published[0];
        assert_eq!(subject, "thing.happened");
        assert_eq!(envelope["type"], "thing.happened");
        assert_eq!(envelope["source"], "module/announcer");
        assert_eq!(envelope["data"], serde_json::json!({ "n": 1 }));
    }
}

#[test]
fn test_ctx_result_with_an_undeclared_event_fails_and_publishes_nothing() {
    let code =
        r#"function run(ctx) { return ctx.result(null, [{ type: "channel.cheer", data: {} }]); }"#;
    let (result, nats) = invoke_announcer(announcing_module("run", code, "js"), "run", None);
    let err = result.unwrap_err();
    assert!(err.contains("not an eventbus trigger"), "{err}");
    assert!(nats.published.lock().unwrap().is_empty());
}

// How the workflow engine sees a loop that runs through a module function: the
// function's events carry the chain of runs that called it.
#[test]
fn test_ctx_result_events_carry_the_calling_workflow_chain() {
    let code = r#"function run(ctx) { return ctx.result(null, [{ type: "thing.happened" }]); }"#;
    let (result, nats) = invoke_announcer(
        announcing_module("run", code, "js"),
        "run",
        Some("wf-a,wf-b"),
    );
    result.unwrap();
    assert_eq!(
        nats.published.lock().unwrap()[0].1["workflowChain"],
        "wf-a,wf-b"
    );

    let (_, nats) = invoke_announcer(announcing_module("run", code, "js"), "run", None);
    let published = nats.published.lock().unwrap();
    assert!(
        published[0].1.get("workflowChain").is_none(),
        "an event no workflow caused starts no chain"
    );
}

/// Records the grants each `ctx.http` request carries, and answers 200.
struct RecordingHttp {
    grants: Mutex<Vec<std::collections::HashSet<String>>>,
}

impl lib_sandbox::host::HttpClient for RecordingHttp {
    fn request(
        &self,
        request: lib_sandbox::host::HttpRequest<'_>,
    ) -> Result<serde_json::Value, String> {
        self.grants.lock().unwrap().push(request.grants.clone());
        Ok(serde_json::json!({ "status": 200, "body": null }))
    }
}

struct FixedSettings(HashMap<String, serde_json::Value>);

impl lib_sandbox::host::SettingsClient for FixedSettings {
    fn list_by_module(
        &self,
        _module_id: &str,
    ) -> Result<HashMap<String, serde_json::Value>, String> {
        Ok(self.0.clone())
    }
    fn set(&self, _module_id: &str, _key: &str, _value: &str) -> Result<(), String> {
        Ok(())
    }
}

#[test]
fn a_url_settings_origin_is_granted_to_the_invocation() {
    let registry = Arc::new(ModuleRegistry::new());
    let mut functions = HashMap::new();
    functions.insert(
        "call".to_string(),
        Function::new(
            "call".to_string(),
            "call.js".to_string(),
            r#"function call(ctx) { ctx.http.request(ctx.module.settings.server, "GET", {}); return {}; }"#
                .to_string(),
            false,
        ),
    );
    registry
        .register_module(
            "homeassistant".to_string(),
            RegisteredModule {
                metadata: ModuleMetadata {
                    name: "homeassistant".to_string(),
                    version: "1.0.0".to_string(),
                    installed_at: 0,
                    updated_at: 0,
                },
                functions,
                state: ModuleState::Active,
                event_types: Default::default(),
                permissions: ["net:api.example.com".to_string()].into(),
                url_settings: ["server".to_string()].into(),
                oauth: Default::default(),
            },
        )
        .unwrap();

    let http = Arc::new(RecordingHttp {
        grants: Mutex::new(Vec::new()),
    });
    let mut host = noop_host_context();
    host.http = http.clone();
    host.settings = Arc::new(FixedSettings(HashMap::from([(
        "server".to_string(),
        serde_json::json!("http://homeassistant.local:8123/api/states"),
    )])));
    let mut sandbox = Sandbox::new(registry, host).unwrap();

    sandbox
        .invoke(InvokeRequest {
            function: "homeassistant:function:call".to_string(),
            event: serde_json::Value::Null,
            user: None,
            params: serde_json::Value::Null,
            workflow_chain: None,
            timeout_ms: None,
        })
        .unwrap();

    let grants = http.grants.lock().unwrap();
    let expected: std::collections::HashSet<String> = [
        "net:api.example.com".to_string(),
        "origin:http://homeassistant.local:8123".to_string(),
    ]
    .into();
    assert_eq!(grants.as_slice(), &[expected]);
}
