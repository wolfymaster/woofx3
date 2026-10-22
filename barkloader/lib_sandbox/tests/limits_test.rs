//! What module code can reach from inside the sandbox, exercised through the
//! public `Sandbox::invoke` path a real module function takes.

use lib_sandbox::host::noop::noop_host_context;
use lib_sandbox::models::function::Function;
use lib_sandbox::models::request::InvokeRequest;
use lib_sandbox::{Error, ModuleMetadata, ModuleRegistry, ModuleState, RegisteredModule, Sandbox};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Arc;

const MODULE_ID: &str = "limits";

/// Registers `code` as the only function of a fresh module and invokes its
/// `run` entry point with `event`.
fn invoke(file_name: &str, code: &str, event: Value) -> Result<Value, Error> {
    let registry = Arc::new(ModuleRegistry::new());
    let mut functions = HashMap::new();
    functions.insert(
        "run".to_string(),
        Function::new(
            "run".to_string(),
            file_name.to_string(),
            code.to_string(),
            false,
        ),
    );
    let module = RegisteredModule {
        actions: Default::default(),
        metadata: ModuleMetadata {
            name: MODULE_ID.to_string(),
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
        .register_module(MODULE_ID.to_string(), module)
        .expect("register test module");

    let mut sandbox = Sandbox::new(registry, noop_host_context()).expect("build sandbox");
    sandbox.invoke(InvokeRequest {
        function: format!("{MODULE_ID}:function:run"),
        event,
        user: None,
        params: Value::Null,
        workflow_chain: None,
        timeout_ms: None,
    })
}

fn invoke_lua(code: &str) -> Result<Value, Error> {
    invoke("run.lua", code, Value::Null)
}

#[test]
fn test_lua_globals_outside_the_allow_list_are_nil() {
    let removed = [
        "dofile",
        "loadfile",
        "load",
        "loadstring",
        "print",
        "collectgarbage",
        "require",
        "warn",
        "io",
        "os",
        "package",
        "debug",
        "string",
        "coroutine",
    ];
    for name in removed {
        let code = format!("function run(ctx) return {{ kind = type({name}) }} end");
        let result = invoke_lua(&code).unwrap_or_else(|err| panic!("{name}: {err}"));
        assert_eq!(
            result,
            json!({ "kind": "nil" }),
            "global `{name}` is reachable"
        );
    }
}

#[test]
fn test_lua_allowed_globals_stay_reachable() {
    let code = r#"
        function run(ctx)
            local seen = {}
            for name, _ in pairs(_G) do
                seen[#seen + 1] = name
            end
            return { count = #seen, version = type(_VERSION), pcall = type(pcall) }
        end
    "#;
    let result = invoke_lua(code).expect("allowed globals run");
    assert_eq!(result["version"], json!("string"));
    assert_eq!(result["pcall"], json!("function"));
    // The allow-list plus the module's own `run`.
    assert_eq!(result["count"], json!(20));
}

#[test]
fn test_lua_dofile_cannot_read_host_files() {
    let code = r#"
        function run(ctx)
            local ok, err = pcall(dofile, "/etc/hostname")
            return { ok = ok, err = tostring(err) }
        end
    "#;
    let result = invoke_lua(code).expect("pcall contains the failure");
    assert_eq!(result["ok"], json!(false));
    let err = result["err"].as_str().expect("error message");
    assert!(!err.contains("/etc/hostname"), "{err}");
    assert!(err.contains("nil"), "{err}");
}

#[test]
fn test_lua_load_is_absent() {
    let code = r#"
        function run(ctx)
            local ok = pcall(function() return load("return 1") end)
            return { ok = ok }
        end
    "#;
    let result = invoke_lua(code).expect("pcall contains the failure");
    assert_eq!(result, json!({ "ok": false }));
}

#[test]
fn test_lua_binary_chunk_module_source_is_refused() {
    // Lua refuses on the signature byte before parsing the header, so the
    // rest of a real chunk is not needed.
    let code = "\x1bLua\x54\x00";
    let err = invoke_lua(code).expect_err("binary chunk must be refused");
    assert!(
        matches!(
            &err,
            Error::LuaError(mlua::Error::SyntaxError { message, .. })
                if message.contains("binary chunk")
        ),
        "unexpected error: {err:?}"
    );
}

#[test]
fn test_lua_bundled_style_module_still_runs() {
    let code = r#"
        local function greeting(name)
            return "Hello " .. name
        end

        function run(ctx)
            local name = ctx.event and ctx.event.name or "World"
            local ok, err = pcall(error, { message = "caught" })
            ctx.log.info("greeting " .. name)
            return {
                response = greeting(name),
                caught = (not ok) and err.message or "missed",
                number = tonumber("42"),
            }
        end
    "#;
    let result = invoke("run.lua", code, json!({ "name": "wolfy" })).expect("module runs");
    assert_eq!(
        result,
        json!({ "response": "Hello wolfy", "caught": "caught", "number": 42 })
    );
}
