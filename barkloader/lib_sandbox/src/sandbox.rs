use crate::error::{Error, InvokeBlockingError};
use crate::function_executor::FunctionExecutor;
use crate::function_result::resolve_function_result;
use crate::host::{ActionRunner, HostContext, InvocationContext, MAX_INVOCATION_TIMEOUT, RunCaller};
use crate::models::request::InvokeRequest;
use crate::module_registry::ModuleRegistry;
use serde_json::Value;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{debug, error, warn};
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
        debug!("Invoking function function={}", request.function);
        let timeout = request
            .timeout_ms
            .map(Duration::from_millis)
            .unwrap_or(MAX_INVOCATION_TIMEOUT)
            .min(MAX_INVOCATION_TIMEOUT);
        let deadline = Instant::now() + timeout;

        let function = self.registry.get_function(&request.function)?;
        debug!(
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
        let mut permissions = self.registry.permissions(&module_id);
        // A URL the streamer entered in a `url` setting is a destination they
        // chose, so its origin is granted for this invocation. Read per
        // invocation: the streamer can change it at any time.
        let url_settings = self.registry.url_settings(&module_id);
        if !url_settings.is_empty() {
            let values = self
                .host_ctx
                .settings
                .list_by_module(&module_id)
                .unwrap_or_default();
            for id in &url_settings {
                if let Some(grant) = values
                    .get(id)
                    .and_then(Value::as_str)
                    .and_then(crate::net::origin_grant)
                {
                    permissions.insert(grant);
                }
            }
        }
        let invocation = InvocationContext {
            event: request.event,
            user: request.user.unwrap_or(Value::Null),
            host: self.host_ctx.clone(),
            module_id,
            module_name: meta.as_ref().map(|m| m.name.clone()).unwrap_or_default(),
            module_version: meta.as_ref().map(|m| m.version.clone()).unwrap_or_default(),
            permissions,
            url_settings,
            deadline,
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
                debug!(
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

/// How deep `ctx.resources.run` may nest: an action that runs an action that
/// runs an action. Real chains are one level; the cap stops a loop between two
/// modules' actions from exhausting the stack.
const MAX_RUN_DEPTH: u32 = 4;

thread_local! {
    /// `ctx.resources.run` calls in flight on this thread. A nested run
    /// executes on the caller's thread, so this counts the chain.
    static RUN_DEPTH: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
    /// Why the deepest failed run in the current chain failed. Each level of
    /// a chain that fails would otherwise wrap the error below it, and the
    /// runtimes cut long messages short, losing the one reason that matters.
    static RUN_FAILURE: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
}

/// The engine's `ActionRunner`: resolves the action from the providing
/// module's manifest and invokes its function in a fresh sandbox on the
/// caller's thread, as that module.
///
/// Built before the `HostContext` it runs with — which holds it — so the
/// context is bound afterwards with `bind`.
pub struct SandboxActionRunner {
    registry: Arc<ModuleRegistry>,
    host: std::sync::OnceLock<HostContext>,
}

impl SandboxActionRunner {
    pub fn new(registry: Arc<ModuleRegistry>) -> Arc<Self> {
        Arc::new(Self {
            registry,
            host: std::sync::OnceLock::new(),
        })
    }

    /// Hands the runner the context nested runs use. Only the first call
    /// takes effect.
    pub fn bind(&self, host: HostContext) {
        let _ = self.host.set(host);
    }
}

impl ActionRunner for SandboxActionRunner {
    fn run(
        &self,
        caller: &RunCaller<'_>,
        canonical_id: &str,
        verb: &str,
        params: Value,
    ) -> Result<Value, String> {
        let depth = RUN_DEPTH.with(|d| d.get());
        if depth == 0 {
            RUN_FAILURE.with(|f| f.replace(None));
        }
        let result = if depth >= MAX_RUN_DEPTH {
            Err(format!(
                "ctx.resources.run: actions nested more than {MAX_RUN_DEPTH} deep; is there a loop?"
            ))
        } else {
            RUN_DEPTH.with(|d| d.set(depth + 1));
            let result = self.run_inner(caller, canonical_id, verb, params);
            RUN_DEPTH.with(|d| d.set(depth));
            result
        };
        match result {
            Ok(value) => {
                // Whatever failed further down was handled on the way up.
                RUN_FAILURE.with(|f| f.replace(None));
                Ok(value)
            }
            Err(err) => {
                let reason = RUN_FAILURE.with(|f| f.borrow().clone()).unwrap_or(err);
                RUN_FAILURE.with(|f| f.replace(Some(reason.clone())));
                Err(reason)
            }
        }
    }
}

impl SandboxActionRunner {
    fn run_inner(
        &self,
        caller: &RunCaller<'_>,
        canonical_id: &str,
        verb: &str,
        params: Value,
    ) -> Result<Value, String> {
        let host = self
            .host
            .get()
            .ok_or_else(|| "ctx.resources.run: the engine is still starting".to_string())?;
        let mut parts = canonical_id.splitn(3, ':');
        let (owner, kind, instance) = (
            parts.next().unwrap_or_default(),
            parts.next().unwrap_or_default(),
            parts.next().unwrap_or_default(),
        );
        if owner.is_empty() || kind.is_empty() || instance.is_empty() {
            return Err(format!(
                "ctx.resources.run: {canonical_id:?} is not a resource instance id"
            ));
        }
        if verb.is_empty() || verb.contains(':') {
            return Err(format!("ctx.resources.run: {verb:?} is not an action name"));
        }

        if caller.module_id != owner {
            let settings = host
                .settings
                .list_by_module(caller.module_id)
                .map_err(|e| format!("ctx.resources.run: read settings: {e}"))?;
            if !settings.values().any(|v| v.as_str() == Some(canonical_id)) {
                return Err(format!(
                    "ctx.resources.run: {} may act only on a resource it owns or one its settings link to, and {canonical_id} is neither",
                    caller.module_id
                ));
            }
        }

        let found = host
            .resources
            .get(canonical_id)
            .map_err(|e| format!("ctx.resources.run: look up {canonical_id}: {e}"))?
            .ok_or_else(|| {
                format!("ctx.resources.run: {canonical_id} does not exist — it may have been deleted")
            })?;
        if found.kind != kind {
            return Err(format!(
                "ctx.resources.run: {canonical_id} is a {}, not a {kind}",
                found.kind
            ));
        }

        let action = format!("{kind}.{verb}");
        let function = self.registry.action_function(owner, &action).ok_or_else(|| {
            format!("ctx.resources.run: {owner} has no `{action}` action")
        })?;

        // The action runs with the providing module's grants, so the caller
        // must already hold them: running it is no way to borrow them.
        let mut missing: Vec<String> = self
            .registry
            .permissions(owner)
            .into_iter()
            .filter(|p| !caller.permissions.contains(p))
            .collect();
        if !missing.is_empty() {
            missing.sort();
            return Err(format!(
                "ctx.resources.run: {owner}'s `{action}` needs {}, which {} does not declare",
                missing.join(", "),
                caller.module_id
            ));
        }

        let remaining = caller.deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("ctx.resources.run: the invocation ran out of time".to_string());
        }

        let mut parameters = match params {
            Value::Object(map) => map,
            Value::Null => serde_json::Map::new(),
            _ => return Err("ctx.resources.run: params must be an object".to_string()),
        };
        parameters.insert("target".to_string(), Value::String(canonical_id.to_string()));
        let request = InvokeRequest {
            function: format!("{owner}:function:{function}"),
            event: serde_json::json!({ "parameters": parameters }),
            user: None,
            params: Value::Null,
            workflow_chain: None,
            timeout_ms: Some(remaining.as_millis() as u64),
        };

        Sandbox::new(self.registry.clone(), host.clone())
            .and_then(|mut sandbox| sandbox.invoke(request))
            .map_err(|e| format!("ctx.resources.run: {owner}'s `{action}` failed: {e}"))
    }
}
