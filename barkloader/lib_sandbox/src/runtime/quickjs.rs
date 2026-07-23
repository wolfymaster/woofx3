use crate::error::Error;
use crate::host::InvocationContext;
use crate::runtime::RuntimeAdapter;
use rquickjs::{
    Array, Context, Ctx, Function as JsFunction, Object, Runtime,
    Value as JsValue,
    function::Opt,
};
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

const DEFAULT_MEMORY_LIMIT: usize = 16 * 1024 * 1024;
const DEFAULT_MAX_STACK_SIZE: usize = 1024 * 1024;
const DEFAULT_MAX_INSTRUCTIONS: u64 = 100_000;

fn host_err(msg: impl Into<String>) -> rquickjs::Error {
    rquickjs::Error::new_from_js_message("host", "value", msg.into())
}

pub struct QuickJSAdapter {
    runtime: Runtime,
    instruction_counter: Arc<AtomicU64>,
}

impl QuickJSAdapter {
    pub fn new() -> Result<Self, Error> {
        let runtime =
            Runtime::new().map_err(|e| Error::RuntimeError(format!("QuickJS runtime init: {e}")))?;
        runtime.set_memory_limit(DEFAULT_MEMORY_LIMIT);
        runtime.set_max_stack_size(DEFAULT_MAX_STACK_SIZE);

        let counter = Arc::new(AtomicU64::new(0));
        let counter_clone = counter.clone();
        runtime.set_interrupt_handler(Some(Box::new(move || {
            counter_clone.fetch_add(1, Ordering::Relaxed) >= DEFAULT_MAX_INSTRUCTIONS
        })));

        Ok(Self {
            runtime,
            instruction_counter: counter,
        })
    }
}

impl RuntimeAdapter for QuickJSAdapter {
    fn execute(
        &self,
        code: &str,
        entry_point: &str,
        invocation: &InvocationContext,
    ) -> Result<Value, Error> {
        self.instruction_counter.store(0, Ordering::Relaxed);

        let context = Context::full(&self.runtime)
            .map_err(|e| Error::RuntimeError(format!("context creation: {e}")))?;

        let max_instructions = DEFAULT_MAX_INSTRUCTIONS;
        let counter = self.instruction_counter.clone();

        context.with(|ctx| {
            ctx.eval::<(), _>(code)
                .map_err(|e| to_sandbox_error(&counter, max_instructions, e))?;

            let globals = ctx.globals();
            let func: JsFunction = globals.get(entry_point).map_err(|e| {
                Error::RuntimeError(format!("entry point '{entry_point}' not found: {e}"))
            })?;

            let ctx_obj = build_ctx_object(&ctx, invocation)?;

            let result: JsValue = func
                .call((ctx_obj,))
                .map_err(|e| to_sandbox_error(&counter, max_instructions, e))?;

            if result.is_null() || result.is_undefined() {
                return Err(Error::RuntimeError(format!(
                    "entry point '{entry_point}' returned no value (expected an object)"
                )));
            }

            js_to_json(&result)
        })
    }
}

fn to_sandbox_error(
    counter: &AtomicU64,
    max_instructions: u64,
    e: rquickjs::Error,
) -> Error {
    if counter.load(Ordering::Relaxed) >= max_instructions {
        Error::InstructionLimitExceeded
    } else {
        Error::RuntimeError(e.to_string())
    }
}

fn json_to_js<'js>(ctx: &Ctx<'js>, value: &Value) -> Result<JsValue<'js>, Error> {
    match value {
        Value::Null => Ok(JsValue::new_undefined(ctx.clone())),
        Value::Bool(b) => Ok(JsValue::new_bool(ctx.clone(), *b)),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                if i >= i32::MIN as i64 && i <= i32::MAX as i64 {
                    Ok(JsValue::new_int(ctx.clone(), i as i32))
                } else {
                    Ok(JsValue::new_float(ctx.clone(), i as f64))
                }
            } else {
                Ok(JsValue::new_float(ctx.clone(), n.as_f64().unwrap_or(0.0)))
            }
        }
        Value::String(s) => {
            let js_str = rquickjs::String::from_str(ctx.clone(), s)
                .map_err(|e| Error::RuntimeError(e.to_string()))?;
            Ok(js_str.into())
        }
        Value::Array(arr) => {
            let js_arr =
                Array::new(ctx.clone()).map_err(|e| Error::RuntimeError(e.to_string()))?;
            for (i, v) in arr.iter().enumerate() {
                let js_v = json_to_js(ctx, v)?;
                js_arr
                    .set(i, js_v)
                    .map_err(|e| Error::RuntimeError(e.to_string()))?;
            }
            Ok(js_arr.into())
        }
        Value::Object(map) => {
            let obj =
                Object::new(ctx.clone()).map_err(|e| Error::RuntimeError(e.to_string()))?;
            for (k, v) in map {
                let js_v = json_to_js(ctx, v)?;
                obj.set(k.as_str(), js_v)
                    .map_err(|e| Error::RuntimeError(e.to_string()))?;
            }
            Ok(obj.into())
        }
    }
}

fn js_to_json(value: &JsValue<'_>) -> Result<Value, Error> {
    if value.is_null() || value.is_undefined() {
        Ok(Value::Null)
    } else if let Some(b) = value.as_bool() {
        Ok(Value::Bool(b))
    } else if let Some(i) = value.as_int() {
        Ok(Value::Number(i.into()))
    } else if let Some(f) = value.as_float() {
        Ok(serde_json::json!(f))
    } else if value.is_string() {
        let s = value
            .clone()
            .into_string()
            .ok_or_else(|| Error::RuntimeError("string conversion failed".into()))?;
        let rs = s
            .to_string()
            .map_err(|e| Error::RuntimeError(e.to_string()))?;
        Ok(Value::String(rs))
    } else if value.is_array() {
        let arr = value
            .clone()
            .into_array()
            .ok_or_else(|| Error::RuntimeError("array conversion failed".into()))?;
        let mut result = Vec::new();
        for i in 0..arr.len() {
            let v: JsValue = arr.get(i).map_err(|e| Error::RuntimeError(e.to_string()))?;
            result.push(js_to_json(&v)?);
        }
        Ok(Value::Array(result))
    } else if value.is_object() {
        let obj = value
            .clone()
            .into_object()
            .ok_or_else(|| Error::RuntimeError("object conversion failed".into()))?;
        let mut map = serde_json::Map::new();
        for entry in obj.props::<String, JsValue>() {
            let (k, v) = entry.map_err(|e| Error::RuntimeError(e.to_string()))?;
            map.insert(k, js_to_json(&v)?);
        }
        Ok(Value::Object(map))
    } else {
        Err(Error::RuntimeError(format!(
            "unsupported JS type: {:?}",
            value.type_of()
        )))
    }
}

fn build_ctx_object<'js>(
    ctx: &Ctx<'js>,
    invocation: &InvocationContext,
) -> Result<Object<'js>, Error> {
    let map = |e: rquickjs::Error| Error::RuntimeError(e.to_string());

    let ctx_obj = Object::new(ctx.clone()).map_err(map)?;

    let event_js = json_to_js(ctx, &invocation.event)?;
    ctx_obj.set("event", event_js).map_err(map)?;

    let user_js = json_to_js(ctx, &invocation.user)?;
    ctx_obj.set("user", user_js).map_err(map)?;

    build_events_namespace(ctx, &ctx_obj, invocation)?;
    build_storage_namespace(ctx, &ctx_obj, invocation)?;
    build_http_namespace(ctx, &ctx_obj, invocation)?;
    build_env_namespace(ctx, &ctx_obj, invocation)?;
    build_resources_namespace(ctx, &ctx_obj, invocation)?;
    build_module_namespace(ctx, &ctx_obj, invocation)?;
    build_log_namespace(ctx, &ctx_obj, invocation)?;
    build_response_fn(ctx, &ctx_obj)?;
    bind_extensions(ctx, &ctx_obj, invocation)?;

    Ok(ctx_obj)
}

fn ensure_namespace_object<'js>(
    ctx: &Ctx<'js>,
    parent: &Object<'js>,
    namespace: &str,
) -> Result<Object<'js>, Error> {
    let map = |e: rquickjs::Error| Error::RuntimeError(e.to_string());
    let mut current = parent.clone();
    for segment in namespace.split('.') {
        let existing: Option<Object<'js>> = current.get(segment).ok();
        let next = match existing {
            Some(obj) => obj,
            None => {
                let obj = Object::new(ctx.clone()).map_err(map)?;
                current.set(segment, obj.clone()).map_err(map)?;
                obj
            }
        };
        current = next;
    }
    Ok(current)
}

fn bind_extensions<'js>(
    ctx: &Ctx<'js>,
    ctx_obj: &Object<'js>,
    invocation: &InvocationContext,
) -> Result<(), Error> {
    let map = |e: rquickjs::Error| Error::RuntimeError(e.to_string());
    for ext in invocation.host.extensions.iter() {
        let target = ensure_namespace_object(ctx, ctx_obj, ext.namespace())?;
        for func in ext.functions() {
            let handler = func.handler.clone();
            let js_func = JsFunction::new(
                ctx.clone(),
                move |ctx, arg: Opt<JsValue<'_>>| {
                    let value = match arg.0 {
                        Some(v) => js_to_json(&v).map_err(|e| host_err(e.to_string()))?,
                        None => Value::Null,
                    };
                    let result = handler(value).map_err(host_err)?;
                    json_to_js(&ctx, &result).map_err(|e| host_err(e.to_string()))
                },
            )
            .map_err(map)?;
            target.set(func.name.as_str(), js_func).map_err(map)?;
        }
    }
    Ok(())
}

fn build_events_namespace<'js>(
    ctx: &Ctx<'js>,
    ctx_obj: &Object<'js>,
    invocation: &InvocationContext,
) -> Result<(), Error> {
    let map = |e: rquickjs::Error| Error::RuntimeError(e.to_string());
    let events = Object::new(ctx.clone()).map_err(map)?;

    let nats = invocation.host.nats.clone();
    let publish = JsFunction::new(ctx.clone(), move |_ctx: Ctx<'_>, subject: String, data: JsValue<'_>| -> rquickjs::Result<()> {
        let json_data = js_to_json(&data).map_err(|e| host_err(e.to_string()))?;
        nats.publish(&subject, json_data).map_err(|e| host_err(e))?;
        Ok(())
    }).map_err(map)?;
    events.set("publish", publish).map_err(map)?;

    ctx_obj.set("events", events).map_err(map)?;
    Ok(())
}

fn build_storage_namespace<'js>(
    ctx: &Ctx<'js>,
    ctx_obj: &Object<'js>,
    invocation: &InvocationContext,
) -> Result<(), Error> {
    let map = |e: rquickjs::Error| Error::RuntimeError(e.to_string());
    let storage = Object::new(ctx.clone()).map_err(map)?;

    let store = invocation.host.storage.clone();
    let get_fn = JsFunction::new(ctx.clone(), move |ctx, key: String| {
        match store.get(&key) {
            Ok(Some(v)) => json_to_js(&ctx, &v).map_err(|e| host_err(e.to_string())),
            Ok(None) => Ok(rquickjs::Value::new_null(ctx)),
            Err(e) => Err(host_err(e)),
        }
    }).map_err(map)?;
    storage.set("get", get_fn).map_err(map)?;

    let store = invocation.host.storage.clone();
    let nats = invocation.host.nats.clone();
    let module_id = invocation.module_id.clone();
    let set_fn = JsFunction::new(ctx.clone(), move |_ctx: Ctx<'_>, key: String, value: JsValue<'_>| -> rquickjs::Result<()> {
        let json_val = js_to_json(&value).map_err(|e| host_err(e.to_string()))?;
        store.set(&key, json_val.clone()).map_err(|e| host_err(e))?;
        crate::runtime::storage_event::publish_storage_changed(&nats, &module_id, &key, &json_val);
        Ok(())
    }).map_err(map)?;
    storage.set("set", set_fn).map_err(map)?;

    ctx_obj.set("storage", storage).map_err(map)?;
    Ok(())
}

fn build_http_namespace<'js>(
    ctx: &Ctx<'js>,
    ctx_obj: &Object<'js>,
    invocation: &InvocationContext,
) -> Result<(), Error> {
    let map = |e: rquickjs::Error| Error::RuntimeError(e.to_string());
    let http = Object::new(ctx.clone()).map_err(map)?;

    let client = invocation.host.http.clone();
    let request_fn = JsFunction::new(ctx.clone(), move |ctx, url: String, method: String, opts: rquickjs::Value<'_>| {
        let json_opts = js_to_json(&opts).map_err(|e| host_err(e.to_string()))?;
        let response = client.request(&url, &method, json_opts).map_err(|e| host_err(e))?;
        json_to_js(&ctx, &response).map_err(|e| host_err(e.to_string()))
    }).map_err(map)?;
    http.set("request", request_fn).map_err(map)?;

    ctx_obj.set("http", http).map_err(map)?;
    Ok(())
}

fn build_env_namespace<'js>(
    ctx: &Ctx<'js>,
    ctx_obj: &Object<'js>,
    invocation: &InvocationContext,
) -> Result<(), Error> {
    let map = |e: rquickjs::Error| Error::RuntimeError(e.to_string());
    let env = Object::new(ctx.clone()).map_err(map)?;

    let reader = invocation.host.env.clone();
    let get_fn = JsFunction::new(ctx.clone(), move |ctx, key: String| {
        match reader.get(&key) {
            Some(v) => {
                let s = rquickjs::String::from_str(ctx, &v).map_err(|e| host_err(e.to_string()))?;
                Ok::<_, rquickjs::Error>(s.into())
            }
            None => Ok(rquickjs::Value::new_null(ctx)),
        }
    }).map_err(map)?;
    env.set("get", get_fn).map_err(map)?;

    ctx_obj.set("env", env).map_err(map)?;
    Ok(())
}

/// `ctx.resources` — runtime-instance lifecycle for kinds the calling
/// module declared in its manifest's `resources[]` block.
///
///   - `ctx.resources.create(kind, instanceId, displayName?)` →
///     `{ canonicalId, moduleName, kind, instanceId, displayName }`
///   - `ctx.resources.delete(canonicalId)` → no return
///   - `ctx.resources.list(kind)` → array of the same instance objects
///
/// `owning_module_name` is bound from `invocation.module_id` (the
/// manifest-local id baked into the function's canonical path) so JS
/// callers don't need to thread it explicitly.
fn build_resources_namespace<'js>(
    ctx: &Ctx<'js>,
    ctx_obj: &Object<'js>,
    invocation: &InvocationContext,
) -> Result<(), Error> {
    let map = |e: rquickjs::Error| Error::RuntimeError(e.to_string());
    let resources = Object::new(ctx.clone()).map_err(map)?;

    let client = invocation.host.resources.clone();
    let module_name = invocation.module_id.clone();
    let create_fn = JsFunction::new(
        ctx.clone(),
        move |ctx, kind: String, instance_id: String, display_name: Option<String>| {
            let display = display_name.unwrap_or_default();
            match client.create(&module_name, &kind, &instance_id, &display) {
                Ok(inst) => {
                    let v = serde_json::to_value(&inst)
                        .map_err(|e| host_err(e.to_string()))?;
                    json_to_js(&ctx, &v).map_err(|e| host_err(e.to_string()))
                }
                Err(e) => Err(host_err(e)),
            }
        },
    )
    .map_err(map)?;
    resources.set("create", create_fn).map_err(map)?;

    let client = invocation.host.resources.clone();
    let delete_fn = JsFunction::new(
        ctx.clone(),
        move |_ctx: Ctx<'_>, canonical_id: String| -> rquickjs::Result<()> {
            client.delete(&canonical_id).map_err(host_err)?;
            Ok(())
        },
    )
    .map_err(map)?;
    resources.set("delete", delete_fn).map_err(map)?;

    let client = invocation.host.resources.clone();
    let list_fn = JsFunction::new(ctx.clone(), move |ctx, kind: String| {
        match client.list_by_kind(&kind) {
            Ok(items) => {
                let v = serde_json::to_value(&items)
                    .map_err(|e| host_err(e.to_string()))?;
                json_to_js(&ctx, &v).map_err(|e| host_err(e.to_string()))
            }
            Err(e) => Err(host_err(e)),
        }
    })
    .map_err(map)?;
    resources.set("list", list_fn).map_err(map)?;

    ctx_obj.set("resources", resources).map_err(map)?;
    Ok(())
}

fn build_module_namespace<'js>(
    ctx: &Ctx<'js>,
    ctx_obj: &Object<'js>,
    invocation: &InvocationContext,
) -> Result<(), Error> {
    let map = |e: rquickjs::Error| Error::RuntimeError(e.to_string());
    let module = Object::new(ctx.clone()).map_err(map)?;

    let id_str = rquickjs::String::from_str(ctx.clone(), &invocation.module_id).map_err(map)?;
    module.set("id", id_str).map_err(map)?;

    let name_str = rquickjs::String::from_str(ctx.clone(), &invocation.module_name).map_err(map)?;
    module.set("name", name_str).map_err(map)?;

    let version_str = rquickjs::String::from_str(ctx.clone(), &invocation.module_version).map_err(map)?;
    module.set("version", version_str).map_err(map)?;

    let settings_map = invocation
        .host
        .settings
        .list_by_module(&invocation.module_id)
        .unwrap_or_default();
    let settings_obj = Object::new(ctx.clone()).map_err(map)?;
    for (k, v) in &settings_map {
        let js_val = json_to_js(ctx, v)?;
        settings_obj.set(k.as_str(), js_val).map_err(map)?;
    }
    module.set("settings", settings_obj).map_err(map)?;

    ctx_obj.set("module", module).map_err(map)?;
    Ok(())
}

/// Stringifies a value for the `ctx.log.*` functions: strings are logged
/// verbatim, everything else is JSON-encoded so structured data is still
/// readable in the host log line.
fn format_log_value(value: &JsValue<'_>) -> String {
    if value.is_string() {
        return value
            .clone()
            .into_string()
            .and_then(|s| s.to_string().ok())
            .unwrap_or_else(|| "<unprintable string>".to_string());
    }
    match js_to_json(value) {
        Ok(json) => json.to_string(),
        Err(_) => format!("<unloggable value: {:?}>", value.type_of()),
    }
}

/// `ctx.log` — forwards a module's log calls to the host's `log` crate,
/// prefixed with the calling module's id so multi-module log output stays
/// attributable. There is no `console` global in this sandbox (QuickJS
/// doesn't provide one, and none is bound here) — `ctx.log.*` is the only
/// way for a module function to emit a log line.
fn build_log_namespace<'js>(
    ctx: &Ctx<'js>,
    ctx_obj: &Object<'js>,
    invocation: &InvocationContext,
) -> Result<(), Error> {
    let map = |e: rquickjs::Error| Error::RuntimeError(e.to_string());
    let log = Object::new(ctx.clone()).map_err(map)?;

    let module_id = invocation.module_id.clone();
    let info_fn = JsFunction::new(ctx.clone(), move |_ctx: Ctx<'_>, value: JsValue<'_>| -> rquickjs::Result<()> {
        log::info!("[module:{}] {}", module_id, format_log_value(&value));
        Ok(())
    }).map_err(map)?;
    log.set("info", info_fn).map_err(map)?;

    let module_id = invocation.module_id.clone();
    let warn_fn = JsFunction::new(ctx.clone(), move |_ctx: Ctx<'_>, value: JsValue<'_>| -> rquickjs::Result<()> {
        log::warn!("[module:{}] {}", module_id, format_log_value(&value));
        Ok(())
    }).map_err(map)?;
    log.set("warn", warn_fn).map_err(map)?;

    let module_id = invocation.module_id.clone();
    let error_fn = JsFunction::new(ctx.clone(), move |_ctx: Ctx<'_>, value: JsValue<'_>| -> rquickjs::Result<()> {
        log::error!("[module:{}] {}", module_id, format_log_value(&value));
        Ok(())
    }).map_err(map)?;
    log.set("error", error_fn).map_err(map)?;

    ctx_obj.set("log", log).map_err(map)?;
    Ok(())
}

/// `ctx.response(success, message)` — the standard shape a module function
/// returns when it wants the invoking chat command to reply. A pure data
/// constructor (no host state, unlike the other `build_*` functions): it
/// only builds and returns `{ proto: "woofx3.response", v: 1, success,
/// message }`; the sandboxed function still has to actually `return` the
/// result for anything to happen. If a function never calls this and just
/// returns `null`/`undefined` (or nothing), no message is sent — same
/// outcome as never calling it at all. Tagged with `proto`/`v` (mirroring
/// the `woofx3.widget`/`woofx3.overlay-events` envelope convention) so a
/// caller can reliably distinguish "this is a deliberate response" from any
/// other object a function might return for its own purposes.
fn build_response_fn<'js>(ctx: &Ctx<'js>, ctx_obj: &Object<'js>) -> Result<(), Error> {
    let map = |e: rquickjs::Error| Error::RuntimeError(e.to_string());
    let response_fn = JsFunction::new(ctx.clone(), move |ctx, success: bool, message: String| {
        let value = serde_json::json!({
            "proto": "woofx3.response",
            "v": 1,
            "success": success,
            "message": message,
        });
        json_to_js(&ctx, &value).map_err(|e| host_err(e.to_string()))
    })
    .map_err(map)?;
    ctx_obj.set("response", response_fn).map_err(map)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::{InvocationContext, noop::noop_host_context};
    use crate::runtime::RuntimeAdapter;

    #[test]
    fn quickjs_ctx_module_exposed() {
        let adapter = QuickJSAdapter::new().unwrap();
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host: noop_host_context(),
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "2.0.0".to_string(),
        };
        let code = "function run(ctx) { return { id: ctx.module.id, name: ctx.module.name, version: ctx.module.version }; }";
        let result = adapter.execute(code, "run", &invocation).unwrap();
        assert_eq!(result["id"], "mymod");
        assert_eq!(result["name"], "My Module");
        assert_eq!(result["version"], "2.0.0");
    }

    #[test]
    fn quickjs_ctx_log_accepts_strings_and_objects() {
        let adapter = QuickJSAdapter::new().unwrap();
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host: noop_host_context(),
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "2.0.0".to_string(),
        };
        // Exercises all three levels and both a string and an object
        // argument; the assertion is just that none of these throw and the
        // function still returns normally — actual log output isn't
        // captured here, that's the `log` crate's job.
        let code = "function run(ctx) { \
            ctx.log.info('testing'); \
            ctx.log.warn({ code: 42 }); \
            ctx.log.error('oops'); \
            return { ok: true }; \
        }";
        let result = adapter.execute(code, "run", &invocation).unwrap();
        assert_eq!(result["ok"], true);
    }

    #[test]
    fn quickjs_ctx_log_ignores_arguments_past_the_first() {
        // ctx.log.* binds a single-parameter Rust closure; rquickjs
        // silently drops any JS-side arguments beyond what the closure
        // declares rather than erroring. Guards the documented "one value
        // per call" contract — if rquickjs's calling convention ever
        // changes to error instead, this is the test that should catch it.
        let adapter = QuickJSAdapter::new().unwrap();
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host: noop_host_context(),
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "2.0.0".to_string(),
        };
        let code = "function run(ctx) { ctx.log.info('data', { foo: 1 }); return { ok: true }; }";
        let result = adapter.execute(code, "run", &invocation).unwrap();
        assert_eq!(result["ok"], true);
    }

    #[test]
    fn quickjs_ctx_response_builds_the_standard_shape() {
        let adapter = QuickJSAdapter::new().unwrap();
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host: noop_host_context(),
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "2.0.0".to_string(),
        };
        let code = "function run(ctx) { return ctx.response(false, 'nope'); }";
        let result = adapter.execute(code, "run", &invocation).unwrap();
        assert_eq!(result["proto"], "woofx3.response");
        assert_eq!(result["v"], 1);
        assert_eq!(result["success"], false);
        assert_eq!(result["message"], "nope");
    }
}
