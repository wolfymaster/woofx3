use serde::Serialize;
use std::net::IpAddr;
use std::time::Duration;
use thiserror::Error;
use tracing::{error, info};
use url::{Host, Url};

use crate::util::get_env_or_default_with_key;

/// Callbacks go to the api, which answers at once; a peer that accepts the
/// connection and never answers must not pin a task forever.
const CALLBACK_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(15);

/// The api's own port when nothing configures one; it must match the
/// default in `api/src/config.ts`.
const DEFAULT_API_PORT: u16 = 8080;

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

#[derive(Debug, Error)]
pub enum CallbackConfigError {
    #[error("apiUrl (WOOFX3_API_URL) {value:?} is not a URL: {source}")]
    ApiUrl {
        value: String,
        source: url::ParseError,
    },
    #[error("apiUrl (WOOFX3_API_URL) {0:?} is not an http(s) URL with a host")]
    ApiUrlScheme(String),
    #[error("apiPort (WOOFX3_API_PORT) {0:?} is not a port number")]
    ApiPort(String),
    #[error("building the processing callback client: {0}")]
    Client(#[from] reqwest::Error),
}

/// Why a `callback_url` was refused.
#[derive(Debug, Error, PartialEq)]
pub enum CallbackRefused {
    #[error("callback_url is not a URL")]
    NotAUrl,
    #[error("callback_url must be on the api's origin {0}")]
    NotTheApi(String),
}

/// The api's base URL, as the api itself resolves it: `WOOFX3_API_URL` /
/// `apiUrl` when set, else `http://127.0.0.1:<apiPort>`. Both services read
/// the same environment and `.woofx3.json`, so the derived URL is the one
/// the api builds its `callback_url` from. `lookup(env_var, config_key)`
/// returns "" for unset. The flag is true when the URL was derived.
fn resolve_api_url(
    lookup: impl Fn(&str, &str) -> String,
) -> Result<(Url, bool), CallbackConfigError> {
    let configured = lookup("WOOFX3_API_URL", "apiUrl");
    let configured = configured.trim();
    if !configured.is_empty() {
        let url = Url::parse(configured).map_err(|source| CallbackConfigError::ApiUrl {
            value: configured.to_string(),
            source,
        })?;
        if !matches!(url.scheme(), "http" | "https") || url.host().is_none() {
            return Err(CallbackConfigError::ApiUrlScheme(configured.to_string()));
        }
        return Ok((url, false));
    }
    let port = lookup("WOOFX3_API_PORT", "apiPort");
    let port = match port.trim() {
        "" => DEFAULT_API_PORT,
        value => value
            .parse::<u16>()
            .map_err(|_| CallbackConfigError::ApiPort(value.to_string()))?,
    };
    let url = Url::parse(&format!("http://127.0.0.1:{port}"))
        .expect("a loopback URL with a u16 port parses");
    Ok((url, true))
}

fn is_loopback(host: Option<Host<&str>>) -> bool {
    match host {
        Some(Host::Domain(name)) => name.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(ip)) => IpAddr::V4(ip).is_loopback(),
        Some(Host::Ipv6(ip)) => IpAddr::V6(ip).is_loopback(),
        None => false,
    }
}

/// Whether `callback` is on `api`'s origin: same scheme, host and port,
/// default ports normalised. When the api is itself on loopback, every
/// loopback name for it (`localhost`, `127.0.0.1`, `::1`) is the same host,
/// but only on the api's scheme and port: another port on loopback is some
/// other local process.
fn is_api_origin(callback: &Url, api: &Url) -> bool {
    if !matches!(callback.scheme(), "http" | "https") {
        return false;
    }
    if callback.origin().is_tuple() && callback.origin() == api.origin() {
        return true;
    }
    callback.scheme() == api.scheme()
        && callback.port_or_known_default() == api.port_or_known_default()
        && is_loopback(api.host())
        && is_loopback(callback.host())
}

/// A `callback_url` on the api's origin. Only `CallbackSender::target`
/// makes one, so whatever is sent to it may carry the engine secret.
#[derive(Debug, Clone)]
pub struct CallbackTarget(Url);

/// Sends processing callbacks to the api. Built once at startup.
///
/// Every callback carries `Authorization: Bearer <barkloaderKey>`, which
/// the api checks when `WOOFX3_BARKLOADER_WEBHOOK_AUTH=required`; an api
/// that does not check ignores it, so either side can be updated first.
/// That key also signs upload grants and gates the WebSocket route, and
/// `POST /assets/process` is unauthenticated, so callbacks go only to the
/// api's own origin.
pub struct CallbackSender {
    client: reqwest::Client,
    api_url: Url,
    engine_secret: String,
}

impl CallbackSender {
    pub fn new(api_url: Url, engine_secret: String) -> Result<Self, CallbackConfigError> {
        let client = reqwest::Client::builder()
            .connect_timeout(CALLBACK_CONNECT_TIMEOUT)
            .timeout(CALLBACK_TIMEOUT)
            .build()?;
        Ok(Self {
            client,
            api_url,
            engine_secret,
        })
    }

    /// From `WOOFX3_API_URL` (or `WOOFX3_API_PORT`) and
    /// `WOOFX3_BARKLOADER_KEY`. A set but malformed api URL is an error.
    pub fn from_config() -> Result<Self, CallbackConfigError> {
        let lookup = |env_var: &str, config_key: &str| {
            get_env_or_default_with_key(env_var, Some(config_key), "")
        };
        let (api_url, derived) = resolve_api_url(lookup)?;
        if derived {
            info!(
                "apiUrl (WOOFX3_API_URL) not set; processing callbacks are accepted only for the api's default origin {}",
                api_url.origin().ascii_serialization()
            );
        } else {
            info!(
                "Processing callbacks are accepted only for the api's origin {}",
                api_url.origin().ascii_serialization()
            );
        }
        Self::new(api_url, lookup("WOOFX3_BARKLOADER_KEY", "barkloaderKey"))
    }

    /// Accept `callback_url` only on the api's origin.
    pub fn target(&self, callback_url: &str) -> Result<CallbackTarget, CallbackRefused> {
        let url = Url::parse(callback_url).map_err(|_| CallbackRefused::NotAUrl)?;
        if !is_api_origin(&url, &self.api_url) {
            return Err(CallbackRefused::NotTheApi(
                self.api_url.origin().ascii_serialization(),
            ));
        }
        Ok(CallbackTarget(url))
    }

    fn request(
        &self,
        target: &CallbackTarget,
        result: &ProcessingCallback,
    ) -> reqwest::RequestBuilder {
        let request = self.client.post(target.0.clone()).json(result);
        if self.engine_secret.is_empty() {
            return request;
        }
        request.bearer_auth(&self.engine_secret)
    }

    async fn send(&self, target: &CallbackTarget, result: ProcessingCallback) {
        let url = &target.0;
        match self.request(target, &result).send().await {
            Ok(resp) if resp.status().is_success() => {
                info!("Processing callback sent successfully to {}", url);
            }
            Ok(resp) => {
                error!(
                    "Processing callback to {} returned status {}",
                    url,
                    resp.status()
                );
            }
            Err(e) => {
                error!("Failed to send processing callback to {}: {}", url, e);
            }
        }
    }

    /// Report a job that finished without error. A `thumbnail_key` of
    /// `None` together with a `reason` means the utility does not apply to
    /// this media (audio) -- the caller should record "no thumbnail" and
    /// stop asking, not retry.
    #[allow(clippy::too_many_arguments)]
    pub async fn send_success(
        &self,
        target: &CallbackTarget,
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
        self.send(
            target,
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

    pub async fn send_failure(
        &self,
        target: &CallbackTarget,
        resource_id: &str,
        repository_key: &str,
        utility: &str,
        error_msg: &str,
    ) {
        self.send(
            target,
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
}

#[cfg(test)]
mod tests {
    use super::*;

    const WEBHOOK: &str = "/webhooks/barkloader/processing";

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

    fn sender(api_url: &str) -> CallbackSender {
        CallbackSender::new(Url::parse(api_url).unwrap(), "engine-secret".to_string())
            .expect("client builds")
    }

    fn accepts(api_url: &str, callback_url: &str) -> bool {
        sender(api_url).target(callback_url).is_ok()
    }

    #[test]
    fn accepts_the_exact_api_origin() {
        for (api, callback) in [
            (
                "http://api:8080",
                "http://api:8080/webhooks/barkloader/processing",
            ),
            (
                "https://api.example.com",
                "https://api.example.com/webhooks/barkloader/processing",
            ),
            // Default ports are the same origin, written or not.
            (
                "https://api.example.com",
                "https://api.example.com:443/webhooks/barkloader/processing",
            ),
            (
                "http://api.example.com:80/",
                "http://API.example.com/webhooks/barkloader/processing",
            ),
        ] {
            assert!(accepts(api, callback), "{api} -> {callback}");
        }
    }

    #[test]
    fn refuses_another_scheme_or_port_on_the_api_host() {
        for callback in [
            "http://api.example.com/webhooks/barkloader/processing",
            "http://api.example.com:8081/webhooks/barkloader/processing",
            "https://api.example.com:8443/webhooks/barkloader/processing",
            "ws://api.example.com:443/webhooks/barkloader/processing",
        ] {
            assert!(!accepts("https://api.example.com", callback), "{callback}");
        }
    }

    #[test]
    fn refuses_another_loopback_port() {
        for callback in [
            "http://127.0.0.1:9999/webhooks/barkloader/processing",
            "http://localhost:9999/webhooks/barkloader/processing",
            "http://[::1]:9999/webhooks/barkloader/processing",
            "https://127.0.0.1:5050/webhooks/barkloader/processing",
        ] {
            assert!(!accepts("http://127.0.0.1:5050", callback), "{callback}");
        }
    }

    #[test]
    fn treats_every_loopback_name_as_a_loopback_api_on_its_port() {
        for api in [
            "http://127.0.0.1:5050",
            "http://localhost:5050",
            "http://[::1]:5050",
        ] {
            for callback in [
                "http://127.0.0.1:5050/webhooks/barkloader/processing",
                "http://localhost:5050/webhooks/barkloader/processing",
                "http://[::1]:5050/webhooks/barkloader/processing",
            ] {
                assert!(accepts(api, callback), "{api} -> {callback}");
            }
        }
    }

    #[test]
    fn refuses_loopback_when_the_api_is_not_on_loopback() {
        assert!(!accepts(
            "http://api:8080",
            "http://127.0.0.1:8080/webhooks/barkloader/processing"
        ));
    }

    #[test]
    fn refuses_other_hosts_and_non_urls() {
        let sender = sender("http://127.0.0.1:5050");
        assert!(matches!(
            sender.target("https://attacker.example/webhooks/barkloader/processing"),
            Err(CallbackRefused::NotTheApi(origin)) if origin == "http://127.0.0.1:5050"
        ));
        assert!(
            sender
                .target("http://localhost.attacker.example:5050/")
                .is_err()
        );
        assert_eq!(
            sender.target("not a url").unwrap_err(),
            CallbackRefused::NotAUrl
        );
    }

    #[test]
    fn sends_the_engine_secret_as_a_bearer_token_and_the_result_as_json() {
        let sender = sender("http://127.0.0.1:5050");
        let target = sender
            .target(&format!("http://localhost:5050{WEBHOOK}"))
            .expect("api origin");
        let request = sender
            .request(&target, &result())
            .build()
            .expect("request builds");

        assert_eq!(
            request
                .headers()
                .get(reqwest::header::AUTHORIZATION)
                .unwrap(),
            "Bearer engine-secret"
        );
        let body: serde_json::Value =
            serde_json::from_slice(request.body().unwrap().as_bytes().unwrap()).unwrap();
        assert_eq!(body["resource_id"], "res-1");
        assert_eq!(body["status"], "completed");
    }

    fn lookup<'a>(values: &'a [(&'a str, &'a str)]) -> impl Fn(&str, &str) -> String + 'a {
        move |env_var, _| {
            values
                .iter()
                .find(|(name, _)| *name == env_var)
                .map(|(_, value)| value.to_string())
                .unwrap_or_default()
        }
    }

    #[test]
    fn resolves_a_configured_api_url() {
        let (url, derived) =
            resolve_api_url(lookup(&[("WOOFX3_API_URL", "https://api.example.com/")])).unwrap();
        assert_eq!(url.as_str(), "https://api.example.com/");
        assert!(!derived);
    }

    #[test]
    fn derives_the_api_url_from_its_port_as_the_api_does() {
        let (url, derived) = resolve_api_url(lookup(&[("WOOFX3_API_PORT", "5050")])).unwrap();
        assert_eq!(url.as_str(), "http://127.0.0.1:5050/");
        assert!(derived);

        let (url, _) = resolve_api_url(lookup(&[])).unwrap();
        assert_eq!(url.as_str(), "http://127.0.0.1:8080/");
    }

    #[test]
    fn a_malformed_api_url_or_port_is_an_error() {
        for values in [
            [("WOOFX3_API_URL", "not a url")],
            [("WOOFX3_API_URL", "ftp://api.example.com")],
            [("WOOFX3_API_PORT", "fifty")],
            [("WOOFX3_API_PORT", "70000")],
        ] {
            assert!(resolve_api_url(lookup(&values)).is_err(), "{values:?}");
        }
    }
}
