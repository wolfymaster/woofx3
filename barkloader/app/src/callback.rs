use serde::Serialize;
use std::net::IpAddr;
use tracing::{error, info, warn};
use url::{Host, Url};

use crate::util::get_env_or_default_with_key;

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

/// Whether `callback_url` may be sent the engine secret. The URL arrives in
/// the processing request, so the secret goes only where the api itself is
/// reached: a loopback host, or the host of the api's configured URL.
/// Anything else gets the callback without credentials, which an api
/// enforcing webhook auth refuses.
fn may_carry_engine_secret(callback_url: &str, api_url: &str) -> bool {
    let Ok(callback) = Url::parse(callback_url) else {
        return false;
    };
    let loopback = match callback.host() {
        Some(Host::Domain(name)) => name.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(ip)) => IpAddr::V4(ip).is_loopback(),
        Some(Host::Ipv6(ip)) => IpAddr::V6(ip).is_loopback(),
        None => false,
    };
    if loopback {
        return true;
    }
    match Url::parse(api_url) {
        Ok(api) => api.host().is_some() && api.host() == callback.host(),
        Err(_) => false,
    }
}

/// The callback POST, carrying `Authorization: Bearer <barkloaderKey>` when
/// the key is set and the URL may receive it. The api checks it when
/// `WOOFX3_BARKLOADER_WEBHOOK_AUTH=required`; an api that does not check
/// ignores it, so either side can be updated first.
fn callback_request(
    client: &reqwest::Client,
    callback_url: &str,
    engine_secret: &str,
    api_url: &str,
    result: &ProcessingCallback,
) -> reqwest::RequestBuilder {
    let request = client.post(callback_url).json(result);
    if engine_secret.is_empty() {
        return request;
    }
    if !may_carry_engine_secret(callback_url, api_url) {
        warn!(
            "Processing callback to {} sent without credentials: not a loopback host or the api's",
            callback_url
        );
        return request;
    }
    request.bearer_auth(engine_secret)
}

async fn send_processing_callback(callback_url: &str, result: ProcessingCallback) {
    let client = reqwest::Client::new();
    let engine_secret =
        get_env_or_default_with_key("WOOFX3_BARKLOADER_KEY", Some("barkloaderKey"), "");
    let api_url = get_env_or_default_with_key("WOOFX3_API_URL", Some("apiUrl"), "");
    let request = callback_request(&client, callback_url, &engine_secret, &api_url, &result);
    match request.send().await {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn result() -> ProcessingCallback {
        ProcessingCallback {
            resource_id: "res-1".to_string(),
            repository_key: "user/res-1/a.png".to_string(),
            utility: "thumbnail".to_string(),
            status: "completed".to_string(),
            thumbnail_repository_key: None,
            content_type: None,
            reason: None,
            error: None,
        }
    }

    fn authorization(callback_url: &str, secret: &str, api_url: &str) -> Option<String> {
        let client = reqwest::Client::new();
        let request = callback_request(&client, callback_url, secret, api_url, &result())
            .build()
            .expect("request builds");
        request
            .headers()
            .get(reqwest::header::AUTHORIZATION)
            .map(|v| v.to_str().unwrap().to_string())
    }

    #[test]
    fn sends_the_engine_secret_as_a_bearer_token_to_a_loopback_api() {
        for url in [
            "http://127.0.0.1:8080/webhooks/barkloader/processing",
            "http://localhost:8080/webhooks/barkloader/processing",
            "http://[::1]:8080/webhooks/barkloader/processing",
        ] {
            assert_eq!(
                authorization(url, "engine-secret", ""),
                Some("Bearer engine-secret".to_string()),
                "{url}"
            );
        }
    }

    #[test]
    fn sends_it_to_the_configured_api_host() {
        assert_eq!(
            authorization(
                "http://api:8080/webhooks/barkloader/processing",
                "engine-secret",
                "http://api:8080"
            ),
            Some("Bearer engine-secret".to_string())
        );
    }

    #[test]
    fn withholds_it_from_any_other_host() {
        assert_eq!(
            authorization(
                "https://attacker.example/webhooks/barkloader/processing",
                "engine-secret",
                "http://127.0.0.1:8080"
            ),
            None
        );
        assert!(!may_carry_engine_secret(
            "not a url",
            "http://127.0.0.1:8080"
        ));
        assert!(!may_carry_engine_secret(
            "http://localhost.attacker.example/",
            "not a url"
        ));
    }

    #[test]
    fn sends_no_header_without_a_secret() {
        assert_eq!(
            authorization(
                "http://127.0.0.1:8080/webhooks/barkloader/processing",
                "",
                ""
            ),
            None
        );
    }

    #[test]
    fn still_posts_the_result_as_json() {
        let client = reqwest::Client::new();
        let request = callback_request(
            &client,
            "http://127.0.0.1:8080/webhooks/barkloader/processing",
            "engine-secret",
            "",
            &result(),
        )
        .build()
        .unwrap();
        let body: serde_json::Value =
            serde_json::from_slice(request.body().unwrap().as_bytes().unwrap()).unwrap();
        assert_eq!(body["resource_id"], "res-1");
        assert_eq!(body["status"], "completed");
    }
}
