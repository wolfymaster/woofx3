use crate::error::Error;
use crate::host::{HostError, InvocationContext};
use crate::runtime::RuntimeAdapter;
use mlua::{
    Function, HookTriggers, Lua, LuaOptions, LuaSerdeExt, StdLib, Value as LuaValue, VmState,
};
use serde_json::Value;
use std::cell::{Cell, RefCell};
use std::rc::Rc;

const DEFAULT_MEMORY_LIMIT: usize = 16 * 1024 * 1024;
const DEFAULT_MAX_INSTRUCTIONS: u64 = 10_000_000;
const HOOK_INTERVAL: u32 = 10_000;

pub struct LuaAdapter {
    memory_limit: usize,
    max_instructions: u64,
}

impl LuaAdapter {
    pub fn new() -> Result<Self, Error> {
        Ok(Self {
            memory_limit: DEFAULT_MEMORY_LIMIT,
            max_instructions: DEFAULT_MAX_INSTRUCTIONS,
        })
    }
}

impl RuntimeAdapter for LuaAdapter {
    fn execute(
        &self,
        code: &str,
        entry_point: &str,
        invocation: &InvocationContext,
    ) -> Result<Value, Error> {
        let lua = Lua::new_with(StdLib::NONE, LuaOptions::new())?;
        lua.set_memory_limit(self.memory_limit)?;

        let max_instr = self.max_instructions;
        let count = Cell::new(0u64);
        lua.set_hook(
            HookTriggers::new().every_nth_instruction(HOOK_INTERVAL),
            move |_, _| {
                let c = count.get() + HOOK_INTERVAL as u64;
                count.set(c);
                if c > max_instr {
                    Err(mlua::Error::RuntimeError(
                        "instruction limit exceeded".to_string(),
                    ))
                } else {
                    Ok(VmState::Continue)
                }
            },
        );

        let ctx_table = build_lua_ctx(&lua, invocation)?;

        lua.load(code).exec()?;
        let main: Function = lua.globals().get(entry_point)?;
        let result = main.call::<LuaValue>(ctx_table)?;

        Ok(serde_json::to_value(&result)?)
    }
}

/// Stringifies a value for the `ctx.log.*` functions: Lua strings are
/// logged verbatim (via `to_string_lossy`, so a non-UTF8 Lua string still
/// logs something instead of erroring), everything else is JSON-encoded —
/// the encoding rule itself lives in `host_bindings::format_log_value`,
/// shared with the QuickJS adapter; only the Lua-native string fast path
/// stays here; see that function's mlua-independent JSON-value contract.
fn format_log_value(value: &LuaValue) -> String {
    if let LuaValue::String(s) = value {
        return s.to_string_lossy();
    }
    match serde_json::to_value(value) {
        Ok(json) => super::host_bindings::format_log_value(&json),
        Err(_) => format!("<unloggable value: {:?}>", value.type_name()),
    }
}

fn build_lua_ctx(lua: &Lua, invocation: &InvocationContext) -> Result<mlua::Table, Error> {
    let ctx = lua.create_table()?;

    let event = lua.to_value(&invocation.event)?;
    ctx.set("event", event)?;

    let user = lua.to_value(&invocation.user)?;
    ctx.set("user", user)?;

    // crypto namespace — see `runtime::crypto`. Pure computation: no host
    // state.
    let crypto = lua.create_table()?;
    {
        let hmac = lua.create_function(
            |_, (algorithm, key, data, encoding): (String, String, String, Option<String>)| {
                let encoding = super::crypto::Encoding::parse(encoding.as_deref())
                    .map_err(mlua::Error::RuntimeError)?;
                super::crypto::hmac(&algorithm, &key, &data, encoding)
                    .map_err(mlua::Error::RuntimeError)
            },
        )?;
        crypto.set("hmac", hmac)?;

        let verify_ed25519 = lua.create_function(
            |_,
             (public_key, signature, message, encoding): (
                String,
                String,
                String,
                Option<String>,
            )| {
                let encoding = super::crypto::Encoding::parse(encoding.as_deref())
                    .map_err(mlua::Error::RuntimeError)?;
                super::crypto::verify_ed25519(&public_key, &signature, &message, encoding)
                    .map_err(mlua::Error::RuntimeError)
            },
        )?;
        crypto.set("verifyEd25519", verify_ed25519)?;

        let timing_safe_equal = lua.create_function(|_, (a, b): (String, String)| {
            Ok(super::crypto::timing_safe_equal(&a, &b))
        })?;
        crypto.set("timingSafeEqual", timing_safe_equal)?;
    }
    ctx.set("crypto", crypto)?;

    // storage namespace
    let storage = lua.create_table()?;
    {
        let store = invocation.host.storage.clone();
        let namespace = invocation.module_id.clone();
        let get_fn = lua.create_function(move |lua, key: String| -> mlua::Result<LuaValue> {
            match store.get(&namespace, &key) {
                Ok(Some(v)) => lua.to_value(&v),
                Ok(None) => Ok(LuaValue::Nil),
                Err(e) => Err(mlua::Error::RuntimeError(e)),
            }
        })?;
        storage.set("get", get_fn)?;

        let host = invocation.host.clone();
        let module_id = invocation.module_id.clone();
        let set_fn = lua.create_function(
            move |_, (key, value, options): (String, LuaValue, Option<LuaValue>)| {
                let json_val: Value = serde_json::to_value(&value)
                    .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
                let json_options: Option<Value> = options
                    .map(|o| serde_json::to_value(&o))
                    .transpose()
                    .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
                super::host_bindings::storage_set(
                    &host,
                    &module_id,
                    &key,
                    json_val,
                    super::host_bindings::parse_storage_set_options(json_options.as_ref()),
                )
                .map_err(mlua::Error::RuntimeError)?;
                Ok(())
            },
        )?;
        storage.set("set", set_fn)?;

        let host = invocation.host.clone();
        let module_id = invocation.module_id.clone();
        let compare_and_set_fn = lua.create_function(
            move |lua,
                  (key, expected, value, options): (
                String,
                LuaValue,
                LuaValue,
                Option<LuaValue>,
            )| {
                let json_expected: Value = serde_json::to_value(&expected)
                    .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
                let json_val: Value = serde_json::to_value(&value)
                    .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
                let json_options: Option<Value> = options
                    .map(|o| serde_json::to_value(&o))
                    .transpose()
                    .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
                let outcome = super::host_bindings::storage_compare_and_set(
                    &host,
                    &module_id,
                    &key,
                    Some(json_expected),
                    json_val,
                    super::host_bindings::parse_storage_set_options(json_options.as_ref()),
                )
                .map_err(mlua::Error::RuntimeError)?;
                lua.to_value(&outcome)
            },
        )?;
        storage.set("compareAndSet", compare_and_set_fn)?;
    }
    ctx.set("storage", storage)?;

    // http namespace
    let http = lua.create_table()?;
    {
        let client = invocation.host.http.clone();
        let module_id = invocation.module_id.clone();
        let grants = invocation.permissions.clone();
        let request_fn = lua.create_function(
            move |lua, (url, method, opts): (String, String, LuaValue)| {
                let json_opts: Value = serde_json::to_value(&opts)
                    .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
                let result = client
                    .request(crate::host::HttpRequest {
                        module_id: &module_id,
                        grants: &grants,
                        url: &url,
                        method: &method,
                        opts: json_opts,
                    })
                    .map_err(mlua::Error::RuntimeError)?;
                lua.to_value(&result)
            },
        )?;
        http.set("request", request_fn)?;
    }
    ctx.set("http", http)?;

    // resources namespace — runtime-instance lifecycle for kinds the
    // calling module declared in its manifest's `resources[]` block.
    // `owning_module_name` is bound from `invocation.module_id`.
    let resources = lua.create_table()?;
    {
        let host = invocation.host.clone();
        let module_name = invocation.module_id.clone();
        let create_fn = lua.create_function(
            move |lua,
                  (kind, instance_id, display_name, settings): (
                String,
                String,
                Option<String>,
                Option<LuaValue>,
            )| {
                let display = display_name.unwrap_or_default();
                let json_settings: Option<Value> = settings
                    .map(|s| serde_json::to_value(&s))
                    .transpose()
                    .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
                match super::host_bindings::resources_create(
                    &host,
                    &module_name,
                    &kind,
                    &instance_id,
                    &display,
                    json_settings,
                ) {
                    Ok(v) => lua.to_value(&v),
                    Err(e) => Err(mlua::Error::RuntimeError(e)),
                }
            },
        )?;
        resources.set("create", create_fn)?;

        let host = invocation.host.clone();
        let delete_fn = lua.create_function(move |_lua, canonical_id: String| {
            super::host_bindings::resources_delete(&host, &canonical_id)
                .map_err(mlua::Error::RuntimeError)?;
            Ok(())
        })?;
        resources.set("delete", delete_fn)?;

        let host = invocation.host.clone();
        let get_fn = lua.create_function(move |lua, canonical_id: String| {
            match super::host_bindings::resources_get(&host, &canonical_id) {
                Ok(v) => lua.to_value(&v),
                Err(e) => Err(mlua::Error::RuntimeError(e)),
            }
        })?;
        resources.set("get", get_fn)?;

        let host = invocation.host.clone();
        let list_fn =
            lua.create_function(
                move |lua, kind: String| match super::host_bindings::resources_list(&host, &kind) {
                    Ok(v) => lua.to_value(&v),
                    Err(e) => Err(mlua::Error::RuntimeError(e)),
                },
            )?;
        resources.set("list", list_fn)?;

        let host = invocation.host.clone();
        let module_id = invocation.module_id.clone();
        let permissions = invocation.permissions.clone();
        let deadline = invocation.deadline;
        let run_fn = lua.create_function(
            move |lua, (canonical_id, verb, params): (String, String, Option<LuaValue>)| {
                let json_params: Option<Value> = params
                    .map(|p| serde_json::to_value(&p))
                    .transpose()
                    .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
                match super::host_bindings::resources_run(
                    &host,
                    &module_id,
                    &permissions,
                    deadline,
                    &canonical_id,
                    &verb,
                    json_params,
                ) {
                    Ok(v) => lua.to_value(&v),
                    Err(e) => Err(mlua::Error::RuntimeError(e)),
                }
            },
        )?;
        resources.set("run", run_fn)?;

        // `ctx.resources.compareAndSetSetting(canonicalId, key, expected, value)`
        // -- write one setting of an instance this module owns, only while it
        // still holds `expected`; answers `{ swapped, current }`.
        let host = invocation.host.clone();
        let module_id = invocation.module_id.clone();
        let compare_and_set_setting_fn =
            lua.create_function(
                move |lua,
                      (canonical_id, key, expected, value): (
                    String,
                    String,
                    LuaValue,
                    LuaValue,
                )| {
                    let json_expected: Value = serde_json::to_value(&expected)
                        .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
                    let json_val: Value = serde_json::to_value(&value)
                        .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
                    let outcome = super::host_bindings::resources_compare_and_set_setting(
                        &host,
                        &module_id,
                        &canonical_id,
                        &key,
                        &json_expected,
                        &json_val,
                    )
                    .map_err(mlua::Error::RuntimeError)?;
                    lua.to_value(&outcome)
                },
            )?;
        resources.set("compareAndSetSetting", compare_and_set_setting_fn)?;
    }
    ctx.set("resources", resources)?;

    // schedule namespace -- one-shot invocations of a function the module
    // declared under `deadlines`. See `host_bindings::schedule_at`.
    let schedule = lua.create_table()?;
    {
        let host = invocation.host.clone();
        let module_id = invocation.module_id.clone();
        let at_fn =
            lua.create_function(
                move |_,
                      (deadline_id, key, when_ms, params): (
                    String,
                    String,
                    f64,
                    Option<LuaValue>,
                )| {
                    let json_params: Option<Value> = params
                        .map(|p| serde_json::to_value(&p))
                        .transpose()
                        .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
                    super::host_bindings::schedule_at(
                        &host,
                        &module_id,
                        &deadline_id,
                        &key,
                        when_ms,
                        json_params,
                    )
                    .map_err(mlua::Error::RuntimeError)
                },
            )?;
        schedule.set("at", at_fn)?;

        let host = invocation.host.clone();
        let module_id = invocation.module_id.clone();
        let cancel_fn = lua.create_function(move |_, (deadline_id, key): (String, String)| {
            super::host_bindings::schedule_cancel(&host, &module_id, &deadline_id, &key)
                .map_err(mlua::Error::RuntimeError)
        })?;
        schedule.set("cancel", cancel_fn)?;
    }
    ctx.set("schedule", schedule)?;

    // module namespace
    {
        let module_tbl = lua.create_table()?;
        module_tbl.set("id", invocation.module_id.clone())?;
        module_tbl.set("name", invocation.module_name.clone())?;
        module_tbl.set("version", invocation.module_version.clone())?;

        // `ctx.module.setSetting(key, value)` — write-through to the module's
        // own settings store, taking effect immediately. Set directly on the
        // table like the fields above, so the `__index` hook below never sees
        // it: Lua consults a metatable only for keys the table lacks.
        //
        // The `settings` snapshot is taken once per invocation, so a value
        // written here is not reflected back into an object the function
        // already holds. `key` does not have to be manifest-declared.
        let host_for_set = invocation.host.clone();
        let module_id_for_set = invocation.module_id.clone();
        let url_settings = invocation.url_settings.clone();
        let set_setting_fn = lua.create_function(move |_, (key, value): (String, String)| {
            super::host_bindings::set_module_setting(
                &host_for_set,
                &module_id_for_set,
                &url_settings,
                &key,
                &value,
            )
            .map_err(mlua::Error::RuntimeError)?;
            Ok(())
        })?;
        module_tbl.set("setSetting", set_setting_fn)?;

        // `ctx.module.compareAndSetSetting(key, expected, value)` — write
        // only while the setting still holds `expected`; answers
        // `{ swapped, current }`. Set directly on the table, like setSetting.
        let host_for_cas = invocation.host.clone();
        let module_id_for_cas = invocation.module_id.clone();
        let url_settings_for_cas = invocation.url_settings.clone();
        let compare_and_set_setting_fn = lua.create_function(
            move |lua, (key, expected, value): (String, LuaValue, LuaValue)| {
                let json_expected: Value = serde_json::to_value(&expected)
                    .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
                let json_val: Value = serde_json::to_value(&value)
                    .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
                let outcome = super::host_bindings::compare_and_set_module_setting(
                    &host_for_cas,
                    &module_id_for_cas,
                    &url_settings_for_cas,
                    &key,
                    &json_expected,
                    &json_val,
                )
                .map_err(mlua::Error::RuntimeError)?;
                lua.to_value(&outcome)
            },
        )?;
        module_tbl.set("compareAndSetSetting", compare_and_set_setting_fn)?;

        // `ctx.module.settings` is fetched lazily, on first access, rather
        // than unconditionally before the function body runs — most
        // invocations never read it, and the fetch is a synchronous host
        // round trip (a Twirp call to db-proxy). Implemented via a
        // metatable `__index` hook rather than a plain table field, since
        // `id`/`name`/`version` are already set directly and only
        // `settings` needs to intercept access; the result is cached in
        // `settings_cache` after the first access so repeated reads within
        // this invocation only pay for one fetch.
        let host = invocation.host.clone();
        let module_id_for_settings = invocation.module_id.clone();
        let settings_cache: Rc<RefCell<Option<mlua::Table>>> = Rc::new(RefCell::new(None));
        let metatable = lua.create_table()?;
        let index_fn = lua.create_function(move |lua, (_tbl, key): (mlua::Table, String)| {
            if key != "settings" {
                return Ok(LuaValue::Nil);
            }
            let mut cache = settings_cache.borrow_mut();
            if cache.is_none() {
                let settings_map =
                    super::host_bindings::module_settings_snapshot(&host, &module_id_for_settings);
                let settings_tbl = lua.create_table()?;
                for (k, v) in &settings_map {
                    let lua_val = lua.to_value(v)?;
                    settings_tbl.set(k.as_str(), lua_val)?;
                }
                *cache = Some(settings_tbl);
            }
            Ok(LuaValue::Table(
                cache.as_ref().expect("populated above").clone(),
            ))
        })?;
        metatable.set("__index", index_fn)?;
        module_tbl.set_metatable(Some(metatable));
        ctx.set("module", module_tbl)?;
    }

    // log namespace — forwards to the host's `log` crate, prefixed with
    // the calling module's id. Lua has no host-visible logging facility of
    // its own (the sandbox's StdLib is NONE), so this is the only way for
    // a module function to emit a log line.
    let log = lua.create_table()?;
    {
        let module_id = invocation.module_id.clone();
        let info_fn = lua.create_function(move |_, value: LuaValue| {
            tracing::info!("[module:{}] {}", module_id, format_log_value(&value));
            Ok(())
        })?;
        log.set("info", info_fn)?;

        let module_id = invocation.module_id.clone();
        let warn_fn = lua.create_function(move |_, value: LuaValue| {
            tracing::warn!("[module:{}] {}", module_id, format_log_value(&value));
            Ok(())
        })?;
        log.set("warn", warn_fn)?;

        let module_id = invocation.module_id.clone();
        let error_fn = lua.create_function(move |_, value: LuaValue| {
            tracing::error!("[module:{}] {}", module_id, format_log_value(&value));
            Ok(())
        })?;
        log.set("error", error_fn)?;
    }
    ctx.set("log", log)?;

    // response — the standard shape a module function returns to report an
    // outcome and a message, which becomes the calling step's output. Pure
    // data constructor, no host state. Tagged with proto/v (mirroring the woofx3.widget/
    // woofx3.overlay-events envelope convention) so a caller can reliably
    // distinguish a deliberate response from any other table a function
    // might return for its own purposes.
    let response_fn = lua.create_function(move |lua, (success, message): (bool, String)| {
        let value = super::host_bindings::build_response_value(success, message);
        lua.to_value(&value)
    })?;
    ctx.set("response", response_fn)?;

    // result — a function's result together with events it asks the engine
    // to publish. Pure data constructor; the engine checks and publishes the
    // events once the function returns it (see function_result.rs).
    let result_fn = lua.create_function(move |lua, (value, events): (LuaValue, LuaValue)| {
        let to_json = |v: &LuaValue| {
            serde_json::to_value(v).map_err(|e| mlua::Error::RuntimeError(e.to_string()))
        };
        let envelope =
            crate::function_result::build_result_value(to_json(&value)?, to_json(&events)?);
        lua.to_value(&envelope)
    })?;
    ctx.set("result", result_fn)?;

    bind_extensions(lua, &ctx, invocation)?;

    Ok(ctx)
}

fn ensure_namespace_table(
    lua: &Lua,
    parent: &mlua::Table,
    namespace: &str,
) -> mlua::Result<mlua::Table> {
    let mut current = parent.clone();
    for segment in namespace.split('.') {
        let existing: mlua::Result<mlua::Table> = current.get(segment);
        let next = match existing {
            Ok(t) => t,
            Err(_) => {
                let t = lua.create_table()?;
                current.set(segment, t.clone())?;
                t
            }
        };
        current = next;
    }
    Ok(current)
}

/// Wraps a host call returning `(ok, result)` into a function that returns
/// `result` or raises it. The raise happens in Lua because only `error` can
/// raise a table, and a table is what carries `code` to a `pcall`.
const RAISE_ON_FAILURE: &str = r#"
return function(call)
    return function(args)
        local ok, result = call(args)
        if ok then
            return result
        end
        error(result, 0)
    end
end
"#;

/// Binds every extension function. A failure is raised as a table
/// `{ message, code? }` whose `tostring` is the message, so an uncaught one
/// still reports the host's message and a `pcall` can read `code`.
fn bind_extensions(
    lua: &Lua,
    ctx: &mlua::Table,
    invocation: &InvocationContext,
) -> mlua::Result<()> {
    let raise_on_failure: Function = lua.load(RAISE_ON_FAILURE).eval()?;
    let error_meta = lua.create_table()?;
    error_meta.set(
        "__tostring",
        lua.create_function(|_, err: mlua::Table| err.get::<String>("message"))?,
    )?;
    let scope = std::sync::Arc::new(invocation.call_scope());
    for ext in invocation.host.extensions.iter() {
        let target = ensure_namespace_table(lua, ctx, ext.namespace())?;
        for func in ext.functions() {
            let name = func.name.clone();
            let func = func.clone();
            let namespace = ext.namespace().to_string();
            let scope = scope.clone();
            let error_meta = error_meta.clone();
            let call = lua.create_function(move |lua, arg: LuaValue| {
                let value: Value = serde_json::to_value(&arg)
                    .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
                match func.call(&namespace, &scope, value) {
                    Ok(result) => Ok((true, lua.to_value(&result)?)),
                    Err(err) => Ok((
                        false,
                        LuaValue::Table(host_error_table(lua, &err, &error_meta)?),
                    )),
                }
            })?;
            let f: Function = raise_on_failure.call(call)?;
            target.set(name, f)?;
        }
    }
    Ok(())
}

fn host_error_table(lua: &Lua, err: &HostError, meta: &mlua::Table) -> mlua::Result<mlua::Table> {
    let table = lua.create_table()?;
    table.set("message", err.message.as_str())?;
    if let Some(code) = &err.code {
        table.set("code", code.as_str())?;
    }
    table.set_metatable(Some(meta.clone()));
    Ok(table)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::{InvocationContext, noop::noop_host_context};
    use crate::runtime::RuntimeAdapter;

    /// The engine's environment holds its own credentials, and module code is
    /// end-user code: nothing in `ctx` may read it.
    #[test]
    fn lua_ctx_has_no_env_namespace() {
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host: noop_host_context(),
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "1.0.0".to_string(),
            permissions: Default::default(),
            url_settings: Default::default(),
            deadline: std::time::Instant::now() + crate::host::MAX_INVOCATION_TIMEOUT,
        };
        let adapter = LuaAdapter::new().unwrap();
        let code = r#"
            function run(ctx)
                return { env = type(ctx.env) }
            end
        "#;
        let result = adapter.execute(code, "run", &invocation).unwrap();
        assert_eq!(result, serde_json::json!({ "env": "nil" }));
    }

    #[test]
    fn lua_ctx_schedule_reaches_the_scheduler_and_throws_a_refusal() {
        let schedule = std::sync::Arc::new(crate::host::recording::RecordingSchedule::default());
        let mut host = noop_host_context();
        host.schedule = schedule.clone();
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host,
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "1.0.0".to_string(),
            permissions: Default::default(),
            url_settings: Default::default(),
            deadline: std::time::Instant::now() + crate::host::MAX_INVOCATION_TIMEOUT,
        };
        let adapter = LuaAdapter::new().unwrap();
        let code = r#"
            function run(ctx)
                ctx.schedule.at("timer_end", "t1", 2000, { target = "t1" })
                ctx.schedule.cancel("timer_end", "t2")
                return { ok = true }
            end
        "#;
        adapter.execute(code, "run", &invocation).unwrap();
        assert_eq!(
            *schedule.calls.lock().unwrap(),
            vec!["at mymod/timer_end/t1@2000", "cancel mymod/timer_end/t2"]
        );
        assert_eq!(
            schedule.params.lock().unwrap()[0],
            serde_json::json!({ "target": "t1" })
        );

        *schedule.refusal.lock().unwrap() = Some("deadline not declared".to_string());
        let err = adapter
            .execute(
                r#"function run(ctx) ctx.schedule.at("nope", "t1", 0) return {} end"#,
                "run",
                &invocation,
            )
            .unwrap_err()
            .to_string();
        assert!(err.contains("deadline not declared"), "{err}");
    }

    #[test]
    fn lua_ctx_log_accepts_strings_and_objects() {
        let adapter = LuaAdapter::new().unwrap();
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host: noop_host_context(),
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "2.0.0".to_string(),
            permissions: Default::default(),
            url_settings: Default::default(),
            deadline: std::time::Instant::now() + crate::host::MAX_INVOCATION_TIMEOUT,
        };
        // Exercises all three levels and both a string and a table
        // argument; the assertion is just that none of these throw and the
        // function still returns normally — actual log output isn't
        // captured here, that's the `log` crate's job.
        let code = r#"
            function run(ctx)
                ctx.log.info("testing")
                ctx.log.warn({ code = 42 })
                ctx.log.error("oops")
                return { ok = true }
            end
        "#;
        let result = adapter.execute(code, "run", &invocation).unwrap();
        assert_eq!(result["ok"], true);
    }

    #[test]
    fn lua_ctx_response_builds_the_standard_shape() {
        let adapter = LuaAdapter::new().unwrap();
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host: noop_host_context(),
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "2.0.0".to_string(),
            permissions: Default::default(),
            url_settings: Default::default(),
            deadline: std::time::Instant::now() + crate::host::MAX_INVOCATION_TIMEOUT,
        };
        let code = r#"
            function run(ctx)
                return ctx.response(false, "nope")
            end
        "#;
        let result = adapter.execute(code, "run", &invocation).unwrap();
        assert_eq!(result["proto"], "woofx3.response");
        assert_eq!(result["v"], 1);
        assert_eq!(result["success"], false);
        assert_eq!(result["message"], "nope");
    }

    struct CountingSettingsClient {
        calls: std::sync::Arc<std::sync::atomic::AtomicUsize>,
        data: std::collections::HashMap<String, serde_json::Value>,
        /// Every `set`, as (module_id, key, value). The module id is recorded
        /// too because a binding that passes the wrong one still looks like it
        /// worked from inside the sandbox.
        writes: std::sync::Arc<std::sync::Mutex<Vec<(String, String, String)>>>,
    }

    impl crate::host::SettingsClient for CountingSettingsClient {
        fn list_by_module(
            &self,
            _module_id: &str,
        ) -> Result<std::collections::HashMap<String, serde_json::Value>, String> {
            self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(self.data.clone())
        }
        fn set(&self, module_id: &str, key: &str, value: &str) -> Result<(), String> {
            self.writes.lock().expect("writes lock").push((
                module_id.to_string(),
                key.to_string(),
                value.to_string(),
            ));
            Ok(())
        }
    }

    #[test]
    fn lua_ctx_module_settings_not_fetched_when_unused() {
        let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let mut host = noop_host_context();
        host.settings = std::sync::Arc::new(CountingSettingsClient {
            calls: calls.clone(),
            data: std::collections::HashMap::new(),
            writes: Default::default(),
        });
        let adapter = LuaAdapter::new().unwrap();
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host,
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "2.0.0".to_string(),
            permissions: Default::default(),
            url_settings: Default::default(),
            deadline: std::time::Instant::now() + crate::host::MAX_INVOCATION_TIMEOUT,
        };
        // Never touches ctx.module.settings.
        let code = r#"
            function run(ctx)
                return { id = ctx.module.id }
            end
        "#;
        adapter.execute(code, "run", &invocation).unwrap();
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    #[test]
    fn lua_ctx_module_settings_fetched_once_and_cached_per_invocation() {
        let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let mut data = std::collections::HashMap::new();
        data.insert("apiKey".to_string(), serde_json::json!("secret"));
        let mut host = noop_host_context();
        host.settings = std::sync::Arc::new(CountingSettingsClient {
            calls: calls.clone(),
            data,
            writes: Default::default(),
        });
        let adapter = LuaAdapter::new().unwrap();
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host,
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "2.0.0".to_string(),
            permissions: Default::default(),
            url_settings: Default::default(),
            deadline: std::time::Instant::now() + crate::host::MAX_INVOCATION_TIMEOUT,
        };
        // Reads ctx.module.settings twice — should still be one host fetch.
        let code = r#"
            function run(ctx)
                local a = ctx.module.settings.apiKey
                local b = ctx.module.settings.apiKey
                return { a = a, b = b }
            end
        "#;
        let result = adapter.execute(code, "run", &invocation).unwrap();
        assert_eq!(result["a"], "secret");
        assert_eq!(result["b"], "secret");
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    // A passthrough this thin is exactly what went undetected once already: the
    // binding was registered in the QuickJS adapter and not this one, so the
    // same module worked in JS and hit a nil index in Lua.
    #[test]
    fn lua_ctx_module_set_setting_writes_through_to_the_host() {
        let writes: std::sync::Arc<std::sync::Mutex<Vec<(String, String, String)>>> =
            Default::default();
        let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let mut host = noop_host_context();
        host.settings = std::sync::Arc::new(CountingSettingsClient {
            calls: calls.clone(),
            data: std::collections::HashMap::new(),
            writes: writes.clone(),
        });
        let adapter = LuaAdapter::new().unwrap();
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host,
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "2.0.0".to_string(),
            permissions: Default::default(),
            url_settings: Default::default(),
            deadline: std::time::Instant::now() + crate::host::MAX_INVOCATION_TIMEOUT,
        };
        let code = r#"
            function run(ctx)
                ctx.module.setSetting("apiKey", "secret")
                return { ok = true }
            end
        "#;
        adapter.execute(code, "run", &invocation).unwrap();

        assert_eq!(
            *writes.lock().expect("writes lock"),
            vec![(
                "mymod".to_string(),
                "apiKey".to_string(),
                "secret".to_string()
            )]
        );
        // Set directly on the table, so it must not fall through to the
        // `__index` hook that fetches settings.
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    #[test]
    fn lua_ctx_module_id_name_version_still_direct_fields() {
        // Guards against the __index metatable hook accidentally shadowing
        // the plain fields set directly on module_tbl.
        let adapter = LuaAdapter::new().unwrap();
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host: noop_host_context(),
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "2.0.0".to_string(),
            permissions: Default::default(),
            url_settings: Default::default(),
            deadline: std::time::Instant::now() + crate::host::MAX_INVOCATION_TIMEOUT,
        };
        let code = r#"
            function run(ctx)
                return { id = ctx.module.id, name = ctx.module.name, version = ctx.module.version }
            end
        "#;
        let result = adapter.execute(code, "run", &invocation).unwrap();
        assert_eq!(result["id"], "mymod");
        assert_eq!(result["name"], "My Module");
        assert_eq!(result["version"], "2.0.0");
    }

    struct ListSettings {
        items: std::sync::Mutex<serde_json::Value>,
    }

    impl crate::host::SettingsClient for ListSettings {
        fn list_by_module(
            &self,
            _module_id: &str,
        ) -> Result<std::collections::HashMap<String, serde_json::Value>, String> {
            let items = self.items.lock().unwrap().clone();
            Ok(std::collections::HashMap::from([(
                "items".to_string(),
                items,
            )]))
        }
        fn set(&self, _module_id: &str, _key: &str, _value: &str) -> Result<(), String> {
            Ok(())
        }
        fn compare_and_set(
            &self,
            _module_id: &str,
            _key: &str,
            expected: &serde_json::Value,
            value: &serde_json::Value,
        ) -> Result<crate::host::CompareAndSetOutcome, String> {
            let mut items = self.items.lock().unwrap();
            let swapped = crate::host::setting_values_equal(&items, expected);
            if swapped {
                *items = value.clone();
            }
            Ok(crate::host::CompareAndSetOutcome {
                swapped,
                current: Some(items.clone()),
            })
        }
    }

    // Lua has one empty table for `[]` and `{}`; reading an empty list and
    // handing it back must still match.
    #[test]
    fn lua_ctx_module_compare_and_set_setting_matches_an_empty_list() {
        let settings = std::sync::Arc::new(ListSettings {
            items: std::sync::Mutex::new(serde_json::json!([])),
        });
        let mut host = noop_host_context();
        host.settings = settings.clone();
        let adapter = LuaAdapter::new().unwrap();
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host,
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "2.0.0".to_string(),
            permissions: Default::default(),
            url_settings: Default::default(),
            deadline: std::time::Instant::now() + crate::host::MAX_INVOCATION_TIMEOUT,
        };
        let code = r#"
            function run(ctx)
                local items = ctx.module.settings.items
                local outcome = ctx.module.compareAndSetSetting("items", items, { { label = "Pizza" } })
                return { swapped = outcome.swapped }
            end
        "#;
        let result = adapter.execute(code, "run", &invocation).unwrap();
        assert_eq!(result["swapped"], true);
        assert_eq!(
            *settings.items.lock().unwrap(),
            serde_json::json!([{ "label": "Pizza" }])
        );
    }

    // Lua has one empty table for `[]` and `{}`, and nil for a key the
    // streamer never saved; both must still match what the instance holds.
    #[test]
    fn lua_ctx_resources_compare_and_set_setting_writes_from_what_was_read() {
        let instance = std::sync::Arc::new(crate::host::recording::InstanceSettings::new(
            "wheel_spin:wheel:prizes",
            serde_json::json!({ "winners": [] }),
        ));
        let mut host = noop_host_context();
        host.resources = instance.clone();
        let adapter = LuaAdapter::new().unwrap();
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host,
            module_id: "wheel_spin".to_string(),
            module_name: "Wheel Spin".to_string(),
            module_version: "1.0.0".to_string(),
            permissions: Default::default(),
            url_settings: Default::default(),
            deadline: std::time::Instant::now() + crate::host::MAX_INVOCATION_TIMEOUT,
        };
        let code = r#"
            function run(ctx)
                local id = "wheel_spin:wheel:prizes"
                local settings = ctx.resources.get(id).settings
                local items = ctx.resources.compareAndSetSetting(id, "items", settings.items, { { label = "Pizza" } })
                local winners = ctx.resources.compareAndSetSetting(id, "winners", settings.winners, { "Ann" })
                local stale = ctx.resources.compareAndSetSetting(id, "items", nil, {})
                return { items = items.swapped, winners = winners.swapped, stale = stale.swapped }
            end
        "#;
        let result = adapter.execute(code, "run", &invocation).unwrap();
        assert_eq!(result["items"], true);
        assert_eq!(result["winners"], true);
        assert_eq!(result["stale"], false);
        let settings = instance.settings.lock().unwrap();
        assert_eq!(settings["items"], serde_json::json!([{ "label": "Pizza" }]));
        assert_eq!(settings["winners"], serde_json::json!(["Ann"]));
    }
}
