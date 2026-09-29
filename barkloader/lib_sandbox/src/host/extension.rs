use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Why a host function refused or failed. `code`, when present, is a short
/// machine-readable reason module code can branch on without parsing the
/// message: QuickJS sets it as the thrown `Error`'s `code`, Lua as the
/// raised error table's `code`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostError {
    pub message: String,
    pub code: Option<String>,
}

impl HostError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            code: None,
        }
    }

    pub fn with_code(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            code: Some(code.into()),
        }
    }
}

impl From<String> for HostError {
    fn from(message: String) -> Self {
        Self::new(message)
    }
}

impl From<&str> for HostError {
    fn from(message: &str) -> Self {
        Self::new(message)
    }
}

impl fmt::Display for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

/// The `code` of a call refused for a permission the module did not declare.
pub const PERMISSION_DENIED: &str = "permission_denied";

/// What a host function knows about the invocation calling it. One scope is
/// shared by every host function bound into an invocation, so a limit it
/// tracks holds across all of the invocation's calls.
pub struct CallScope {
    granted: HashSet<String>,
    deadline: Instant,
    calls: Mutex<HashMap<String, u32>>,
}

impl CallScope {
    pub fn new(granted: HashSet<String>, deadline: Instant) -> Self {
        Self {
            granted,
            deadline,
            calls: Mutex::new(HashMap::new()),
        }
    }

    /// The permissions the invoking module's manifest declares.
    pub fn granted(&self) -> &HashSet<String> {
        &self.granted
    }

    /// How long until the invocation's caller stops waiting for it; zero once
    /// that moment has passed.
    pub fn remaining(&self) -> Duration {
        self.deadline.saturating_duration_since(Instant::now())
    }

    /// Counts one more call into `namespace` and returns how many the
    /// invocation has made there, this one included.
    pub fn record_call(&self, namespace: &str) -> u32 {
        let mut calls = self.calls.lock().expect("call counter mutex poisoned");
        let count = calls.entry(namespace.to_string()).or_insert(0);
        *count += 1;
        *count
    }
}

pub type HandlerFn = dyn Fn(&CallScope, Value) -> Result<Value, HostError> + Send + Sync;

#[derive(Clone)]
pub struct HostFunction {
    pub name: String,
    pub handler: Arc<HandlerFn>,
    /// A permission from `crate::permissions` the invoking module's manifest
    /// must declare before this function runs. `None` for functions open to
    /// every module.
    pub permission: Option<&'static str>,
}

impl HostFunction {
    pub fn new<F>(name: impl Into<String>, handler: F) -> Self
    where
        F: Fn(Value) -> Result<Value, HostError> + Send + Sync + 'static,
    {
        Self::scoped(name, move |_: &CallScope, args| handler(args))
    }

    /// A function whose handler also sees the calling invocation's scope, for
    /// one that must respect the invocation's deadline or limits.
    pub fn scoped<F>(name: impl Into<String>, handler: F) -> Self
    where
        F: Fn(&CallScope, Value) -> Result<Value, HostError> + Send + Sync + 'static,
    {
        Self {
            name: name.into(),
            handler: Arc::new(handler),
            permission: None,
        }
    }

    pub fn requiring(mut self, permission: Option<&'static str>) -> Self {
        if let Some(id) = permission {
            assert!(
                crate::permissions::is_known_permission(id),
                "host function {} requires unknown permission {id:?}",
                self.name
            );
        }
        self.permission = permission;
        self
    }

    /// Run the handler for the invocation `scope` describes, refusing before
    /// the handler sees anything when the function needs a permission the
    /// module did not declare. `namespace` only names the function in the
    /// refusal.
    pub fn call(
        &self,
        namespace: &str,
        scope: &CallScope,
        args: Value,
    ) -> Result<Value, HostError> {
        if let Some(permission) = self.permission {
            if !scope.granted().contains(permission) {
                return Err(HostError::with_code(
                    format!(
                        "ctx.{namespace}.{} requires the {permission:?} permission; declare it in the module manifest's \"permissions\"",
                        self.name
                    ),
                    PERMISSION_DENIED,
                ));
            }
        }
        (self.handler)(scope, args)
    }
}

pub trait HostExtension: Send + Sync {
    fn namespace(&self) -> &str;
    fn functions(&self) -> &[HostFunction];
}

#[derive(Default, Clone)]
pub struct ExtensionRegistry {
    extensions: Vec<Arc<dyn HostExtension>>,
}

impl ExtensionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with(mut self, ext: Arc<dyn HostExtension>) -> Self {
        self.extensions.push(ext);
        self
    }

    pub fn iter(&self) -> impl Iterator<Item = &Arc<dyn HostExtension>> {
        self.extensions.iter()
    }

    pub fn is_empty(&self) -> bool {
        self.extensions.is_empty()
    }

    pub fn len(&self) -> usize {
        self.extensions.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::permissions::TWITCH_MODERATION;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn scope(granted: &[&str]) -> CallScope {
        CallScope::new(
            granted.iter().map(|id| id.to_string()).collect(),
            Instant::now() + Duration::from_secs(30),
        )
    }

    fn counting(calls: Arc<AtomicUsize>) -> HostFunction {
        HostFunction::new("timeout", move |_| {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(Value::Null)
        })
        .requiring(Some(TWITCH_MODERATION))
    }

    #[test]
    fn a_privileged_function_refuses_an_undeclared_permission_without_running() {
        let calls = Arc::new(AtomicUsize::new(0));
        let err = counting(calls.clone())
            .call("twitch", &scope(&[]), Value::Null)
            .unwrap_err();
        assert_eq!(err.code.as_deref(), Some(PERMISSION_DENIED));
        assert!(err.message.contains("ctx.twitch.timeout"), "{err}");
        assert!(err.message.contains("twitch.moderation"), "{err}");
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_privileged_function_runs_for_a_module_that_declared_it() {
        let calls = Arc::new(AtomicUsize::new(0));
        counting(calls.clone())
            .call("twitch", &scope(&[TWITCH_MODERATION]), Value::Null)
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_scope_counts_calls_per_namespace() {
        let scope = scope(&[]);
        assert_eq!(scope.record_call("twitch"), 1);
        assert_eq!(scope.record_call("twitch"), 2);
        assert_eq!(scope.record_call("chat"), 1);
    }

    #[test]
    fn a_scope_past_its_deadline_has_nothing_remaining() {
        let spent = CallScope::new(HashSet::new(), Instant::now());
        assert_eq!(spent.remaining(), Duration::ZERO);
        assert!(scope(&[]).remaining() > Duration::from_secs(29));
    }

    #[test]
    #[should_panic(expected = "unknown permission")]
    fn requiring_an_unknown_permission_is_a_programming_error() {
        let _ = HostFunction::new("x", |_| Ok(Value::Null)).requiring(Some("twitch.everything"));
    }
}
