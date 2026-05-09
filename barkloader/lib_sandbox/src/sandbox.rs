use crate::builtin_dispatch::BuiltinDispatcher;
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
    builtin_dispatcher: Option<Arc<dyn BuiltinDispatcher>>,
}

impl SandboxFactory {
    pub fn new(registry: Arc<ModuleRegistry>, host_ctx: HostContext) -> Self {
        Self {
            registry,
            host_ctx,
            builtin_dispatcher: None,
        }
    }

    /// Inject the native builtin-action dispatcher. Optional: when absent,
    /// any `builtin:<name>` invoke fails fast rather than falling through
    /// to module lookup.
    pub fn with_builtin_dispatcher(mut self, dispatcher: Arc<dyn BuiltinDispatcher>) -> Self {
        self.builtin_dispatcher = Some(dispatcher);
        self
    }

    pub fn create(&self) -> Result<Sandbox, Error> {
        Sandbox::new_with_builtin_dispatcher(
            self.registry.clone(),
            self.host_ctx.clone(),
            self.builtin_dispatcher.clone(),
        )
    }
}

pub struct Sandbox {
    registry: Arc<ModuleRegistry>,
    function_executor: FunctionExecutor,
    host_ctx: HostContext,
    builtin_dispatcher: Option<Arc<dyn BuiltinDispatcher>>,
}

impl Sandbox {
    pub fn new(registry: Arc<ModuleRegistry>, host_ctx: HostContext) -> Result<Self, Error> {
        Self::new_with_builtin_dispatcher(registry, host_ctx, None)
    }

    pub fn new_with_builtin_dispatcher(
        registry: Arc<ModuleRegistry>,
        host_ctx: HostContext,
        builtin_dispatcher: Option<Arc<dyn BuiltinDispatcher>>,
    ) -> Result<Self, Error> {
        Ok(Self {
            registry,
            function_executor: FunctionExecutor::new()?,
            host_ctx,
            builtin_dispatcher,
        })
    }

    pub fn invoke(&self, request: InvokeRequest) -> Result<Value, Error> {
        if let Some(name) = request.function.strip_prefix("builtin:") {
            return self.invoke_builtin(name, request.params);
        }

        let function = self.registry.get_function(&request.function)?;

        // Canonical function path is `<module_id>:function:<func_id>`
        // (validated by `ModuleRegistry::get_function`). The leading
        // segment is the manifest-local module id, which the storage
        // namespace uses to scope auto-emitted change events.
        let module_id = request
            .function
            .split(':')
            .next()
            .unwrap_or("")
            .to_string();

        let invocation = InvocationContext {
            event: request.event,
            user: request.user.unwrap_or(Value::Null),
            host: self.host_ctx.clone(),
            module_id,
        };

        self.function_executor.execute(&function, &invocation)
    }

    fn invoke_builtin(&self, name: &str, params: Value) -> Result<Value, Error> {
        let dispatcher = self
            .builtin_dispatcher
            .as_ref()
            .ok_or_else(|| Error::RuntimeError(
                "builtin dispatcher not configured for sandbox".to_string(),
            ))?;

        match dispatcher.invoke(name, params) {
            Ok(Some(value)) => Ok(value),
            Ok(None) => Err(Error::FunctionNotFound(format!("builtin:{}", name))),
            Err(err) => Err(Error::RuntimeError(err.to_string())),
        }
    }
}
