use async_nats::Client;
use futures::stream::StreamExt;
use jsonschema::Validator;
use lib_sandbox::SandboxFactory;
use lib_sandbox::models::request::InvokeRequest;
use serde_json::{Value, json};
use tracing::{error, info, warn};
use woofx3_cloudevents::messages_gen::{
    DOCUMENT, ModuleFieldOptionsRequest, ModuleFieldOptionsRequestType,
};

const REQUEST_SCHEMA: &str = "ModuleFieldOptionsRequest";

/// The subject the contract fixes as the request's `type`.
fn subject() -> String {
    ModuleFieldOptionsRequestType::BarkloaderModuleFieldOptions.to_string()
}

/// A validator for the request schema of the embedded contract document.
fn request_validator() -> Result<Validator, String> {
    let document: Value = serde_json::from_str(DOCUMENT).map_err(|e| e.to_string())?;
    let root = json!({
        "$ref": format!("#/components/schemas/{REQUEST_SCHEMA}"),
        "components": document["components"],
    });
    jsonschema::validator_for(&root).map_err(|e| e.to_string())
}

/// Check a received payload against the contract, then read it as the generated type.
fn parse_request(
    validator: &Validator,
    payload: &[u8],
) -> Result<ModuleFieldOptionsRequest, String> {
    let value: Value = serde_json::from_slice(payload).map_err(|e| e.to_string())?;
    validator.validate(&value).map_err(|e| e.to_string())?;
    serde_json::from_value(value).map_err(|e| e.to_string())
}

/// Subscribe to the field-options subject and handle dynamic select
/// field options requests from the workflow builder UI.
///
/// Each request is a NATS request/reply: the API publishes a CloudEvent to
/// this subject and waits for a reply. This subscriber resolves the target
/// module function, invokes it in the sandbox, and publishes the result back
/// on the reply inbox.
pub async fn run_field_options_responder(client: Client, sandbox: SandboxFactory) {
    let subject = subject();
    let validator = match request_validator() {
        Ok(v) => v,
        Err(e) => {
            error!("field_options: cannot build the request validator: {}", e);
            return;
        }
    };
    let mut subscriber = match client.subscribe(subject.clone()).await {
        Ok(s) => s,
        Err(e) => {
            error!("field_options: failed to subscribe to {}: {}", subject, e);
            return;
        }
    };

    info!("field_options: subscribed to {}", subject);

    while let Some(msg) = subscriber.next().await {
        let reply_subject = match msg.reply.clone() {
            Some(r) => r,
            None => {
                warn!(
                    "field_options: received message on {} with no reply subject; ignoring",
                    subject
                );
                continue;
            }
        };

        let request = match parse_request(&validator, &msg.payload) {
            Ok(r) => r,
            Err(e) => {
                warn!("field_options: refused an invalid request: {}", e);
                let _ = client.publish(reply_subject, b"[]".to_vec().into()).await;
                continue;
            }
        };

        let function_id = format!(
            "{}:function:{}",
            *request.data.module_id, *request.data.function_id
        );

        info!(
            "field_options: dispatching moduleId={} functionId={} -> {}",
            *request.data.module_id, *request.data.function_id, function_id
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
                    workflow_chain: None,
                    timeout_ms: None,
                })
                .await;

            let reply_bytes = match result {
                Ok(value) => serde_json::to_vec(&value).unwrap_or_else(|_| b"[]".to_vec()),
                Err(lib_sandbox::InvokeBlockingError::TaskJoin(e)) => {
                    error!(
                        "field_options: spawn_blocking for {} failed: {}",
                        function_id, e
                    );
                    b"[]".to_vec()
                }
                Err(e @ lib_sandbox::InvokeBlockingError::Busy { .. }) => {
                    warn!("field_options: refused {}: {}", function_id, e);
                    b"[]".to_vec()
                }
                Err(e) => {
                    error!("field_options: invoke {} failed: {}", function_id, e);
                    b"[]".to_vec()
                }
            };

            if let Err(e) = client_clone
                .publish(reply_subject, reply_bytes.into())
                .await
            {
                error!(
                    "field_options: failed to send reply for {}: {}",
                    function_id, e
                );
            }
        });
    }

    warn!("field_options: subscriber for {} closed", subject);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(data: Value) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "id": "7c3f0f55-0c4b-4a37-a2a5-2d1f1c8b9e10",
            "type": subject(),
            "source": "api",
            "time": "2026-11-19T10:15:30.123Z",
            "data": data,
        }))
        .unwrap()
    }

    #[test]
    fn test_parse_request_reads_the_function_to_run() {
        let validator = request_validator().unwrap();
        let parsed = parse_request(
            &validator,
            &request(json!({ "moduleId": "spotify", "functionId": "get_devices" })),
        )
        .unwrap();
        assert_eq!(*parsed.data.module_id, "spotify");
        assert_eq!(*parsed.data.function_id, "get_devices");
    }

    #[test]
    fn test_parse_request_refuses_what_the_contract_refuses() {
        let validator = request_validator().unwrap();
        for data in [
            json!({ "moduleId": "spotify" }),
            json!({ "moduleId": "spotify", "functionId": "" }),
            json!({ "moduleId": "spotify", "functionId": "get_devices", "command": "x" }),
        ] {
            assert!(
                parse_request(&validator, &request(data.clone())).is_err(),
                "{data}"
            );
        }
        assert!(parse_request(&validator, b"not json").is_err());
    }
}
