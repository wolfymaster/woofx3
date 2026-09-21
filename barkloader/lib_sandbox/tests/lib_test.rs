use lib_sandbox::extensions::{ChatExtension, PlatformAlertsExtension, TwitchExtension};
use lib_sandbox::host::noop::noop_host_context;
use lib_sandbox::host::{ChatSender, ExtensionRegistry, NatsPublisher};
use lib_sandbox::models::function::Function;
use lib_sandbox::models::request::InvokeRequest;
use lib_sandbox::{ModuleMetadata, ModuleRegistry, ModuleState, RegisteredModule, Sandbox};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

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
        })
        .unwrap();

    let result2 = sandbox
        .invoke(InvokeRequest {
            function: "example:function:isolation".to_string(),
            event: serde_json::Value::Null,
            user: None,
            params: serde_json::Value::Null,
            workflow_chain: None,
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
    };
    registry.register_module(name.to_string(), module).unwrap();
    registry
}

#[test]
fn test_quickjs_twitch_extension_publishes_canonical_command() {
    let code = r#"function moderate(ctx) {
    ctx.twitch.addModerator({ userId: "u1" });
    return { ok: true };
}"#;
    let registry = extension_test_module("twitch_test", "moderate", code, "js");

    let nats = Arc::new(CapturingNats::default());
    let mut host_ctx = noop_host_context();
    host_ctx.nats = nats.clone();
    host_ctx.extensions =
        Arc::new(ExtensionRegistry::new().with(Arc::new(TwitchExtension::new(nats.clone()))));

    let mut sandbox = Sandbox::new(registry, host_ctx).unwrap();
    sandbox
        .invoke(InvokeRequest {
            function: "twitch_test:function:moderate".to_string(),
            event: serde_json::Value::Null,
            user: None,
            params: serde_json::Value::Null,
            workflow_chain: None,
        })
        .unwrap();

    let published = nats.published.lock().unwrap();
    assert_eq!(published.len(), 1);
    assert_eq!(published[0].0, "twitchapi");
    assert_eq!(
        published[0].1,
        serde_json::json!({
            "command": "addChannelModerator",
            "args": { "userId": "u1" }
        })
    );
}

#[test]
fn test_lua_twitch_extension_publishes_canonical_command() {
    let code = r#"
function moderate(ctx)
    ctx.twitch.addModerator({ userId = "u1" })
    return { ok = true }
end
"#;
    let registry = extension_test_module("twitch_test", "moderate", code, "lua");

    let nats = Arc::new(CapturingNats::default());
    let mut host_ctx = noop_host_context();
    host_ctx.nats = nats.clone();
    host_ctx.extensions =
        Arc::new(ExtensionRegistry::new().with(Arc::new(TwitchExtension::new(nats.clone()))));

    let mut sandbox = Sandbox::new(registry, host_ctx).unwrap();
    sandbox
        .invoke(InvokeRequest {
            function: "twitch_test:function:moderate".to_string(),
            event: serde_json::Value::Null,
            user: None,
            params: serde_json::Value::Null,
            workflow_chain: None,
        })
        .unwrap();

    let published = nats.published.lock().unwrap();
    assert_eq!(published.len(), 1);
    assert_eq!(published[0].0, "twitchapi");
    assert_eq!(
        published[0].1,
        serde_json::json!({
            "command": "addChannelModerator",
            "args": { "userId": "u1" }
        })
    );
}

#[test]
fn test_quickjs_zero_arg_extension_function() {
    let code = r#"function clip_test(ctx) {
    ctx.twitch.clip();
    return { ok: true };
}"#;
    let registry = extension_test_module("twitch_test", "clip_test", code, "js");

    let nats = Arc::new(CapturingNats::default());
    let mut host_ctx = noop_host_context();
    host_ctx.extensions =
        Arc::new(ExtensionRegistry::new().with(Arc::new(TwitchExtension::new(nats.clone()))));

    let mut sandbox = Sandbox::new(registry, host_ctx).unwrap();
    sandbox
        .invoke(InvokeRequest {
            function: "twitch_test:function:clip_test".to_string(),
            event: serde_json::Value::Null,
            user: None,
            params: serde_json::Value::Null,
            workflow_chain: None,
        })
        .unwrap();

    let published = nats.published.lock().unwrap();
    assert_eq!(published.len(), 1);
    assert_eq!(published[0].0, "twitchapi");
    assert_eq!(published[0].1, serde_json::json!({ "command": "clip" }));
}

#[test]
fn test_quickjs_nested_namespace_platform_alerts() {
    let code = r#"function alert_test(ctx) {
    ctx.platform.alerts.alert({ type: "follow", message: "hi" });
    return { ok: true };
}"#;
    let registry = extension_test_module("alerts_test", "alert_test", code, "js");

    let nats = Arc::new(CapturingNats::default());
    let mut host_ctx = noop_host_context();
    host_ctx.extensions = Arc::new(
        ExtensionRegistry::new().with(Arc::new(PlatformAlertsExtension::new(nats.clone()))),
    );

    let mut sandbox = Sandbox::new(registry, host_ctx).unwrap();
    sandbox
        .invoke(InvokeRequest {
            function: "alerts_test:function:alert_test".to_string(),
            event: serde_json::Value::Null,
            user: None,
            params: serde_json::Value::Null,
            workflow_chain: None,
        })
        .unwrap();

    let published = nats.published.lock().unwrap();
    assert_eq!(published.len(), 1);
    assert_eq!(published[0].0, "slobs");
    assert_eq!(
        published[0].1,
        serde_json::json!({
            "command": "alert_message",
            "args": { "type": "follow", "message": "hi" }
        })
    );
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
