use crate::error::Error;
use crate::function_executor::FunctionExecutor;
use crate::models::request::InvokeRequest;
use crate::module_manager::ModuleManager;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct Config {
    pub modules_dir: PathBuf,
}

enum ModuleManagerVariant {
    Owned(ModuleManager),
    Shared(Arc<ModuleManager>)
}

impl ModuleManagerVariant {
    pub fn get(&self) -> &ModuleManager {
        match self {
            ModuleManagerVariant::Owned(manager) => manager,
            ModuleManagerVariant::Shared(manager) => manager,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SandboxFactory {
    module_manager: Arc<ModuleManager>,
}

impl SandboxFactory {
    pub fn new(config: Config) -> Result<Self, Error> {
        let module_manager = ModuleManager::new(config.modules_dir.clone())?;
        Ok(Self { 
            module_manager: Arc::new(module_manager),
        })
    }

    pub fn create(&self) -> Result<Sandbox, Error> {
        Sandbox::with_shared_manager(
            self.module_manager.clone()
        )
    }
}

pub struct Sandbox {
    module_manager: ModuleManagerVariant,
    function_executor: FunctionExecutor,
}

impl Sandbox {
    pub fn new(config: Config) -> Result<Self, Error> {
        Ok(Self {
            module_manager: ModuleManagerVariant::Owned(ModuleManager::new(config.modules_dir)?),
            function_executor: FunctionExecutor::new()?,
        })
    }

    pub fn with_shared_manager(
        shared_manager: Arc<ModuleManager>
    ) -> Result<Self, Error> {
        Ok(Self {
            module_manager: ModuleManagerVariant::Shared(shared_manager),
            function_executor: FunctionExecutor::new()?,
        })
    }
    
    pub fn invoke(&self, request: InvokeRequest) -> Result<Value, Error> {
        let (module, function) = self.module_manager.get().get_function(&request.function)?;
        let result = self.function_executor.execute(&function, request.args)?;
        let processed_result = module.post_process(result)?;
        
        Ok(processed_result)
    }
}