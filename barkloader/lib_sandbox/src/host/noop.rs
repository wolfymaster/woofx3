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

pub fn noop_host_context() -> HostContext {
    HostContext {
        nats: Arc::new(NoopNatsPublisher),
        storage: Arc::new(NoopStorageClient),
        env: Arc::new(NoopEnvReader),
        http: Arc::new(NoopHttpClient),
        chat: Arc::new(NoopChatSender),
    }
}
