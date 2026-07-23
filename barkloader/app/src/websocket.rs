use actix_ws::{AggregatedMessage, AggregatedMessageStream};
use futures_util::StreamExt as _;
use lib_sandbox::SandboxFactory;
use log::{error, info};
use serde::{Deserialize, Serialize};
#[derive(Debug, Serialize, Deserialize)]
struct WsMessage {
    #[serde(rename = "type")]
    message_type: String,
    data: serde_json::Value,
    // Correlation id set by the caller on an "invoke" request; echoed back
    // verbatim on the matching "result"/"error" response so a client with
    // multiple in-flight invokes on the same connection can match a reply
    // to its originating call. Absent on requests that don't need
    // correlation (e.g. legacy fire-and-forget callers).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    id: Option<String>,
}

pub struct WebSocketSession {
    sandbox: SandboxFactory,
}

impl WebSocketSession {
    pub fn new(sandbox: SandboxFactory) -> Self {
        Self { sandbox }
    }

    pub async fn handle_message(
        &self,
        mut session: actix_ws::Session,
        mut msg_stream: AggregatedMessageStream,
    ) {
        let close_reason = loop {
            match msg_stream.next().await {
                Some(Ok(AggregatedMessage::Text(text))) => {
                    if let Ok(message) = serde_json::from_str::<WsMessage>(&text) {
                        let request_id = message.id.clone();
                        match message.message_type.as_str() {
                            "invoke" => {
                                let event = message
                                    .data
                                    .get("event")
                                    .cloned()
                                    .unwrap_or(serde_json::Value::Null);
                                let params = message
                                    .data
                                    .get("params")
                                    .cloned()
                                    .unwrap_or(serde_json::Value::Null);

                                let function = message.data["function"]
                                    .as_str()
                                    .unwrap_or("")
                                    .to_string();
                                info!("WebSocket invoke function={}", function);
                                let request = lib_sandbox::models::request::InvokeRequest {
                                    function: function.clone(),
                                    event: event.clone(),
                                    user: message.data.get("user").cloned(),
                                    params,
                                };
                                // invoke_blocking offloads onto Tokio's blocking thread
                                // pool because Sandbox::invoke drives the QuickJS/Lua
                                // runtime synchronously and host calls it makes (module
                                // settings fetch, ctx.http.request, ...) block on their
                                // own async I/O internally — calling it directly here
                                // would panic ("Cannot start a runtime from within a
                                // runtime") since this task already runs on the actix
                                // async reactor.
                                let result = self.sandbox.invoke_blocking(request).await;
                                match result {
                                    Ok(response) => {
                                        let response = WsMessage {
                                            message_type: "result".to_string(),
                                            data: serde_json::json!({
                                                "response": "ok",
                                                "result": response
                                            }),
                                            id: request_id.clone(),
                                        };
                                        let json = serde_json::to_string(&response).unwrap();
                                        session.text(json).await.unwrap();
                                    }
                                    Err(e) => {
                                        error!("WebSocket invoke failed function={}: {}", function, e);
                                        let response = WsMessage {
                                            message_type: "error".to_string(),
                                            data: serde_json::json!(e.to_string()),
                                            id: request_id.clone(),
                                        };
                                        let json = serde_json::to_string(&response).unwrap();
                                        session.text(json).await.unwrap();
                                    }
                                }
                            }
                            _ => {
                                let response = WsMessage {
                                    message_type: "error".to_string(),
                                    data: serde_json::json!("Unknown message type"),
                                    id: request_id.clone(),
                                };
                                let json = serde_json::to_string(&response).unwrap();
                                session.text(json).await.unwrap();
                            }
                        }
                    } else {
                        let response = WsMessage {
                            message_type: "error".to_string(),
                            data: serde_json::json!("Invalid message format"),
                            id: None,
                        };
                        let json = serde_json::to_string(&response).unwrap();
                        session.text(json).await.unwrap();
                    }
                }

                // error or end of stream
                _ => break None,
            }
        };

        session.close(close_reason).await.unwrap();
    }
}
