use crate::error::Error;
use crate::host::InvocationContext;
use crate::runtime::RuntimeAdapter;
use rquickjs::{
    Array, Context, Ctx, Function as JsFunction, Object, Runtime,
    Value as JsValue,
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
    build_twitch_namespace(ctx, &ctx_obj, invocation)?;
    build_platform_namespace(ctx, &ctx_obj, invocation)?;
    build_storage_namespace(ctx, &ctx_obj, invocation)?;
    build_http_namespace(ctx, &ctx_obj, invocation)?;
    build_env_namespace(ctx, &ctx_obj, invocation)?;

    Ok(ctx_obj)
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

fn build_twitch_namespace<'js>(
    ctx: &Ctx<'js>,
    ctx_obj: &Object<'js>,
    invocation: &InvocationContext,
) -> Result<(), Error> {
    let map = |e: rquickjs::Error| Error::RuntimeError(e.to_string());
    let twitch = Object::new(ctx.clone()).map_err(map)?;

    let nats = invocation.host.nats.clone();
    let clip = JsFunction::new(ctx.clone(), move |_ctx: Ctx<'_>| -> rquickjs::Result<()> {
        let data = serde_json::json!({"command": "clip"});
        nats.publish("twitchapi", data).map_err(|e| host_err(e))?;
        Ok(())
    }).map_err(map)?;
    twitch.set("clip", clip).map_err(map)?;

    let nats = invocation.host.nats.clone();
    let timeout_fn = JsFunction::new(ctx.clone(), move |_ctx: Ctx<'_>, args: JsValue<'_>| -> rquickjs::Result<()> {
        let json_args = js_to_json(&args).map_err(|e| host_err(e.to_string()))?;
        let data = serde_json::json!({"command": "timeout", "args": json_args});
        nats.publish("twitchapi", data).map_err(|e| host_err(e))?;
        Ok(())
    }).map_err(map)?;
    twitch.set("timeout", timeout_fn).map_err(map)?;

    let nats = invocation.host.nats.clone();
    let update_stream = JsFunction::new(ctx.clone(), move |_ctx: Ctx<'_>, args: JsValue<'_>| -> rquickjs::Result<()> {
        let json_args = js_to_json(&args).map_err(|e| host_err(e.to_string()))?;
        let data = serde_json::json!({"command": "updateStream", "args": json_args});
        nats.publish("twitchapi", data).map_err(|e| host_err(e))?;
        Ok(())
    }).map_err(map)?;
    twitch.set("updateStream", update_stream).map_err(map)?;

    ctx_obj.set("twitch", twitch).map_err(map)?;
    Ok(())
}

fn build_platform_namespace<'js>(
    ctx: &Ctx<'js>,
    ctx_obj: &Object<'js>,
    invocation: &InvocationContext,
) -> Result<(), Error> {
    let map = |e: rquickjs::Error| Error::RuntimeError(e.to_string());
    let platform = Object::new(ctx.clone()).map_err(map)?;

    // platform.alerts
    let alerts = Object::new(ctx.clone()).map_err(map)?;

    let nats = invocation.host.nats.clone();
    let alert_fn = JsFunction::new(ctx.clone(), move |_ctx: Ctx<'_>, args: JsValue<'_>| -> rquickjs::Result<()> {
        let json_args = js_to_json(&args).map_err(|e| host_err(e.to_string()))?;
        let data = serde_json::json!({"command": "alert_message", "args": json_args});
        nats.publish("slobs", data).map_err(|e| host_err(e))?;
        Ok(())
    }).map_err(map)?;
    alerts.set("alert", alert_fn).map_err(map)?;

    let nats = invocation.host.nats.clone();
    let set_timer = JsFunction::new(ctx.clone(), move |_ctx: Ctx<'_>, args: JsValue<'_>| -> rquickjs::Result<()> {
        let json_args = js_to_json(&args).map_err(|e| host_err(e.to_string()))?;
        let data = serde_json::json!({"command": "setTime", "args": json_args});
        nats.publish("slobs", data).map_err(|e| host_err(e))?;
        Ok(())
    }).map_err(map)?;
    alerts.set("setTimer", set_timer).map_err(map)?;
    platform.set("alerts", alerts).map_err(map)?;

    // platform.chat
    let chat = Object::new(ctx.clone()).map_err(map)?;

    let nats = invocation.host.nats.clone();
    let register_fn = JsFunction::new(ctx.clone(), move |_ctx: Ctx<'_>, args: JsValue<'_>| -> rquickjs::Result<()> {
        let json_args = js_to_json(&args).map_err(|e| host_err(e.to_string()))?;
        let data = serde_json::json!({"command": "register", "args": json_args});
        nats.publish("woofwoofwoof", data).map_err(|e| host_err(e))?;
        Ok(())
    }).map_err(map)?;
    chat.set("register", register_fn).map_err(map)?;
    platform.set("chat", chat).map_err(map)?;

    ctx_obj.set("platform", platform).map_err(map)?;
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
    let set_fn = JsFunction::new(ctx.clone(), move |_ctx: Ctx<'_>, key: String, value: JsValue<'_>| -> rquickjs::Result<()> {
        let json_val = js_to_json(&value).map_err(|e| host_err(e.to_string()))?;
        store.set(&key, json_val).map_err(|e| host_err(e))?;
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
