use actix_ws::{AggregatedMessage, AggregatedMessageStream};
use futures_util::StreamExt as _;
use lib_sandbox::Sandbox;
use serde::{Deserialize, Serialize};
use log::info;

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
                        info!("Received message: {:?}", message);
                        match message.message_type.as_str() {
                            "invoke" => {
                                let request = lib_sandbox::models::request::InvokeRequest {
                                    function: message.data["function"]
                                        .as_str()
                                        .unwrap_or("")
                                        .to_string(),
                                    args: message.data["args"].clone(),
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
