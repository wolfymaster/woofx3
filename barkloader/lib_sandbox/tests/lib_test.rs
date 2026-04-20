use lib_sandbox::host::noop::noop_host_context;
use lib_sandbox::host::ChatSender;
use lib_sandbox::models::function::Function;
use lib_sandbox::models::request::InvokeRequest;
use lib_sandbox::{ModuleMetadata, ModuleRegistry, ModuleState, RegisteredModule, Sandbox};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

fn build_registry() -> Arc<ModuleRegistry> {
    let registry = Arc::new(ModuleRegistry::new());

    let test_dir = std::env::current_dir().unwrap().join("tests/modules/example");

    let mut functions = HashMap::new();

    let echo_code = std::fs::read_to_string(test_dir.join("example.echo")).unwrap();
    functions.insert(
        "example".to_string(),
        Function::new("example".to_string(), "example.echo".to_string(), echo_code, false),
    );

    let lua_code = std::fs::read_to_string(test_dir.join("helloworld.lua")).unwrap();
    functions.insert(
        "helloworld".to_string(),
        Function::new("helloworld".to_string(), "helloworld.lua".to_string(), lua_code, false),
    );

    let js_code = std::fs::read_to_string(test_dir.join("sayhello.js")).unwrap();
    functions.insert(
        "sayhello".to_string(),
        Function::new("sayhello".to_string(), "sayhello.js".to_string(), js_code, false),
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
    };

    registry.register_module("example".to_string(), module).unwrap();
    registry
}

fn test_sandbox_instance() -> Sandbox {
    let registry = build_registry();
    Sandbox::new(registry, noop_host_context()).unwrap()
}

#[test]
fn test_sandbox() {
    let sandbox = test_sandbox_instance();

    let result = sandbox
        .invoke(InvokeRequest {
            function: "example/example".to_string(),
            event: serde_json::json!({ "input": "test" }),
            user: None,
        })
        .unwrap();

    assert_eq!(
        result["code"],
        serde_json::json!("// This file is intentionally empty")
    );
    assert_eq!(
        result["event"],
        serde_json::json!({ "input": "test" })
    );
}

#[test]
fn test_lua_adapter() {
    let sandbox = test_sandbox_instance();

    let result = sandbox
        .invoke(InvokeRequest {
            function: "example/helloworld".to_string(),
            event: serde_json::json!({ "name": "wolfy" }),
            user: None,
        })
        .unwrap();

    assert_eq!(result["response"], serde_json::json!("Hello wolfy"));
}

#[test]
fn test_quickjs_adapter() {
    let sandbox = test_sandbox_instance();

    let result = sandbox
        .invoke(InvokeRequest {
            function: "example/sayhello".to_string(),
            event: serde_json::json!({ "name": "wolfy" }),
            user: None,
        })
        .unwrap();

    assert_eq!(result["response"], serde_json::json!("Hello wolfy"));
}

#[test]
fn test_null_event() {
    let sandbox = test_sandbox_instance();

    let result = sandbox
        .invoke(InvokeRequest {
            function: "example/sayhello".to_string(),
            event: serde_json::Value::Null,
            user: None,
        })
        .unwrap();

    assert_eq!(result["response"], serde_json::json!("Hello World"));
}

#[test]
fn test_js_instruction_limit() {
    let registry = build_registry();
    let code = r#"function main(ctx) { while(true) {} }"#;

    let mut functions = HashMap::new();
    functions.insert(
        "infinite".to_string(),
        Function::new("infinite".to_string(), "infinite.js".to_string(), code.to_string(), false),
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
    };

    registry.register_module("limits".to_string(), module).unwrap();

    let sandbox = Sandbox::new(registry, noop_host_context()).unwrap();

    let result = sandbox.invoke(InvokeRequest {
        function: "limits/infinite".to_string(),
        event: serde_json::Value::Null,
        user: None,
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
function main(ctx) {
    counter += 1;
    return { count: counter };
}
"#;

    let registry = Arc::new(ModuleRegistry::new());

    let mut functions = HashMap::new();
    functions.insert(
        "isolation".to_string(),
        Function::new("isolation".to_string(), "isolation.js".to_string(), code.to_string(), false),
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
    };

    registry.register_module("example".to_string(), module).unwrap();

    let sandbox = Sandbox::new(registry, noop_host_context()).unwrap();

    let result1 = sandbox
        .invoke(InvokeRequest {
            function: "example/isolation".to_string(),
            event: serde_json::Value::Null,
            user: None,
        })
        .unwrap();

    let result2 = sandbox
        .invoke(InvokeRequest {
            function: "example/isolation".to_string(),
            event: serde_json::Value::Null,
            user: None,
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
    let code = r#"function main(ctx) {
    return {
        has_event: ctx.event !== null && ctx.event !== undefined,
        amount: ctx.event ? ctx.event.amount : 0,
    };
}"#;

    let registry = Arc::new(ModuleRegistry::new());

    let mut functions = HashMap::new();
    functions.insert(
        "ctx_test".to_string(),
        Function::new("ctx_test".to_string(), "ctx_test.js".to_string(), code.to_string(), false),
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
    };

    registry.register_module("example".to_string(), module).unwrap();

    let sandbox = Sandbox::new(registry, noop_host_context()).unwrap();

    let result = sandbox
        .invoke(InvokeRequest {
            function: "example/ctx_test".to_string(),
            event: serde_json::json!({ "amount": 500 }),
            user: None,
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
    let code = r#"function main(ctx) {
    ctx.chat.sendMessage(ctx.event.text);
    return { ok: true };
}"#;

    let registry = Arc::new(ModuleRegistry::new());
    let mut functions = HashMap::new();
    functions.insert(
        "send".to_string(),
        Function::new("send".to_string(), "send.js".to_string(), code.to_string(), false),
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
    };
    registry.register_module("chat_test".to_string(), module).unwrap();

    let capturing = Arc::new(CapturingChatSender::default());
    let mut host_ctx = noop_host_context();
    host_ctx.chat = capturing.clone();

    let sandbox = Sandbox::new(registry, host_ctx).unwrap();
    let result = sandbox
        .invoke(InvokeRequest {
            function: "chat_test/send".to_string(),
            event: serde_json::json!({ "text": "hi from sandbox" }),
            user: None,
        })
        .unwrap();

    assert_eq!(result["ok"], serde_json::json!(true));
    let captured = capturing.sent.lock().unwrap();
    assert_eq!(captured.as_slice(), &["hi from sandbox".to_string()]);
}
