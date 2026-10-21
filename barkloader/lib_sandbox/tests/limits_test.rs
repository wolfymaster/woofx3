//! What module code can reach from inside the sandbox, exercised through the
//! public `Sandbox::invoke` path a real module function takes.

use lib_sandbox::host::noop::noop_host_context;
use lib_sandbox::models::function::Function;
use lib_sandbox::models::request::InvokeRequest;
use lib_sandbox::{
    Error, ModuleMetadata, ModuleRegistry, ModuleState, RegisteredModule, Sandbox, SizeLimit,
};
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

/// The two runtimes a module function can be written for, with the same
/// value-shaping snippets spelled in each language.
#[derive(Debug, Clone, Copy)]
enum Runtime {
    Js,
    Lua,
}

const RUNTIMES: [Runtime; 2] = [Runtime::Js, Runtime::Lua];

impl Runtime {
    fn file_name(self) -> &'static str {
        match self {
            Runtime::Js => "run.js",
            Runtime::Lua => "run.lua",
        }
    }

    /// A `run` entry point that executes `build` (which binds a local `v`),
    /// then `body`.
    fn function(self, build: &str, body: &str) -> String {
        match self {
            Runtime::Js => format!("function run(ctx) {{ {build} {body} }}"),
            Runtime::Lua => format!("function run(ctx) {build} {body} end"),
        }
    }

    /// Statements binding `v` to an object nested `depth` containers deep.
    fn build_nested(self, depth: usize) -> String {
        match self {
            Runtime::Js => {
                format!("let v = {{}}; for (let i = 1; i < {depth}; i++) {{ v = {{ v: v }}; }}")
            }
            Runtime::Lua => {
                format!("local v = {{}}; for i = 2, {depth} do v = {{ v = v }} end")
            }
        }
    }

    /// Statements binding `v` to an object that contains itself.
    fn build_cyclic(self) -> &'static str {
        match self {
            Runtime::Js => "const v = {}; v.self = v;",
            Runtime::Lua => "local v = {}; v.self = v;",
        }
    }

    /// Statements binding `v` to an array of `len` numbers.
    fn build_wide(self, len: usize) -> String {
        match self {
            Runtime::Js => format!("const v = new Array({len}).fill(0);"),
            Runtime::Lua => format!("local v = {{}}; for i = 1, {len} do v[i] = 0 end"),
        }
    }

    /// Statements binding `v` to an object holding a `bytes`-long string.
    fn build_long_text(self, bytes: usize) -> String {
        match self {
            Runtime::Js => format!("const v = {{ text: 'x'.repeat({bytes}) }};"),
            // `string` is not a sandbox global, so double up to the length.
            Runtime::Lua => format!(
                "local s = 'x'; while #s * 2 <= {bytes} do s = s .. s end; \
                 while #s < {bytes} do s = s .. 'x' end; local v = {{ text = s }};"
            ),
        }
    }

    fn returning(self) -> &'static str {
        match self {
            Runtime::Js => "return v;",
            Runtime::Lua => "return v",
        }
    }

    fn invoke(self, build: &str, body: &str) -> Result<Value, Error> {
        invoke(self.file_name(), &self.function(build, body), Value::Null)
    }
}

fn assert_too_deep(runtime: Runtime, case: &str, result: Result<Value, Error>) {
    assert!(
        matches!(result, Err(Error::ValueTooDeep { max_depth: 64 })),
        "{runtime:?} {case}: {result:?}"
    );
}

#[test]
fn test_returned_value_depth_is_bounded() {
    for runtime in RUNTIMES {
        let at_limit = runtime.invoke(&runtime.build_nested(64), runtime.returning());
        assert!(at_limit.is_ok(), "{runtime:?} 64 deep: {at_limit:?}");

        for (case, build) in [
            ("65 deep", runtime.build_nested(65)),
            ("100k deep", runtime.build_nested(100_000)),
            ("cyclic", runtime.build_cyclic().to_string()),
        ] {
            assert_too_deep(runtime, case, runtime.invoke(&build, runtime.returning()));
        }
    }
}

#[test]
fn test_lua_200k_deep_table_is_refused() {
    let runtime = Runtime::Lua;
    let result = runtime.invoke(&runtime.build_nested(200_000), runtime.returning());
    assert_too_deep(runtime, "200k deep", result);
}

#[test]
fn test_returned_value_size_is_bounded() {
    for runtime in RUNTIMES {
        let result = runtime.invoke(&runtime.build_wide(100_001), runtime.returning());
        assert!(
            matches!(
                result,
                Err(Error::ValueTooLarge {
                    limit: SizeLimit::Nodes(100_000)
                })
            ),
            "{runtime:?} wide: {result:?}"
        );

        let result = runtime.invoke(
            &runtime.build_long_text(4 * 1024 * 1024 + 1),
            runtime.returning(),
        );
        assert!(
            matches!(
                result,
                Err(Error::ValueTooLarge {
                    limit: SizeLimit::Bytes(4_194_304)
                })
            ),
            "{runtime:?} long text: {result:?}"
        );
    }
}

#[test]
fn test_cyclic_binding_argument_is_refused_inside_the_script() {
    for runtime in RUNTIMES {
        let body = match runtime {
            Runtime::Js => "return ctx.result(v, []);",
            Runtime::Lua => "return ctx.result(v, {})",
        };
        let err = runtime
            .invoke(runtime.build_cyclic(), body)
            .expect_err("a cyclic ctx.result value must be refused");
        let message = err.to_string();
        assert!(
            message.contains("value nests deeper than 64 levels"),
            "{runtime:?}: {message}"
        );
    }
}

#[test]
fn test_cyclic_log_argument_is_logged_as_unloggable() {
    for runtime in RUNTIMES {
        let body = match runtime {
            Runtime::Js => "ctx.log.info(v); return { logged: true };",
            Runtime::Lua => "ctx.log.info(v); return { logged = true }",
        };
        let result = runtime.invoke(runtime.build_cyclic(), body);
        assert_eq!(
            result.expect("logging a cyclic value still runs"),
            json!({ "logged": true }),
            "{runtime:?}"
        );
    }
}

#[test]
fn test_js_thrown_cyclic_value_is_described_not_walked() {
    let err = Runtime::Js
        .invoke(Runtime::Js.build_cyclic(), "throw v;")
        .expect_err("the throw fails the invocation");
    let message = err.to_string();
    assert!(
        matches!(err, Error::RuntimeError(_)) && message.contains("deeper than 64 levels"),
        "{message}"
    );
}

#[test]
fn test_js_async_entry_point_is_refused() {
    for code in [
        "async function run(ctx) { return { hello: 1 }; }",
        "async function run(ctx) { throw new Error('nope'); }",
    ] {
        let result = invoke("run.js", code, Value::Null);
        assert!(
            matches!(result, Err(Error::AsyncEntryUnsupported)),
            "{code}: {result:?}"
        );
    }
}

#[test]
fn test_lua_values_without_a_json_form_are_refused() {
    for (case, code, type_name) in [
        (
            "function",
            "function run(ctx) return { f = function() end } end",
            "function",
        ),
        (
            "boolean key",
            "function run(ctx) return { [true] = 1 } end",
            "table key of type boolean",
        ),
    ] {
        let result = invoke_lua(code);
        assert!(
            matches!(&result, Err(Error::UnsupportedValue { type_name: t }) if t == type_name),
            "{case}: {result:?}"
        );
    }
}

#[test]
fn test_lua_tables_convert_to_arrays_and_objects() {
    for (case, code, expected) in [
        (
            "sequence",
            "function run(ctx) return { list = { 1, 2, 3 } } end",
            json!({ "list": [1, 2, 3] }),
        ),
        (
            "empty table",
            "function run(ctx) return { empty = {} } end",
            json!({ "empty": {} }),
        ),
        (
            "mixed keys",
            "function run(ctx) return { 'a', x = 1 } end",
            json!({ "1": "a", "x": 1 }),
        ),
        (
            "sparse",
            "function run(ctx) return { [1] = 'a', [3] = 'c' } end",
            json!({ "1": "a", "3": "c" }),
        ),
        (
            "float and non-finite",
            "function run(ctx) return { half = 0.5, inf = 1/0 } end",
            json!({ "half": 0.5, "inf": null }),
        ),
    ] {
        let result = invoke_lua(code).unwrap_or_else(|err| panic!("{case}: {err}"));
        assert_eq!(result, expected, "{case}");
    }
}

#[test]
fn test_lua_event_round_trips_empty_arrays_and_nulls() {
    let event = json!({ "items": [], "missing": null, "nested": { "list": [1] } });
    let result = invoke(
        "run.lua",
        "function run(ctx) return ctx.event end",
        event.clone(),
    )
    .expect("event round-trips");
    assert_eq!(result, event);
}
