use crate::error::Error;
use crate::function_executor::FunctionExecutor;
use crate::models::request::InvokeRequest;
use crate::module_manager::ModuleManager;
use serde_json::Value;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Config {
    pub modules_dir: PathBuf,
}

pub struct Sandbox {
    module_manager: ModuleManager,
    function_executor: FunctionExecutor,
}

impl Sandbox {
    pub fn new(config: Config) -> Result<Self, Error> {
        Ok(Self {
            module_manager: ModuleManager::new(config.modules_dir)?,
            function_executor: FunctionExecutor::new()?,
        })
    }
    
    pub fn invoke(&self, request: InvokeRequest) -> Result<Value, Error> {
        let (module, function) = self.module_manager.get_function(&request.function)?;
        let result = self.function_executor.execute(&function, request.args)?;
        let processed_result = module.post_process(result)?;
        
        Ok(processed_result)
    }
}