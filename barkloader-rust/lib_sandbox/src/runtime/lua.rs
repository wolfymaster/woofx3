use crate::error::Error;
use crate::runtime::RuntimeAdapter;
use mlua::{Function, Lua, LuaOptions, LuaSerdeExt, StdLib, Value as LuaValue};
use serde_json::Value;

pub struct LuaAdapter {
    lua: Lua,
}

impl LuaAdapter {
    pub fn new() -> Result<Self, Error> {
        let stdlib = StdLib::NONE;
        let lua = Lua::new_with(stdlib, LuaOptions::new())?;
        let adapter = Self { lua };
        adapter.create_sandbox()?;
        Ok(adapter)
    }
    
    fn json_to_lua(&self, value: &Value) -> Result<LuaValue, Error> {
        Ok(self.lua.to_value(value)?)
    }
    
    fn lua_to_json(&self, value: LuaValue) -> Result<Value, Error> {
        Ok(serde_json::to_value(value)?)
    }
}

impl RuntimeAdapter for LuaAdapter {
    fn execute(&self, code: &str, args: Value) -> Result<Value, Error> {
        let lua_args = self.json_to_lua(&args)?;
        let _ = self.lua.load(code).exec()?;
        let main: Function = self.lua.globals().get("main")?;
        let result = main.call::<LuaValue>(lua_args)?;
        self.lua_to_json(result)
    }
    
    fn create_sandbox(&self) -> Result<(), Error> {
        Ok(())
    }
}