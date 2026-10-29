use crate::error::Error;
use crate::host::{HostError, InvocationContext};
use crate::runtime::RuntimeAdapter;
use crate::runtime::limits::{Budget, ConversionLimits, SandboxLimits, Trip};
use mlua::{
    ChunkMode, Function, HookTriggers, Lua, LuaOptions, LuaSerdeExt, StdLib, Value as LuaValue,
    VmState,
};
use serde_json::Value;
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Instant;

/// The only globals module code may see. mlua opens the base library even
/// under `StdLib::NONE`, so every other global is removed before host
/// bindings are installed. Notable omissions: `dofile` and `loadfile` read
/// host files (and echo their contents in parse errors); `load` and
/// `loadstring` compile code at runtime, including unverified binary chunks,
/// which are a memory-corruption primitive; `print` writes to the engine's
/// stdout; `collectgarbage` lets a module stall or tune the host's collector;
/// `require` loads code by a caller-supplied name.
const LUA_ALLOWED_GLOBALS: &[&str] = &[
    "assert",
    "error",
    "ipairs",
    "next",
    "pairs",
    "pcall",
    "rawequal",
    "rawget",
    "rawlen",
    "rawset",
    "select",
    "setmetatable",
    "getmetatable",
    "tonumber",
    "tostring",
    "type",
    "xpcall",
    "_G",
    "_VERSION",
];

/// Globals that reach outside the sandbox. Checked after the strip so a
/// change to the allow-list or to mlua's base library fails the invocation
/// instead of handing these to module code.
const LUA_FORBIDDEN_GLOBALS: &[&str] = &[
    "dofile",
    "loadfile",
    "load",
    "loadstring",
    "print",
    "collectgarbage",
    "require",
];

/// Replacements for two allowed globals whose stock versions run module code
/// with debug hooks off, out of reach of the instruction and deadline checks.
///
/// Lua turns hooks off while a hook runs, and an error a hook raises keeps
/// them off until a `pcall` boundary unwinds. The stock `xpcall` calls its
/// message handler at the point of the error, before that unwinding, so a
/// handler that loops would never be stopped. This `xpcall` calls the handler
/// after `pcall` has unwound instead. A handler that fails makes it return
/// `false` and the handler's error, where the stock one reports an error in
/// error handling; the handler cannot inspect the stack either way, since
/// `debug` is not a global.
///
/// Lua also runs `__gc` finalizers with hooks off, so `setmetatable` refuses a
/// metatable that carries one. A `__gc` added to the metatable afterwards is
/// never honoured by Lua.
const LUA_HOOK_SAFE_GLOBALS: &str = r#"
local error, pcall, rawget, setmetatable, type = error, pcall, rawget, setmetatable, type

local function settle(handler, ok, ...)
    if ok then
        return true, ...
    end
    local _, handled = pcall(handler, (...))
    return false, handled
end

_G.xpcall = function(f, handler, ...)
    return settle(handler, pcall(f, ...))
end

_G.setmetatable = function(t, mt)
    if type(mt) == "table" and rawget(mt, "__gc") ~= nil then
        error("setmetatable: __gc metamethods are not allowed in the sandbox", 2)
    end
    return setmetatable(t, mt)
end
"#;

pub struct LuaAdapter {
    limits: SandboxLimits,
}

impl LuaAdapter {
    /// `limits` must already have passed [`SandboxLimits::validate`], as
    /// every `Sandbox` checks on construction.
    pub fn new(limits: SandboxLimits) -> Self {
        debug_assert_eq!(limits.validate(), Ok(()));
        Self { limits }
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
        lua.set_memory_limit(self.limits.memory_bytes)?;
        strip_globals(&lua)?;
        lua.load(LUA_HOOK_SAFE_GLOBALS)
            .set_name("=sandbox")
            .set_mode(ChunkMode::Text)
            .exec()?;

        let trip = Rc::new(Cell::new(None));
        install_budget_hook(&lua, &self.limits, invocation.deadline, trip.clone());

        let run = || -> Result<Value, Error> {
            let ctx_table = build_lua_ctx(&lua, invocation, self.limits.conversion)?;
            lua.load(code).set_mode(ChunkMode::Text).exec()?;
            let main: Function = lua.globals().get(entry_point)?;
            let result = main.call::<LuaValue>(ctx_table)?;
            lua_to_json(&lua, &result, &mut Budget::new(self.limits.conversion))
        };
        let outcome = run();
        // Whatever error surfaced, a tripped budget is the reason: module code
        // may have caught the trip and failed some other way while unwinding.
        match trip.get() {
            Some(trip) => Err(trip.into()),
            None => outcome,
        }
    }
}

/// Checks the instruction budget and the invocation deadline every
/// `hook_interval` instructions, recording the first trip in `trip`.
///
/// A hook error is an ordinary Lua error, so `pcall` would catch it and let the
/// module carry on. After the first trip the hook is re-installed to fail every
/// instruction: a handler that catches the error cannot run a single
/// instruction of its own, and the error unwinds through every `pcall` to the
/// entry point.
fn install_budget_hook(
    lua: &Lua,
    limits: &SandboxLimits,
    deadline: Instant,
    trip: Rc<Cell<Option<Trip>>>,
) {
    let interval = limits.hook_interval;
    let max_instructions = limits.max_instructions;
    let executed = Cell::new(0u64);
    lua.set_hook(
        HookTriggers::new().every_nth_instruction(interval),
        move |lua, _| {
            let total = executed.get().saturating_add(u64::from(interval));
            executed.set(total);
            let reason = if total > max_instructions {
                Trip::Instructions
            } else if Instant::now() >= deadline {
                Trip::Deadline
            } else {
                return Ok(VmState::Continue);
            };
            trip.set(Some(reason));
            lua.set_hook(HookTriggers::new().every_nth_instruction(1), move |_, _| {
                Err(mlua::Error::RuntimeError(reason.to_string()))
            });
            Err(mlua::Error::RuntimeError(reason.to_string()))
        },
    );
}

/// Removes every global not in [`LUA_ALLOWED_GLOBALS`], then asserts none of
/// [`LUA_FORBIDDEN_GLOBALS`] survived.
fn strip_globals(lua: &Lua) -> Result<(), Error> {
    let globals = lua.globals();
    let mut removed = Vec::new();
    for pair in globals.pairs::<LuaValue, LuaValue>() {
        let (key, _) = pair?;
        let allowed = match &key {
            LuaValue::String(name) => LUA_ALLOWED_GLOBALS
                .iter()
                .any(|allowed| *name.as_bytes() == *allowed.as_bytes()),
            _ => false,
        };
        if !allowed {
            removed.push(key);
        }
    }
    for key in removed {
        globals.raw_remove(key)?;
    }
    for name in LUA_FORBIDDEN_GLOBALS {
        if !globals.raw_get::<LuaValue>(*name)?.is_nil() {
            return Err(Error::RuntimeError(format!(
                "Lua global `{name}` survived the sandbox allow-list"
            )));
        }
    }
    Ok(())
}

/// Stringifies a value for the `ctx.log.*` functions: Lua strings are
/// logged verbatim (via `to_string_lossy`, so a non-UTF8 Lua string still
/// logs something instead of erroring), everything else is JSON-encoded —
/// the encoding rule itself lives in `host_bindings::format_log_value`,
/// shared with the QuickJS adapter; only the Lua-native string fast path
/// stays here; see that function's mlua-independent JSON-value contract.
fn format_log_value(lua: &Lua, value: &LuaValue, limits: ConversionLimits) -> String {
    if let LuaValue::String(s) = value {
        return s.to_string_lossy();
    }
    match lua_to_json(lua, value, &mut Budget::new(limits)) {
        Ok(json) => super::host_bindings::format_log_value(&json),
        Err(err) => format!("<unloggable value: {:?}: {err}>", value.type_name()),
    }
}

/// Converts a value a module passed to a host binding. A refusal is raised
/// in the script, where module code can catch it with `pcall`.
fn binding_arg(lua: &Lua, value: &LuaValue, limits: ConversionLimits) -> mlua::Result<Value> {
    lua_to_json(lua, value, &mut Budget::new(limits))
        .map_err(|e| mlua::Error::RuntimeError(e.to_string()))
}

/// Converts a host binding's answer, or an event, into a value for the
/// script.
fn binding_return(lua: &Lua, value: &Value, limits: ConversionLimits) -> mlua::Result<LuaValue> {
    json_to_lua(lua, value, &mut Budget::new(limits))
        .map_err(|e| mlua::Error::RuntimeError(e.to_string()))
}

/// Converts JSON to a Lua value within `budget`, the mirror of
/// [`lua_to_json`]. Arrays carry mlua's array metatable so an empty one
/// converts back to an array; `null` becomes mlua's `null` sentinel.
fn json_to_lua(lua: &Lua, value: &Value, budget: &mut Budget) -> Result<LuaValue, Error> {
    budget.charge_node()?;
    match value {
        Value::Null => Ok(LuaValue::NULL),
        Value::Bool(b) => Ok(LuaValue::Boolean(*b)),
        Value::Number(n) => Ok(match n.as_i64() {
            Some(i) => LuaValue::Integer(i),
            None => LuaValue::Number(n.as_f64().unwrap_or(f64::NAN)),
        }),
        Value::String(s) => {
            budget.charge_text(s.len())?;
            Ok(LuaValue::String(lua.create_string(s)?))
        }
        Value::Array(items) => budget.nested(|budget| {
            let table = lua.create_table_with_capacity(items.len(), 0)?;
            table.set_metatable(Some(lua.array_metatable()));
            for (index, item) in items.iter().enumerate() {
                table.raw_set(index + 1, json_to_lua(lua, item, budget)?)?;
            }
            Ok(LuaValue::Table(table))
        }),
        Value::Object(map) => budget.nested(|budget| {
            let table = lua.create_table_with_capacity(0, map.len())?;
            for (key, item) in map {
                budget.charge_text(key.len())?;
                table.raw_set(key.as_str(), json_to_lua(lua, item, budget)?)?;
            }
            Ok(LuaValue::Table(table))
        }),
    }
}

/// Converts a Lua value to JSON within `budget`. Recursion happens only
/// inside [`Budget::nested`], so depth is bounded and a cyclic table is
/// refused as too deep. Functions, threads and userdata have no JSON form
/// and are refused; mlua's `null` sentinel becomes `null`.
fn lua_to_json(lua: &Lua, value: &LuaValue, budget: &mut Budget) -> Result<Value, Error> {
    budget.charge_node()?;
    match value {
        LuaValue::Nil => Ok(Value::Null),
        LuaValue::LightUserData(ud) if ud.0.is_null() => Ok(Value::Null),
        LuaValue::Boolean(b) => Ok(Value::Bool(*b)),
        LuaValue::Integer(i) => Ok(Value::Number((*i).into())),
        LuaValue::Number(n) => Ok(serde_json::Number::from_f64(*n)
            .map(Value::Number)
            .unwrap_or(Value::Null)),
        LuaValue::String(s) => {
            let text = lua_text(s)?;
            budget.charge_text(text.len())?;
            Ok(Value::String(text))
        }
        LuaValue::Table(table) => budget.nested(|budget| lua_table_to_json(lua, table, budget)),
        other => Err(Error::UnsupportedValue {
            type_name: other.type_name().to_string(),
        }),
    }
}

/// A table whose keys are exactly `1..=n` becomes an array, as does an empty
/// table carrying mlua's array metatable (how `lua.to_value` marks an empty
/// JSON array so it round-trips). Any other table becomes an object keyed by
/// its string and integer keys.
fn lua_table_to_json(lua: &Lua, table: &mlua::Table, budget: &mut Budget) -> Result<Value, Error> {
    let len = table.raw_len();
    let mut entries = 0usize;
    let mut sequence_entries = 0usize;
    for pair in table.pairs::<LuaValue, LuaValue>() {
        let (key, _) = pair?;
        entries += 1;
        if let LuaValue::Integer(i) = key
            && i >= 1
            && (i as u64) <= len as u64
        {
            sequence_entries += 1;
        }
    }

    let marked_array = table
        .metatable()
        .is_some_and(|meta| meta == lua.array_metatable());
    if entries == len && sequence_entries == len && (len > 0 || marked_array) {
        let mut items = Vec::new();
        for index in 1..=len {
            let item: LuaValue = table.raw_get(index)?;
            items.push(lua_to_json(lua, &item, budget)?);
        }
        return Ok(Value::Array(items));
    }

    let mut map = serde_json::Map::new();
    for pair in table.pairs::<LuaValue, LuaValue>() {
        let (key, item) = pair?;
        let key = match key {
            LuaValue::String(s) => lua_text(&s)?,
            LuaValue::Integer(i) => i.to_string(),
            other => {
                return Err(Error::UnsupportedValue {
                    type_name: format!("table key of type {}", other.type_name()),
                });
            }
        };
        budget.charge_text(key.len())?;
        let item = lua_to_json(lua, &item, budget)?;
        if map.insert(key.clone(), item).is_some() {
            return Err(Error::UnsupportedValue {
                type_name: format!("table with duplicate key {key:?}"),
            });
        }
    }
    Ok(Value::Object(map))
}

fn lua_text(s: &mlua::String) -> Result<String, Error> {
    s.to_str()
        .map(|text| text.to_string())
        .map_err(|_| Error::UnsupportedValue {
            type_name: "non-UTF-8 string".to_string(),
        })
}

fn build_lua_ctx(
    lua: &Lua,
    invocation: &InvocationContext,
    limits: ConversionLimits,
) -> Result<mlua::Table, Error> {
    let ctx = lua.create_table()?;

    let event = json_to_lua(lua, &invocation.event, &mut Budget::new(limits))?;
    ctx.set("event", event)?;

    let user = json_to_lua(lua, &invocation.user, &mut Budget::new(limits))?;
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
                Ok(Some(v)) => binding_return(lua, &v, limits),
                Ok(None) => Ok(LuaValue::Nil),
                Err(e) => Err(mlua::Error::RuntimeError(e)),
            }
        })?;
        storage.set("get", get_fn)?;

        let host = invocation.host.clone();
        let module_id = invocation.module_id.clone();
        let set_fn = lua.create_function(
            move |lua, (key, value, options): (String, LuaValue, Option<LuaValue>)| {
                let json_val = binding_arg(lua, &value, limits)?;
                let json_options: Option<Value> =
                    options.map(|o| binding_arg(lua, &o, limits)).transpose()?;
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
                let json_expected = binding_arg(lua, &expected, limits)?;
                let json_val = binding_arg(lua, &value, limits)?;
                let json_options: Option<Value> =
                    options.map(|o| binding_arg(lua, &o, limits)).transpose()?;
                let outcome = super::host_bindings::storage_compare_and_set(
                    &host,
                    &module_id,
                    &key,
                    Some(json_expected),
                    json_val,
                    super::host_bindings::parse_storage_set_options(json_options.as_ref()),
                )
                .map_err(mlua::Error::RuntimeError)?;
                binding_return(lua, &outcome, limits)
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
        let deadline = invocation.deadline;
        let request_fn = lua.create_function(
            move |lua, (url, method, opts): (String, String, LuaValue)| {
                let json_opts = binding_arg(lua, &opts, limits)?;
                let result = client
                    .request(crate::host::HttpRequest {
                        module_id: &module_id,
                        grants: &grants,
                        url: &url,
                        method: &method,
                        opts: json_opts,
                        enforcement: crate::host::Enforcement::Policy,
                        deadline: Some(deadline),
                    })
                    .map_err(mlua::Error::RuntimeError)?;
                binding_return(lua, &result, limits)
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
                let json_settings: Option<Value> =
                    settings.map(|s| binding_arg(lua, &s, limits)).transpose()?;
                match super::host_bindings::resources_create(
                    &host,
                    &module_name,
                    &kind,
                    &instance_id,
                    &display,
                    json_settings,
                ) {
                    Ok(v) => binding_return(lua, &v, limits),
                    Err(e) => Err(mlua::Error::RuntimeError(e)),
                }
            },
        )?;
        resources.set("create", create_fn)?;

        let host = invocation.host.clone();
        let module_id = invocation.module_id.clone();
        let delete_fn = lua.create_function(move |_lua, canonical_id: String| {
            super::host_bindings::resources_delete(&host, &module_id, &canonical_id)
                .map_err(mlua::Error::RuntimeError)?;
            Ok(())
        })?;
        resources.set("delete", delete_fn)?;

        let host = invocation.host.clone();
        let module_id = invocation.module_id.clone();
        let link_settings = invocation.resource_link_settings.clone();
        let get_fn = lua.create_function(move |lua, canonical_id: String| {
            match super::host_bindings::resources_get(
                &host,
                &module_id,
                &link_settings,
                &canonical_id,
            ) {
                Ok(v) => binding_return(lua, &v, limits),
                Err(e) => Err(mlua::Error::RuntimeError(e)),
            }
        })?;
        resources.set("get", get_fn)?;

        let host = invocation.host.clone();
        let module_id = invocation.module_id.clone();
        let link_settings = invocation.resource_link_settings.clone();
        let list_fn =
            lua.create_function(
                move |lua, kind: String| match super::host_bindings::resources_list(
                    &host,
                    &module_id,
                    &link_settings,
                    &kind,
                ) {
                    Ok(v) => binding_return(lua, &v, limits),
                    Err(e) => Err(mlua::Error::RuntimeError(e)),
                },
            )?;
        resources.set("list", list_fn)?;

        let host = invocation.host.clone();
        let module_id = invocation.module_id.clone();
        let permissions = invocation.permissions.clone();
        let link_settings = invocation.resource_link_settings.clone();
        let deadline = invocation.deadline;
        let run_fn = lua.create_function(
            move |lua, (canonical_id, verb, params): (String, String, Option<LuaValue>)| {
                let json_params: Option<Value> =
                    params.map(|p| binding_arg(lua, &p, limits)).transpose()?;
                match super::host_bindings::resources_run(
                    &host,
                    &crate::host::RunCaller {
                        module_id: &module_id,
                        permissions: &permissions,
                        resource_link_settings: &link_settings,
                        deadline,
                    },
                    &canonical_id,
                    &verb,
                    json_params,
                ) {
                    Ok(v) => binding_return(lua, &v, limits),
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
                    let json_expected = binding_arg(lua, &expected, limits)?;
                    let json_val = binding_arg(lua, &value, limits)?;
                    let outcome = super::host_bindings::resources_compare_and_set_setting(
                        &host,
                        &module_id,
                        &canonical_id,
                        &key,
                        &json_expected,
                        &json_val,
                    )
                    .map_err(mlua::Error::RuntimeError)?;
                    binding_return(lua, &outcome, limits)
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
                move |lua,
                      (deadline_id, key, when_ms, params): (
                    String,
                    String,
                    f64,
                    Option<LuaValue>,
                )| {
                    let json_params: Option<Value> =
                        params.map(|p| binding_arg(lua, &p, limits)).transpose()?;
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
        let protected_settings = invocation.protected_settings.clone();
        let link_settings = invocation.resource_link_settings.clone();
        let set_setting_fn = lua.create_function(move |_, (key, value): (String, String)| {
            super::host_bindings::set_module_setting(
                &host_for_set,
                &module_id_for_set,
                &protected_settings,
                &link_settings,
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
        let protected_settings_for_cas = invocation.protected_settings.clone();
        let link_settings_for_cas = invocation.resource_link_settings.clone();
        let compare_and_set_setting_fn = lua.create_function(
            move |lua, (key, expected, value): (String, LuaValue, LuaValue)| {
                let json_expected = binding_arg(lua, &expected, limits)?;
                let json_val = binding_arg(lua, &value, limits)?;
                let outcome = super::host_bindings::compare_and_set_module_setting(
                    &host_for_cas,
                    &module_id_for_cas,
                    &protected_settings_for_cas,
                    &link_settings_for_cas,
                    &key,
                    &json_expected,
                    &json_val,
                )
                .map_err(mlua::Error::RuntimeError)?;
                binding_return(lua, &outcome, limits)
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
                    let lua_val = binding_return(lua, v, limits)?;
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
    // the calling module's id. `print` is stripped from the globals (see
    // `LUA_ALLOWED_GLOBALS`), so this is the only way for a module function
    // to emit a log line.
    let log = lua.create_table()?;
    {
        let module_id = invocation.module_id.clone();
        let info_fn = lua.create_function(move |lua, value: LuaValue| {
            tracing::info!(
                "[module:{}] {}",
                module_id,
                format_log_value(lua, &value, limits)
            );
            Ok(())
        })?;
        log.set("info", info_fn)?;

        let module_id = invocation.module_id.clone();
        let warn_fn = lua.create_function(move |lua, value: LuaValue| {
            tracing::warn!(
                "[module:{}] {}",
                module_id,
                format_log_value(lua, &value, limits)
            );
            Ok(())
        })?;
        log.set("warn", warn_fn)?;

        let module_id = invocation.module_id.clone();
        let error_fn = lua.create_function(move |lua, value: LuaValue| {
            tracing::error!(
                "[module:{}] {}",
                module_id,
                format_log_value(lua, &value, limits)
            );
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
        binding_return(lua, &value, limits)
    })?;
    ctx.set("response", response_fn)?;

    // success/failure — response with extra fields; fields are converted to
    // JSON and validated host-side so the reserved names cannot be overwritten.
    for (name, success) in [("success", true), ("failure", false)] {
        let outcome_fn =
            lua.create_function(move |lua, (message, fields): (String, Option<LuaValue>)| {
                let fields = fields.map(|v| binding_arg(lua, &v, limits)).transpose()?;
                let value = super::host_bindings::build_outcome_value(success, message, fields)
                    .map_err(mlua::Error::RuntimeError)?;
                binding_return(lua, &value, limits)
            })?;
        ctx.set(name, outcome_fn)?;
    }

    // result — a function's result together with events it asks the engine
    // to publish. Pure data constructor; the engine checks and publishes the
    // events once the function returns it (see function_result.rs).
    let result_fn = lua.create_function(move |lua, (value, events): (LuaValue, LuaValue)| {
        let to_json = |v: &LuaValue| binding_arg(lua, v, limits);
        let envelope =
            crate::function_result::build_result_value(to_json(&value)?, to_json(&events)?);
        binding_return(lua, &envelope, limits)
    })?;
    ctx.set("result", result_fn)?;

    bind_extensions(lua, &ctx, invocation, limits)?;

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
    limits: ConversionLimits,
) -> mlua::Result<()> {
    let raise_on_failure: Function = lua
        .load(RAISE_ON_FAILURE)
        .set_mode(ChunkMode::Text)
        .eval()?;
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
                let value = binding_arg(lua, &arg, limits)?;
                match func.call(&namespace, &scope, value) {
                    Ok(result) => Ok((true, binding_return(lua, &result, limits)?)),
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
            protected_settings: Default::default(),
            local_endpoints: Default::default(),
            resource_link_settings: Default::default(),
            deadline: std::time::Instant::now() + crate::host::MAX_INVOCATION_TIMEOUT,
        };
        let adapter = LuaAdapter::new(SandboxLimits::default());
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
            protected_settings: Default::default(),
            local_endpoints: Default::default(),
            resource_link_settings: Default::default(),
            deadline: std::time::Instant::now() + crate::host::MAX_INVOCATION_TIMEOUT,
        };
        let adapter = LuaAdapter::new(SandboxLimits::default());
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
        let adapter = LuaAdapter::new(SandboxLimits::default());
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host: noop_host_context(),
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "2.0.0".to_string(),
            permissions: Default::default(),
            protected_settings: Default::default(),
            local_endpoints: Default::default(),
            resource_link_settings: Default::default(),
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
        let adapter = LuaAdapter::new(SandboxLimits::default());
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host: noop_host_context(),
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "2.0.0".to_string(),
            permissions: Default::default(),
            protected_settings: Default::default(),
            local_endpoints: Default::default(),
            resource_link_settings: Default::default(),
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

    fn outcome_test_invocation() -> InvocationContext {
        InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host: noop_host_context(),
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "2.0.0".to_string(),
            permissions: Default::default(),
            protected_settings: Default::default(),
            local_endpoints: Default::default(),
            resource_link_settings: Default::default(),
            deadline: std::time::Instant::now() + crate::host::MAX_INVOCATION_TIMEOUT,
        }
    }

    #[test]
    fn lua_ctx_success_and_failure_build_the_response_with_fields() {
        let adapter = LuaAdapter::new(SandboxLimits::default());
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host: noop_host_context(),
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "2.0.0".to_string(),
            permissions: Default::default(),
            protected_settings: Default::default(),
            local_endpoints: Default::default(),
            resource_link_settings: Default::default(),
            deadline: std::time::Instant::now() + crate::host::MAX_INVOCATION_TIMEOUT,
        };
        // (call, success, message, extra field name, extra field value)
        let cases = [
            ("ctx.success('ok')", true, "ok", "", serde_json::Value::Null),
            (
                "ctx.success('ok', {})",
                true,
                "ok",
                "",
                serde_json::Value::Null,
            ),
            (
                "ctx.failure('bad', { code = 7 })",
                false,
                "bad",
                "code",
                serde_json::json!(7),
            ),
            (
                "ctx.success('hi', { who = 'ann' })",
                true,
                "hi",
                "who",
                serde_json::json!("ann"),
            ),
        ];
        for (call, success, message, extra, extra_value) in cases {
            let code = format!("function run(ctx) return {call} end");
            let result = adapter.execute(&code, "run", &invocation).unwrap();
            assert_eq!(result["proto"], "woofx3.response", "{call}");
            assert_eq!(result["v"], 1, "{call}");
            assert_eq!(result["success"], success, "{call}");
            assert_eq!(result["message"], message, "{call}");
            if !extra.is_empty() {
                assert_eq!(result[extra], extra_value, "{call}");
            }
        }
    }

    #[test]
    fn lua_ctx_success_and_failure_refuse_bad_fields() {
        let adapter = LuaAdapter::new(SandboxLimits::default());
        let invocation = outcome_test_invocation();
        // (fields argument source, expected error substring)
        let cases = [
            ("{ proto = 1 }", "reserved name 'proto'"),
            ("{ v = 1 }", "reserved name 'v'"),
            ("{ success = 1 }", "reserved name 'success'"),
            ("{ message = 1 }", "reserved name 'message'"),
            ("5", "fields must be an object"),
            ("'text'", "fields must be an object"),
            ("{ 1, 2 }", "fields must be an object"),
        ];
        for (fields, want) in cases {
            for func in ["success", "failure"] {
                let code = format!("function run(ctx) return ctx.{func}('x', {fields}) end");
                let err = adapter.execute(&code, "run", &invocation).unwrap_err();
                assert!(err.to_string().contains(want), "{func} {fields}: {err}");
            }
        }
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
        let adapter = LuaAdapter::new(SandboxLimits::default());
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host,
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "2.0.0".to_string(),
            permissions: Default::default(),
            protected_settings: Default::default(),
            local_endpoints: Default::default(),
            resource_link_settings: Default::default(),
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
        let adapter = LuaAdapter::new(SandboxLimits::default());
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host,
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "2.0.0".to_string(),
            permissions: Default::default(),
            protected_settings: Default::default(),
            local_endpoints: Default::default(),
            resource_link_settings: Default::default(),
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
        let adapter = LuaAdapter::new(SandboxLimits::default());
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host,
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "2.0.0".to_string(),
            permissions: Default::default(),
            protected_settings: Default::default(),
            local_endpoints: Default::default(),
            resource_link_settings: Default::default(),
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
        let adapter = LuaAdapter::new(SandboxLimits::default());
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host: noop_host_context(),
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "2.0.0".to_string(),
            permissions: Default::default(),
            protected_settings: Default::default(),
            local_endpoints: Default::default(),
            resource_link_settings: Default::default(),
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
        let adapter = LuaAdapter::new(SandboxLimits::default());
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host,
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "2.0.0".to_string(),
            permissions: Default::default(),
            protected_settings: Default::default(),
            local_endpoints: Default::default(),
            resource_link_settings: Default::default(),
            deadline: std::time::Instant::now() + crate::host::MAX_INVOCATION_TIMEOUT,
        };
        let code = r#"
            function run(ctx)
                local items = ctx.module.settings.items
                local outcome = ctx.module.compareAndSetSetting("items", items, { { label = "first" } })
                return { swapped = outcome.swapped }
            end
        "#;
        let result = adapter.execute(code, "run", &invocation).unwrap();
        assert_eq!(result["swapped"], true);
        assert_eq!(
            *settings.items.lock().unwrap(),
            serde_json::json!([{ "label": "first" }])
        );
    }

    // Lua has one empty table for `[]` and `{}`, and nil for a key the
    // streamer never saved; both must still match what the instance holds.
    #[test]
    fn lua_ctx_resources_compare_and_set_setting_writes_from_what_was_read() {
        let instance = std::sync::Arc::new(crate::host::recording::InstanceSettings::new(
            "mymod:list:main",
            serde_json::json!({ "tags": [] }),
        ));
        let mut host = noop_host_context();
        host.resources = instance.clone();
        let adapter = LuaAdapter::new(SandboxLimits::default());
        let invocation = InvocationContext {
            event: serde_json::Value::Null,
            user: serde_json::Value::Null,
            host,
            module_id: "mymod".to_string(),
            module_name: "My Module".to_string(),
            module_version: "1.0.0".to_string(),
            permissions: Default::default(),
            protected_settings: Default::default(),
            local_endpoints: Default::default(),
            resource_link_settings: Default::default(),
            deadline: std::time::Instant::now() + crate::host::MAX_INVOCATION_TIMEOUT,
        };
        let code = r#"
            function run(ctx)
                local id = "mymod:list:main"
                local settings = ctx.resources.get(id).settings
                local items = ctx.resources.compareAndSetSetting(id, "items", settings.items, { { label = "first" } })
                local tags = ctx.resources.compareAndSetSetting(id, "tags", settings.tags, { "a" })
                local stale = ctx.resources.compareAndSetSetting(id, "items", nil, {})
                return { items = items.swapped, tags = tags.swapped, stale = stale.swapped }
            end
        "#;
        let result = adapter.execute(code, "run", &invocation).unwrap();
        assert_eq!(result["items"], true);
        assert_eq!(result["tags"], true);
        assert_eq!(result["stale"], false);
        let settings = instance.settings.lock().unwrap();
        assert_eq!(settings["items"], serde_json::json!([{ "label": "first" }]));
        assert_eq!(settings["tags"], serde_json::json!(["a"]));
    }
}
