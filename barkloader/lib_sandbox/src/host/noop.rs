use super::*;
use serde_json::Value;
use std::sync::Arc;

pub struct NoopNatsPublisher;

impl NatsPublisher for NoopNatsPublisher {
    fn publish(&self, _subject: &str, _data: Value) -> Result<(), String> {
        Ok(())
    }
}

pub struct NoopStorageClient;

impl StorageClient for NoopStorageClient {
    fn get(&self, _key: &str) -> Result<Option<Value>, String> {
        Ok(None)
    }

    fn set(&self, _key: &str, _value: Value) -> Result<(), String> {
        Ok(())
    }
}

pub struct NoopEnvReader;

impl EnvReader for NoopEnvReader {
    fn get(&self, _key: &str) -> Option<String> {
        None
    }
}

pub struct NoopHttpClient;

impl HttpClient for NoopHttpClient {
    fn request(&self, _url: &str, _method: &str, _opts: Value) -> Result<Value, String> {
        Err("HTTP not available".to_string())
    }
}

pub struct NoopChatSender;

impl ChatSender for NoopChatSender {
    fn send_message(&self, _text: &str) -> Result<(), String> {
        Ok(())
    }
}

pub struct NoopResourceClient;

impl ResourceClient for NoopResourceClient {
    fn create(
        &self,
        _owning_module_name: &str,
        _kind: &str,
        _instance_id: &str,
        _display_name: &str,
    ) -> Result<ResourceInstance, String> {
        Err("resource client not configured".to_string())
    }

    fn delete(&self, _canonical_id: &str) -> Result<(), String> {
        Err("resource client not configured".to_string())
    }

    fn list_by_kind(&self, _kind: &str) -> Result<Vec<ResourceInstance>, String> {
        Ok(Vec::new())
    }
}

pub fn noop_host_context() -> HostContext {
    HostContext {
        nats: Arc::new(NoopNatsPublisher),
        storage: Arc::new(NoopStorageClient),
        env: Arc::new(NoopEnvReader),
        http: Arc::new(NoopHttpClient),
        chat: Arc::new(NoopChatSender),
        resources: Arc::new(NoopResourceClient),
    }
}
