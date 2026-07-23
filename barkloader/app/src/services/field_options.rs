use async_nats::Client;
use futures::stream::StreamExt;
use lib_sandbox::models::request::InvokeRequest;
use lib_sandbox::SandboxFactory;
use log::{error, info, warn};
use serde::Deserialize;
use serde_json::json;

const SUBJECT: &str = "barkloader.module.field_options";

/// Incoming CloudEvent envelope sent by the API for field options requests.
#[derive(Deserialize)]
struct FieldOptionsEnvelope {
    data: FieldOptionsData,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldOptionsData {
    module_id: String,
    function_id: String,
}

/// Subscribe to `barkloader.module.field_options` and handle dynamic select
/// field options requests from the workflow builder UI.
///
/// Each request is a NATS request/reply: the API publishes a CloudEvent to
/// this subject and waits for a reply. This subscriber resolves the target
/// module function, invokes it in the sandbox, and publishes the result back
/// on the reply inbox.
pub async fn run_field_options_responder(client: Client, sandbox: SandboxFactory) {
    let mut subscriber = match client.subscribe(SUBJECT).await {
        Ok(s) => s,
        Err(e) => {
            error!("field_options: failed to subscribe to {}: {}", SUBJECT, e);
            return;
        }
    };

    info!("field_options: subscribed to {}", SUBJECT);

    while let Some(msg) = subscriber.next().await {
        let reply_subject = match msg.reply.clone() {
            Some(r) => r,
            None => {
                warn!("field_options: received message on {} with no reply subject; ignoring", SUBJECT);
                continue;
            }
        };

        let envelope: FieldOptionsEnvelope =
            match serde_json::from_slice::<FieldOptionsEnvelope>(&msg.payload) {
                Ok(e) => e,
                Err(e) => {
                    warn!("field_options: failed to parse request envelope: {}", e);
                    let _ = client
                        .publish(reply_subject, b"[]".to_vec().into())
                        .await;
                    continue;
                }
            };

        let function_id = format!(
            "{}:function:{}",
            envelope.data.module_id, envelope.data.function_id
        );

        info!(
            "field_options: dispatching moduleId={} functionId={} -> {}",
            envelope.data.module_id, envelope.data.function_id, function_id
        );

        let client_clone = client.clone();
        let sandbox_clone = sandbox.clone();

        tokio::spawn(async move {
            let fn_id = function_id.clone();
            let result = sandbox_clone
                .invoke_blocking(InvokeRequest {
                    function: fn_id,
                    event: json!({}),
                    user: None,
                    params: json!({}),
                })
                .await;

            let reply_bytes = match result {
                Ok(value) => serde_json::to_vec(&value).unwrap_or_else(|_| b"[]".to_vec()),
                Err(lib_sandbox::InvokeBlockingError::TaskJoin(e)) => {
                    error!("field_options: spawn_blocking for {} failed: {}", function_id, e);
                    b"[]".to_vec()
                }
                Err(e) => {
                    error!("field_options: invoke {} failed: {}", function_id, e);
                    b"[]".to_vec()
                }
            };

            if let Err(e) = client_clone.publish(reply_subject, reply_bytes.into()).await {
                error!("field_options: failed to send reply for {}: {}", function_id, e);
            }
        });
    }

    warn!("field_options: subscriber for {} closed", SUBJECT);
}
