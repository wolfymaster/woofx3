use serde::Serialize;
use log::{error, info};

#[derive(Serialize)]
pub struct InstallCallback {
    pub module: String,
    pub version: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub async fn send_callback(callback_url: &str, result: InstallCallback) {
    let client = reqwest::Client::new();
    match client.post(callback_url)
        .json(&result)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            info!("Callback sent successfully to {}", callback_url);
        }
        Ok(resp) => {
            error!("Callback to {} returned status {}", callback_url, resp.status());
        }
        Err(e) => {
            error!("Failed to send callback to {}: {}", callback_url, e);
        }
    }
}

pub async fn send_success_callback(callback_url: &str, module: &str, version: &str) {
    let result = InstallCallback {
        module: module.to_string(),
        version: version.to_string(),
        status: "completed".to_string(),
        error: None,
    };
    send_callback(callback_url, result).await;
}

pub async fn send_failure_callback(callback_url: &str, module: &str, version: &str, error_msg: &str) {
    let result = InstallCallback {
        module: module.to_string(),
        version: version.to_string(),
        status: "failed".to_string(),
        error: Some(error_msg.to_string()),
    };
    send_callback(callback_url, result).await;
}