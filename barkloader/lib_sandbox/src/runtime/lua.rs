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

    // twitch namespace
    let twitch = lua.create_table()?;
    {
        let nats = invocation.host.nats.clone();
        let clip = lua.create_function(move |_, ()| {
            let data = serde_json::json!({"command": "clip"});
            nats.publish("twitchapi", data)
                .map_err(mlua::Error::RuntimeError)?;
            Ok(())
        })?;
        twitch.set("clip", clip)?;

        let nats = invocation.host.nats.clone();
        let timeout_fn = lua.create_function(move |_lua, args: LuaValue| {
            let json_args: Value =
                serde_json::to_value(&args).map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
            let data = serde_json::json!({"command": "timeout", "args": json_args});
            nats.publish("twitchapi", data)
                .map_err(mlua::Error::RuntimeError)?;
            Ok(())
        })?;
        twitch.set("timeout", timeout_fn)?;

        let nats = invocation.host.nats.clone();
        let update_stream = lua.create_function(move |_lua, args: LuaValue| {
            let json_args: Value =
                serde_json::to_value(&args).map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
            let data = serde_json::json!({"command": "updateStream", "args": json_args});
            nats.publish("twitchapi", data)
                .map_err(mlua::Error::RuntimeError)?;
            Ok(())
        })?;
        twitch.set("updateStream", update_stream)?;
    }
    ctx.set("twitch", twitch)?;

    // platform namespace
    let platform = lua.create_table()?;
    {
        // platform.alerts
        let alerts = lua.create_table()?;
        let nats = invocation.host.nats.clone();
        let alert_fn = lua.create_function(move |_lua, args: LuaValue| {
            let json_args: Value =
                serde_json::to_value(&args).map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
            let data = serde_json::json!({"command": "alert_message", "args": json_args});
            nats.publish("slobs", data)
                .map_err(mlua::Error::RuntimeError)?;
            Ok(())
        })?;
        alerts.set("alert", alert_fn)?;

        let nats = invocation.host.nats.clone();
        let set_timer = lua.create_function(move |_lua, args: LuaValue| {
            let json_args: Value =
                serde_json::to_value(&args).map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
            let data = serde_json::json!({"command": "setTime", "args": json_args});
            nats.publish("slobs", data)
                .map_err(mlua::Error::RuntimeError)?;
            Ok(())
        })?;
        alerts.set("setTimer", set_timer)?;
        platform.set("alerts", alerts)?;

        // platform.chat
        let chat = lua.create_table()?;
        let nats = invocation.host.nats.clone();
        let register_fn = lua.create_function(move |_lua, args: LuaValue| {
            let json_args: Value =
                serde_json::to_value(&args).map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
            let data = serde_json::json!({"command": "register", "args": json_args});
            nats.publish("woofwoofwoof", data)
                .map_err(mlua::Error::RuntimeError)?;
            Ok(())
        })?;
        chat.set("register", register_fn)?;
        platform.set("chat", chat)?;
    }
    ctx.set("platform", platform)?;

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
        let set_fn = lua.create_function(move |_, (key, value): (String, LuaValue)| {
            let json_val: Value = serde_json::to_value(&value)
                .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
            store
                .set(&key, json_val)
                .map_err(mlua::Error::RuntimeError)?;
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

    // chat namespace
    let chat = lua.create_table()?;
    {
        let sender = invocation.host.chat.clone();
        let send_message = lua.create_function(move |_lua, text: String| {
            sender.send_message(&text).map_err(mlua::Error::RuntimeError)?;
            Ok(())
        })?;
        chat.set("sendMessage", send_message)?;
    }
    ctx.set("chat", chat)?;

    Ok(ctx)
}
