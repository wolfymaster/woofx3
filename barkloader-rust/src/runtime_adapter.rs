pub trait RuntimeAdapter {
    fn execute(&self, code: &str, args: Value) -> Result<Value, Error>;
    fn create_sandbox(&self) -> Result<(), Error>;
}

pub struct BunAdapter {}

impl RuntimeAdapter for BunAdapter {
    fn execute(&self, code: &str, args: Value) -> Result<Value, Error> {
        // Execute JavaScript/TypeScript code with Bun
        // Return result
    }
    
    fn create_sandbox(&self) -> Result<(), Error> {
        // Create sandboxed environment for Bun
    }
}

pub struct LuaAdapter {
    lua: Lua,
}

impl RuntimeAdapter for LuaAdapter {
    fn execute(&self, code: &str, args: Value) -> Result<Value, Error> {
        // Execute Lua code with arguments
        // Return result
    }
    
    fn create_sandbox(&self) -> Result<(), Error> {
        // Create sandboxed Lua environment
    }
}