use serde::Serialize;
use tracing::{error, info};

/// Completion report for an asynchronous asset-processing job
/// (thumbnailing today). Barkloader does the work off the request path
/// and POSTs the outcome, rather than making the caller hold a connection
/// open.
///
/// `status` is one of "completed" | "not_applicable" | "failed".
/// "not_applicable" is a *success*: audio uploads have no frame to
/// render, and reporting that as a failure would put a retry loop
/// behind something that can never succeed.
#[derive(Serialize)]
pub struct ProcessingCallback {
    pub resource_id: String,
    pub repository_key: String,
    pub utility: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_repository_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

async fn send_processing_callback(callback_url: &str, result: ProcessingCallback) {
    let client = reqwest::Client::new();
    match client.post(callback_url).json(&result).send().await {
        Ok(resp) if resp.status().is_success() => {
            info!("Processing callback sent successfully to {}", callback_url);
        }
        Ok(resp) => {
            error!(
                "Processing callback to {} returned status {}",
                callback_url,
                resp.status()
            );
        }
        Err(e) => {
            error!(
                "Failed to send processing callback to {}: {}",
                callback_url, e
            );
        }
    }
}

/// Report a job that finished without error. A `thumbnail_key` of
/// `None` together with a `reason` means the utility does not apply to
/// this media (audio) -- the caller should record "no thumbnail" and
/// stop asking, not retry.
pub async fn send_processing_success_callback(
    callback_url: &str,
    resource_id: &str,
    repository_key: &str,
    utility: &str,
    thumbnail_key: Option<&str>,
    content_type: Option<&str>,
    reason: Option<&str>,
) {
    let status = if thumbnail_key.is_some() {
        "completed"
    } else {
        "not_applicable"
    };
    send_processing_callback(
        callback_url,
        ProcessingCallback {
            resource_id: resource_id.to_string(),
            repository_key: repository_key.to_string(),
            utility: utility.to_string(),
            status: status.to_string(),
            thumbnail_repository_key: thumbnail_key.map(|k| k.to_string()),
            content_type: content_type.map(|c| c.to_string()),
            reason: reason.map(|r| r.to_string()),
            error: None,
        },
    )
    .await;
}

pub async fn send_processing_failure_callback(
    callback_url: &str,
    resource_id: &str,
    repository_key: &str,
    utility: &str,
    error_msg: &str,
) {
    send_processing_callback(
        callback_url,
        ProcessingCallback {
            resource_id: resource_id.to_string(),
            repository_key: repository_key.to_string(),
            utility: utility.to_string(),
            status: "failed".to_string(),
            thumbnail_repository_key: None,
            content_type: None,
            reason: None,
            error: Some(error_msg.to_string()),
        },
    )
    .await;
}
