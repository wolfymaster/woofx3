pub mod grpc;
pub mod noop;

use serde_json::Value;
use std::sync::Arc;

pub trait NatsPublisher: Send + Sync {
    fn publish(&self, subject: &str, data: Value) -> Result<(), String>;
}

pub trait StorageClient: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<Value>, String>;
    fn set(&self, key: &str, value: Value) -> Result<(), String>;
}

pub trait EnvReader: Send + Sync {
    fn get(&self, key: &str) -> Option<String>;
}

pub trait HttpClient: Send + Sync {
    fn request(&self, url: &str, method: &str, opts: Value) -> Result<Value, String>;
}

#[derive(Clone)]
pub struct HostContext {
    pub nats: Arc<dyn NatsPublisher>,
    pub storage: Arc<dyn StorageClient>,
    pub env: Arc<dyn EnvReader>,
    pub http: Arc<dyn HttpClient>,
}

pub struct InvocationContext {
    pub event: Value,
    pub user: Value,
    pub host: HostContext,
}
