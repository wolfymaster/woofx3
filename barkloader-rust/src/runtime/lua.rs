use crate::error::Error;
use crate::runtime::RuntimeAdapter;
use mlua::{Lua, LuaOptions, StdLib, Value as LuaValue};
use serde_json::Value;

pub struct LuaAdapter {
    lua: Lua,
}

impl LuaAdapter {
    pub fn new() -> Result<Self, Error> {
        let stdlib = StdLib::ALL_NO_DEBUG & !StdLib::IO & !StdLib::OS & !StdLib::PACKAGE;
        let lua = Lua::new_with(stdlib, LuaOptions::new().set_sandboxed(true))?;
        let adapter = Self { lua };
        adapter.create_sandbox()?;
        Ok(adapter)
    }
    
    fn json_to_lua(&self, value: &Value) -> Result<LuaValue, Error> {
        // Convert JSON value to Lua value
        // Implementation depends on mlua version and specifics
        Ok(self.lua.to_value(value)?)
    }
    
    fn lua_to_json(&self, value: LuaValue) -> Result<Value, Error> {
        // Convert Lua value to JSON value
        // Implementation depends on mlua version and specifics
        Ok(serde_json::to_value(value)?)
    }
}

impl RuntimeAdapter for LuaAdapter {
    fn execute(&self, code: &str, args: Value) -> Result<Value, Error> {
        // Convert args to Lua
        let lua_args = self.json_to_lua(&args)?;
        
        // Execute Lua code
        let chunk = self.lua.load(code);
        let result = chunk.call::<_, LuaValue>(lua_args)?;
        
        // Convert result back to JSON
        self.lua_to_json(result)
    }
    
    fn create_sandbox(&self) -> Result<(), Error> {
        // Remove potentially dangerous libraries
        let globals = self.lua.globals();
        globals.set("os", self.lua.create_table()?)?;
        globals.set("io", self.lua.create_table()?)?;
        
        // Add safe libraries as needed
        
        Ok(())
    }
}