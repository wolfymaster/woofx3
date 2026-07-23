use crate::error::Error;
use crate::host::InvocationContext;
use crate::runtime::RuntimeAdapter;
use mlua::{Function, HookTriggers, Lua, LuaOptions, LuaSerdeExt, StdLib, Value as LuaValue, VmState};
use serde_json::Value;
use std::cell::Cell;

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
/// logged verbatim, everything else is JSON-encoded so structured data is
/// still readable in the host log line.
fn format_log_value(value: &LuaValue) -> String {
    if let LuaValue::String(s) = value {
        return s.to_string_lossy();
    }
    match serde_json::to_value(value) {
        Ok(json) => json.to_string(),
        Err(_) => format!("<unloggable value: {:?}>", value.type_name()),
    }
}

fn build_lua_ctx(
    lua: &Lua,
    invocation: &InvocationContext,
) -> Result<mlua::Table, Error> {
    let ctx = lua.create_table()?;

    let event = lua.to_value(&invocation.event)?;
    ctx.set("event", event)?;

    let user = lua.to_value(&invocation.user)?;
    ctx.set("user", user)?;

    // events namespace
    let events = lua.create_table()?;
    {
        let nats = invocation.host.nats.clone();
        let publish = lua.create_function(move |_lua, (subject, data): (String, LuaValue)| {
            let json_data: Value =
                serde_json::to_value(&data).map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
            nats.publish(&subject, json_data)
                .map_err(mlua::Error::RuntimeError)?;
            Ok(())
        })?;
        events.set("publish", publish)?;
    }
    ctx.set("events", events)?;

    // storage namespace
    let storage = lua.create_table()?;
    {
        let store = invocation.host.storage.clone();
        let get_fn = lua.create_function(move |lua, key: String| -> mlua::Result<LuaValue> {
            match store.get(&key) {
                Ok(Some(v)) => lua.to_value(&v),
                Ok(None) => Ok(LuaValue::Nil),
                Err(e) => Err(mlua::Error::RuntimeError(e)),
            }
        })?;
        storage.set("get", get_fn)?;

        let store = invocation.host.storage.clone();
        let nats = invocation.host.nats.clone();
        let module_id = invocation.module_id.clone();
        let set_fn = lua.create_function(move |_, (key, value): (String, LuaValue)| {
            let json_val: Value = serde_json::to_value(&value)
                .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
            store
                .set(&key, json_val.clone())
                .map_err(mlua::Error::RuntimeError)?;
            crate::runtime::storage_event::publish_storage_changed(&nats, &module_id, &key, &json_val);
            Ok(())
        })?;
        storage.set("set", set_fn)?;
    }
    ctx.set("storage", storage)?;

    // http namespace
    let http = lua.create_table()?;
    {
        let client = invocation.host.http.clone();
        let request_fn =
            lua.create_function(move |lua, (url, method, opts): (String, String, LuaValue)| {
                let json_opts: Value = serde_json::to_value(&opts)
                    .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
                let result = client
                    .request(&url, &method, json_opts)
                    .map_err(mlua::Error::RuntimeError)?;
                lua.to_value(&result)
            })?;
        http.set("request", request_fn)?;
    }
    ctx.set("http", http)?;

    // env namespace
    let env = lua.create_table()?;
    {
        let reader = invocation.host.env.clone();
        let get_fn = lua.create_function(move |_, key: String| -> mlua::Result<Option<String>> {
            Ok(reader.get(&key))
        })?;
        env.set("get", get_fn)?;
    }
    ctx.set("env", env)?;

    // resources namespace — runtime-instance lifecycle for kinds the
    // calling module declared in its manifest's `resources[]` block.
    // `owning_module_name` is bound from `invocation.module_id`.
    let resources = lua.create_table()?;
    {
        let client = invocation.host.resources.clone();
        let module_name = invocation.module_id.clone();
        let create_fn = lua.create_function(
            move |lua, (kind, instance_id, display_name): (String, String, Option<String>)| {
                let display = display_name.unwrap_or_default();
                match client.create(&module_name, &kind, &instance_id, &display) {
                    Ok(inst) => {
                        let v = serde_json::to_value(&inst)
                            .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
                        lua.to_value(&v)
                    }
                    Err(e) => Err(mlua::Error::RuntimeError(e)),
                }
            },
        )?;
        resources.set("create", create_fn)?;

        let client = invocation.host.resources.clone();
        let delete_fn = lua.create_function(move |_lua, canonical_id: String| {
            client.delete(&canonical_id).map_err(mlua::Error::RuntimeError)?;
            Ok(())
        })?;
        resources.set("delete", delete_fn)?;

        let client = invocation.host.resources.clone();
        let list_fn = lua.create_function(move |lua, kind: String| match client.list_by_kind(&kind) {
            Ok(items) => {
                let v = serde_json::to_value(&items)
                    .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
                lua.to_value(&v)
            }
            Err(e) => Err(mlua::Error::RuntimeError(e)),
        })?;
        resources.set("list", list_fn)?;
    }
    ctx.set("resources", resources)?;

    // module namespace
    {
        let module_tbl = lua.create_table()?;
        module_tbl.set("id", invocation.module_id.clone())?;
        module_tbl.set("name", invocation.module_name.clone())?;
        module_tbl.set("version", invocation.module_version.clone())?;

        let settings_map = invocation
            .host
            .settings
            .list_by_module(&invocation.module_id)
            .unwrap_or_default();
        let settings_tbl = lua.create_table()?;
        for (k, v) in &settings_map {
            let lua_val = lua.to_value(v)?;
            settings_tbl.set(k.as_str(), lua_val)?;
        }
        module_tbl.set("settings", settings_tbl)?;
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
            log::info!("[module:{}] {}", module_id, format_log_value(&value));
            Ok(())
        })?;
        log.set("info", info_fn)?;

        let module_id = invocation.module_id.clone();
        let warn_fn = lua.create_function(move |_, value: LuaValue| {
            log::warn!("[module:{}] {}", module_id, format_log_value(&value));
            Ok(())
        })?;
        log.set("warn", warn_fn)?;

        let module_id = invocation.module_id.clone();
        let error_fn = lua.create_function(move |_, value: LuaValue| {
            log::error!("[module:{}] {}", module_id, format_log_value(&value));
            Ok(())
        })?;
        log.set("error", error_fn)?;
    }
    ctx.set("log", log)?;

    // response — the standard shape a module function returns when it wants
    // the invoking chat command to reply. Pure data constructor, no host
    // state. Tagged with proto/v (mirroring the woofx3.widget/
    // woofx3.overlay-events envelope convention) so a caller can reliably
    // distinguish a deliberate response from any other table a function
    // might return for its own purposes.
    let response_fn = lua.create_function(move |lua, (success, message): (bool, String)| {
        let tbl = lua.create_table()?;
        tbl.set("proto", "woofx3.response")?;
        tbl.set("v", 1)?;
        tbl.set("success", success)?;
        tbl.set("message", message)?;
        Ok(tbl)
    })?;
    ctx.set("response", response_fn)?;

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

fn bind_extensions(
    lua: &Lua,
    ctx: &mlua::Table,
    invocation: &InvocationContext,
) -> mlua::Result<()> {
    for ext in invocation.host.extensions.iter() {
        let target = ensure_namespace_table(lua, ctx, ext.namespace())?;
        for func in ext.functions() {
            let handler = func.handler.clone();
            let f = lua.create_function(move |lua, arg: LuaValue| {
                let value: Value = serde_json::to_value(&arg)
                    .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
                let result = handler(value).map_err(mlua::Error::RuntimeError)?;
                lua.to_value(&result)
            })?;
            target.set(func.name.as_str(), f)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::{InvocationContext, noop::noop_host_context};
    use crate::runtime::RuntimeAdapter;

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
}
