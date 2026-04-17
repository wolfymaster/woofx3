use crate::error::Error;
use crate::function_executor::FunctionExecutor;
use crate::host::{HostContext, InvocationContext};
use crate::models::request::InvokeRequest;
use crate::module_registry::ModuleRegistry;
use serde_json::Value;
use std::sync::Arc;

#[derive(Clone)]
pub struct SandboxFactory {
    registry: Arc<ModuleRegistry>,
    host_ctx: HostContext,
}

impl SandboxFactory {
    pub fn new(registry: Arc<ModuleRegistry>, host_ctx: HostContext) -> Self {
        Self { registry, host_ctx }
    }

    pub fn create(&self) -> Result<Sandbox, Error> {
        Sandbox::new(self.registry.clone(), self.host_ctx.clone())
    }
}

pub struct Sandbox {
    registry: Arc<ModuleRegistry>,
    function_executor: FunctionExecutor,
    host_ctx: HostContext,
}

impl Sandbox {
    pub fn new(registry: Arc<ModuleRegistry>, host_ctx: HostContext) -> Result<Self, Error> {
        Ok(Self {
            registry,
            function_executor: FunctionExecutor::new()?,
            host_ctx,
        })
    }

    pub fn invoke(&self, request: InvokeRequest) -> Result<Value, Error> {
        let function = self.registry.get_function(&request.function)?;

        let invocation = InvocationContext {
            event: request.event,
            user: request.user.unwrap_or(Value::Null),
            host: self.host_ctx.clone(),
        };

        self.function_executor.execute(&function, &invocation)
    }
}
