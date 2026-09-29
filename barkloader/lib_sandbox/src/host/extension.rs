use serde_json::Value;
use std::collections::HashSet;
use std::fmt;
use std::sync::Arc;

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

pub type HandlerFn = dyn Fn(Value) -> Result<Value, HostError> + Send + Sync;

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

    /// Run the handler for a module holding `granted`, refusing before the
    /// handler sees anything when the function needs a permission the module
    /// did not declare. `namespace` only names the function in the refusal.
    pub fn call(
        &self,
        namespace: &str,
        granted: &HashSet<String>,
        args: Value,
    ) -> Result<Value, HostError> {
        if let Some(permission) = self.permission {
            if !granted.contains(permission) {
                return Err(HostError::with_code(
                    format!(
                        "ctx.{namespace}.{} requires the {permission:?} permission; declare it in the module manifest's \"permissions\"",
                        self.name
                    ),
                    PERMISSION_DENIED,
                ));
            }
        }
        (self.handler)(args)
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
            .call("twitch", &HashSet::new(), Value::Null)
            .unwrap_err();
        assert_eq!(err.code.as_deref(), Some(PERMISSION_DENIED));
        assert!(err.message.contains("ctx.twitch.timeout"), "{err}");
        assert!(err.message.contains("twitch.moderation"), "{err}");
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_privileged_function_runs_for_a_module_that_declared_it() {
        let calls = Arc::new(AtomicUsize::new(0));
        let granted: HashSet<String> = [TWITCH_MODERATION.to_string()].into_iter().collect();
        counting(calls.clone())
            .call("twitch", &granted, Value::Null)
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    #[should_panic(expected = "unknown permission")]
    fn requiring_an_unknown_permission_is_a_programming_error() {
        let _ = HostFunction::new("x", |_| Ok(Value::Null)).requiring(Some("twitch.everything"));
    }
}
