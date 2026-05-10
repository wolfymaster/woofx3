use serde_json::Value;
use std::sync::Arc;

pub type HandlerFn = dyn Fn(Value) -> Result<Value, String> + Send + Sync;

pub struct HostFunction {
    pub name: String,
    pub handler: Arc<HandlerFn>,
}

impl HostFunction {
    pub fn new<F>(name: impl Into<String>, handler: F) -> Self
    where
        F: Fn(Value) -> Result<Value, String> + Send + Sync + 'static,
    {
        Self {
            name: name.into(),
            handler: Arc::new(handler),
        }
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
