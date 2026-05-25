use actix_ws::{AggregatedMessage, AggregatedMessageStream};
use futures_util::StreamExt as _;
use lib_sandbox::Sandbox;
use log::{error, info};
use serde::{Deserialize, Serialize};
#[derive(Debug, Serialize, Deserialize)]
struct WsMessage {
    #[serde(rename = "type")]
    message_type: String,
    data: serde_json::Value,
}

pub struct WebSocketSession {
    sandbox: Sandbox,
}

impl WebSocketSession {
    pub fn new(sandbox: Sandbox) -> Self {
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
                        match message.message_type.as_str() {
                            "invoke" => {
                                let mut event = message
                                    .data
                                    .get("event")
                                    .cloned()
                                    .unwrap_or(serde_json::Value::Null);
                                let params = message
                                    .data
                                    .get("params")
                                    .cloned()
                                    .unwrap_or(serde_json::Value::Null);

                                // Legacy workflow client sent `func` + `args: [paramObject]`
                                // with no `event`. Wrap the first arg as `parameters`.
                                if event.is_null() {
                                    if let Some(args) =
                                        message.data.get("args").and_then(|a| a.as_array())
                                    {
                                        if let Some(first) = args.first() {
                                            if first.is_object() {
                                                event = serde_json::json!({
                                                    "parameters": first
                                                });
                                            } else {
                                                event = first.clone();
                                            }
                                        }
                                    }
                                }

                                // Top-level `params` (InvokeRequest.params) → event.parameters
                                if params.is_object() {
                                    if let Some(event_obj) = event.as_object_mut() {
                                        event_obj
                                            .entry("parameters")
                                            .or_insert_with(|| params.clone());
                                    } else if event.is_null() {
                                        event = serde_json::json!({ "parameters": params });
                                    }
                                }

                                let function = message.data["function"]
                                    .as_str()
                                    .or_else(|| message.data["func"].as_str())
                                    .unwrap_or("")
                                    .to_string();
                                info!("WebSocket invoke function={}", function);
                                let request = lib_sandbox::models::request::InvokeRequest {
                                    function: function.clone(),
                                    event: event.clone(),
                                    user: message.data.get("user").cloned(),
                                    params,
                                };
                                let result = self.sandbox.invoke(request);
                                match result {
                                    Ok(response) => {
                                        let response = WsMessage {
                                            message_type: "result".to_string(),
                                            data: serde_json::json!({
                                                "response": "ok",
                                                "result": response
                                            }),
                                        };
                                        let json = serde_json::to_string(&response).unwrap();
                                        session.text(json).await.unwrap();
                                    }
                                    Err(e) => {
                                        error!("WebSocket invoke failed function={}: {}", function, e);
                                        let response = WsMessage {
                                            message_type: "error".to_string(),
                                            data: serde_json::json!(e.to_string()),
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
                                };
                                let json = serde_json::to_string(&response).unwrap();
                                session.text(json).await.unwrap();
                            }
                        }
                    } else {
                        let response = WsMessage {
                            message_type: "error".to_string(),
                            data: serde_json::json!("Invalid message format"),
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
