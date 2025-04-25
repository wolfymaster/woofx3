use crate::error::Error;
use crate::models::function::Function;
use crate::runtime::{RuntimeAdapter, lua::LuaAdapter, bun::BunAdapter};
use serde_json::Value;
use std::collections::HashMap;

pub struct FunctionExecutor {
    adapters: HashMap<String, Box<dyn RuntimeAdapter>>,
}

impl FunctionExecutor {
    pub fn new() -> Result<Self, Error> {
        let mut executor = Self {
            adapters: HashMap::new(),
        };
        
        // Register adapters
        executor.adapters.insert("lua".to_string(), Box::new(LuaAdapter::new()?));
        executor.adapters.insert("js".to_string(), Box::new(BunAdapter::new()?));
        executor.adapters.insert("ts".to_string(), Box::new(BunAdapter::new()?));
        
        Ok(executor)
    }
    
    pub fn execute(&self, function: &Function, args: Value) -> Result<Value, Error> {
        let extension = function.get_extension()
            .ok_or(Error::UnknownFunctionType)?;
        
        let adapter = self.adapters.get(&extension)
            .ok_or(Error::UnsupportedRuntime(extension.clone()))?;
        
        adapter.execute(&function.code, args)
    }
}