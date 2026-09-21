use crate::error::{Error, InvokeBlockingError};
use crate::function_executor::FunctionExecutor;
use crate::function_result::resolve_function_result;
use crate::host::{HostContext, InvocationContext};
use crate::models::request::InvokeRequest;
use crate::module_registry::ModuleRegistry;
use serde_json::Value;
use std::sync::Arc;
use tracing::{error, info, warn};
use woofx3_cloudevents::{BaseEvent, now_iso8601};

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
}

impl Sandbox {
    pub fn new(registry: Arc<ModuleRegistry>, host_ctx: HostContext) -> Result<Self, Error> {
        Ok(Self {
            registry,
            function_executor: FunctionExecutor::new(),
            host_ctx,
        })
    }

    pub fn invoke(&mut self, request: InvokeRequest) -> Result<Value, Error> {
        info!("Invoking function function={}", request.function);

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
        let module_id = request.function.split(':').next().unwrap_or("").to_string();

        let meta = self.registry.get_module_metadata(&module_id);
        let invocation = InvocationContext {
            event: request.event,
            user: request.user.unwrap_or(Value::Null),
            host: self.host_ctx.clone(),
            module_id,
            module_name: meta.as_ref().map(|m| m.name.clone()).unwrap_or_default(),
            module_version: meta.as_ref().map(|m| m.version.clone()).unwrap_or_default(),
        };

        let result = self
            .function_executor
            .execute(&function, &invocation)
            .and_then(|value| {
                self.publish_requested_events(
                    &invocation.module_id,
                    request.workflow_chain.clone(),
                    value,
                )
            });

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

    /// Publishes the events a `ctx.result` asks for and returns the value the
    /// caller should see. An envelope that breaks the rules fails the
    /// invocation and publishes nothing.
    ///
    /// A publish that fails is logged, not returned: the function's own effects
    /// (a storage write) have already happened, and failing it would invite a
    /// retry that applies them twice.
    ///
    /// Each event carries `workflow_chain`, the chain of workflow runs the call
    /// was part of, so a loop that runs through a module function is still one
    /// the workflow engine can see.
    fn publish_requested_events(
        &self,
        module_id: &str,
        workflow_chain: Option<String>,
        value: Value,
    ) -> Result<Value, Error> {
        let (value, events) = resolve_function_result(value, &self.registry.event_types(module_id))
            .map_err(Error::RuntimeError)?;
        let source = format!("module/{module_id}");
        for event in events {
            let envelope = BaseEvent::new(&event.event_type, &source, event.data)
                .with_time(now_iso8601())
                .with_workflow_chain(workflow_chain.clone())
                .to_value();
            let published = envelope
                .map_err(|err| err.to_string())
                .and_then(|envelope| self.host_ctx.nats.publish(&event.event_type, envelope));
            if let Err(err) = published {
                error!(
                    "Publishing {} for module {} failed: {}",
                    event.event_type, module_id, err
                );
            }
        }
        Ok(value)
    }
}
