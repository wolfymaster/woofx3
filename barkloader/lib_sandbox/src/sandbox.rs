use crate::builtin_dispatch::BuiltinDispatcher;
use crate::error::{Error, InvokeBlockingError};
use crate::function_executor::FunctionExecutor;
use crate::host::{HostContext, InvocationContext};
use crate::models::request::InvokeRequest;
use crate::module_registry::ModuleRegistry;
use log::{error, info, warn};
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

    /// Creates a fresh `Sandbox` and invokes `request` on Tokio's blocking
    /// thread pool.
    ///
    /// `Sandbox::invoke` drives the QuickJS/Lua runtime synchronously, and
    /// host-side calls it makes along the way (module settings fetch via
    /// `ctx.module.settings`, `ctx.http.request`, ...) block on their own
    /// async I/O internally. Calling `Sandbox::invoke` directly from an
    /// async task panics with "Cannot start a runtime from within a
    /// runtime." This is the single sanctioned entry point for invoking a
    /// sandboxed function from async code — every caller (WebSocket
    /// invoke, the background-task scheduler, the field-options
    /// responder) should go through this rather than calling
    /// `Sandbox::invoke` directly, so the hazard can't be reintroduced by
    /// a future call site forgetting to offload it.
    pub async fn invoke_blocking(
        &self,
        request: InvokeRequest,
    ) -> Result<Value, InvokeBlockingError> {
        let factory = self.clone();
        // The closure's return value has to cross back from the blocking
        // thread pool into this async task, so it has to be `Send`. `Error`
        // isn't (it wraps `mlua::Error`, which can box a non-`Sync` `dyn
        // StdError`) — flatten to a string on the blocking side rather than
        // requiring every error source in this crate to be thread-safe just
        // to satisfy `spawn_blocking`.
        match tokio::task::spawn_blocking(move || {
            factory
                .create()
                .and_then(|mut sandbox| sandbox.invoke(request))
                .map_err(|e| e.to_string())
        })
        .await
        {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(msg)) => Err(InvokeBlockingError::Invoke(msg)),
            Err(join_err) => Err(InvokeBlockingError::TaskJoin(join_err.to_string())),
        }
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
            function_executor: FunctionExecutor::new(),
            host_ctx,
            builtin_dispatcher,
        })
    }

    pub fn invoke(&mut self, request: InvokeRequest) -> Result<Value, Error> {
        info!("Invoking function function={}", request.function);

        let result = if let Some(name) = request.function.strip_prefix("builtin:") {
            self.invoke_builtin(name, request.params, request.event)
        } else {
            let function = self.registry.get_function(&request.function)?;
            info!(
                "Executing sandbox function={} entry_point={}",
                request.function,
                function.resolved_entry_point()
            );

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

            let meta = self.registry.get_module_metadata(&module_id);
            let invocation = InvocationContext {
                event: request.event,
                user: request.user.unwrap_or(Value::Null),
                host: self.host_ctx.clone(),
                module_id,
                module_name: meta.as_ref().map(|m| m.name.clone()).unwrap_or_default(),
                module_version: meta.as_ref().map(|m| m.version.clone()).unwrap_or_default(),
            };

            self.function_executor.execute(&function, &invocation)
        };

        match &result {
            Ok(value) => {
                if value.as_object().is_some_and(|o| o.is_empty()) {
                    warn!(
                        "Function invoke returned empty object function={} — check module source and ctx.event.parameters",
                        request.function
                    );
                }
                info!(
                    "Function invoke succeeded function={} result={}",
                    request.function, value
                );
            }
            Err(err) => {
                error!(
                    "Function invoke failed function={} error={}",
                    request.function, err
                );
            }
        }

        result
    }

    fn invoke_builtin(&self, name: &str, params: Value, event: Value) -> Result<Value, Error> {
        let dispatcher = self
            .builtin_dispatcher
            .as_ref()
            .ok_or_else(|| Error::RuntimeError(
                "builtin dispatcher not configured for sandbox".to_string(),
            ))?;

        match dispatcher.invoke(name, params, event) {
            Ok(Some(value)) => Ok(value),
            Ok(None) => Err(Error::FunctionNotFound(format!("builtin:{}", name))),
            Err(err) => Err(Error::RuntimeError(err.to_string())),
        }
    }
}
