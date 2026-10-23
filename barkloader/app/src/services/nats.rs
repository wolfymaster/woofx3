use anyhow::Result;
use async_nats::{Client, ConnectOptions, RequestErrorKind};
use lib_sandbox::host::{NatsPublisher, NatsRequester, RequestError};
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use tokio::runtime::Handle;
use tracing::{debug, warn};

use crate::util::get_env_or_default_with_key;

pub struct NatsService {
    client: Client,
    handle: Handle,
}

impl NatsService {
    /// Connect to the bus at `url`, sending `token` when it requires one.
    pub async fn connect(url: &str, token: Option<&str>) -> Result<Arc<Self>> {
        let client = connect_options(token).connect(url).await?;
        Ok(Arc::new(Self {
            client,
            handle: Handle::current(),
        }))
    }
}

/// The token the message bus requires, from `WOOFX3_MESSAGEBUS_TOKEN` or
/// `messagebusToken` in `.woofx3.json`: the same setting the bus server and
/// the Go and TypeScript clients read, so all of them agree on one value.
/// None when the bus takes anyone.
pub fn configured_token() -> Option<String> {
    token_from(|env_var, config_key| get_env_or_default_with_key(env_var, Some(config_key), ""))
}

/// `configured_token` over an injected `lookup(env_var, config_key)`, so the
/// resolution is testable without touching the process environment.
fn token_from(lookup: impl FnOnce(&str, &str) -> String) -> Option<String> {
    let token = lookup("WOOFX3_MESSAGEBUS_TOKEN", "messagebusToken");
    Some(token.trim().to_string()).filter(|token| !token.is_empty())
}

/// The connect options for `token`; a blank token sends none.
fn connect_options(token: Option<&str>) -> ConnectOptions {
    let options = ConnectOptions::new();
    match token.map(str::trim).filter(|token| !token.is_empty()) {
        Some(token) => options.token(token.to_string()),
        None => options,
    }
}

impl NatsService {
    pub fn raw_client(&self) -> &Client {
        &self.client
    }
}

impl NatsPublisher for NatsService {
    fn publish(&self, subject: &str, data: Value) -> Result<(), String> {
        let bytes = serde_json::to_vec(&data).map_err(|e| e.to_string())?;
        let client = self.client.clone();
        let subject_owned = subject.to_string();
        self.handle.spawn(async move {
            match client.publish(subject_owned.clone(), bytes.into()).await {
                Ok(()) => debug!("NATS published on {}", subject_owned),
                Err(e) => warn!("NATS publish failed for {}: {}", subject_owned, e),
            }
        });
        Ok(())
    }
}

impl NatsRequester for NatsService {
    /// Blocks the calling thread on the reply, so it must be called from the
    /// sandbox's blocking thread (see `SandboxFactory::invoke_blocking`),
    /// never from an async task.
    fn request(
        &self,
        subject: &str,
        data: Value,
        timeout: Duration,
    ) -> Result<Value, RequestError> {
        let bytes = serde_json::to_vec(&data).map_err(|e| RequestError::Failed(e.to_string()))?;
        let request = async_nats::Request::new()
            .payload(bytes.into())
            .timeout(Some(timeout));
        let client = self.client.clone();
        let subject_owned = subject.to_string();
        let reply = self
            .handle
            .block_on(async move { client.send_request(subject_owned, request).await })
            .map_err(|e| match e.kind() {
                RequestErrorKind::TimedOut => RequestError::TimedOut,
                RequestErrorKind::NoResponders => RequestError::NoResponders,
                RequestErrorKind::Other => RequestError::Failed(e.to_string()),
            })?;
        serde_json::from_slice(&reply.payload)
            .map_err(|e| RequestError::Failed(format!("the reply on {subject} is not JSON: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;

    /// Accepts one plain NATS connection, says auth is required, and hands
    /// back the CONNECT line the client sends.
    async fn capture_connect() -> (String, oneshot::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let url = format!("nats://{}", listener.local_addr().expect("addr"));
        let (tx, rx) = oneshot::channel();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept");
            stream
                .write_all(b"INFO {\"server_id\":\"capture\",\"version\":\"2.12.0\",\"proto\":1,\"auth_required\":true,\"max_payload\":1048576}\r\n")
                .await
                .expect("write INFO");
            let mut line = String::new();
            BufReader::new(stream)
                .read_line(&mut line)
                .await
                .expect("read CONNECT");
            let _ = tx.send(line);
        });
        (url, rx)
    }

    async fn connect_line(token: Option<&str>) -> serde_json::Value {
        let (url, rx) = capture_connect().await;
        // The capture server never answers, so the connect fails; only what
        // the client sent matters.
        let attempt = tokio::spawn({
            let token = token.map(str::to_string);
            async move { NatsService::connect(&url, token.as_deref()).await }
        });
        let line = tokio::time::timeout(Duration::from_secs(5), rx)
            .await
            .expect("the client sent CONNECT in time")
            .expect("the capture server read a line");
        attempt.abort();
        let json = line.strip_prefix("CONNECT ").expect("a CONNECT line");
        serde_json::from_str(json).expect("CONNECT options are JSON")
    }

    #[tokio::test]
    async fn the_configured_token_is_sent() {
        let options = connect_line(Some("s3cret")).await;

        assert_eq!(options["auth_token"], "s3cret");
    }

    #[tokio::test]
    async fn no_token_is_sent_when_none_is_configured() {
        for token in [None, Some("  ")] {
            let options = connect_line(token).await;

            // async-nats sends `"auth_token": null` rather than leaving it out.
            assert!(options["auth_token"].is_null(), "sent {options}");
        }
    }

    #[test]
    fn the_token_is_looked_up_by_its_variable_and_config_key() {
        let token = token_from(|env_var, config_key| {
            assert_eq!(
                (env_var, config_key),
                ("WOOFX3_MESSAGEBUS_TOKEN", "messagebusToken")
            );
            " s3cret ".to_string()
        });

        assert_eq!(token.as_deref(), Some("s3cret"));
    }

    #[test]
    fn a_blank_token_is_none() {
        for value in ["", "   "] {
            assert_eq!(token_from(|_, _| value.to_string()), None, "{value:?}");
        }
    }

    /// The headers of the WebSocket upgrade the client sends. The listener
    /// never upgrades, so the connect fails after the request is read.
    async fn websocket_upgrade_request() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let url = format!("ws://{}", listener.local_addr().expect("addr"));
        let attempt = tokio::spawn(async move { NatsService::connect(&url, None).await });
        let (mut stream, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept())
            .await
            .expect("the client connected in time")
            .expect("accept");
        let mut request = Vec::new();
        let mut buf = [0u8; 1024];
        while !request.windows(4).any(|w| w == b"\r\n\r\n") {
            let n = stream.read(&mut buf).await.expect("read request");
            assert!(n > 0, "the client closed before finishing its request");
            request.extend_from_slice(&buf[..n]);
        }
        attempt.abort();
        String::from_utf8(request).expect("an HTTP request head")
    }

    /// The server's same-origin check only rejects an upgrade that carries an
    /// Origin naming another host, so a client that sends none is unaffected
    /// by `messagebusWebSocketSameOrigin`.
    #[tokio::test]
    async fn the_websocket_upgrade_carries_no_origin() {
        let request = websocket_upgrade_request().await;

        assert!(
            !request.to_ascii_lowercase().contains("\r\norigin:"),
            "upgrade request: {request}"
        );
    }

    /// Against a real server that requires a token: driven by
    /// TestEveryClientAuthenticates in services/nats, which starts the server
    /// and sets these variables.
    #[tokio::test]
    #[ignore = "needs a running message bus; see services/nats/auth_test.go"]
    async fn a_live_bus_admits_only_the_token() {
        let url = std::env::var("WOOFX3_TEST_MESSAGEBUS_URL").expect("WOOFX3_TEST_MESSAGEBUS_URL");
        let token =
            std::env::var("WOOFX3_TEST_MESSAGEBUS_TOKEN").expect("WOOFX3_TEST_MESSAGEBUS_TOKEN");

        assert!(
            NatsService::connect(&url, None).await.is_err(),
            "a client without the token was admitted"
        );
        let nats = NatsService::connect(&url, Some(&token))
            .await
            .expect("the token is accepted");
        nats.raw_client()
            .flush()
            .await
            .expect("the connection works");
    }
}
