//! Service authentication for barkloader's management surface.
//!
//! Every route that installs, changes or runs modules, swaps storage or
//! issues grants is reachable only by the engine's own services, which hold
//! the engine secret (`barkloaderKey`). Binding to loopback is not enough on
//! its own: a page in the streamer's browser can send simple cross-origin
//! requests to 127.0.0.1, and DNS rebinding can make such a page same-origin
//! with barkloader. So a request must carry the secret as a bearer token, must
//! not come from a browser context, and must name barkloader by a loopback
//! (or explicitly configured) Host.

use std::sync::Arc;

use actix_web::body::{EitherBody, MessageBody};
use actix_web::dev::{ServiceRequest, ServiceResponse};
use actix_web::http::StatusCode;
use actix_web::http::header::{self, HeaderMap};
use actix_web::middleware::Next;
use actix_web::{Error, HttpResponse};
use serde_json::json;
use subtle::ConstantTimeEq;
use woofx3_runtime::{SecretError, validate_secret};

/// The `.woofx3.json` key naming one more Host barkloader answers to, for a
/// deployment whose services reach it by a name other than loopback.
pub const ALLOWED_HOST_CONFIG_KEY: &str = "barkloaderAllowedHost";
pub const ALLOWED_HOST_ENV_VAR: &str = "WOOFX3_BARKLOADER_ALLOWED_HOST";

/// `Sec-Fetch-Site` values a browser sends for a request another site's page
/// started. `same-origin` and `none` are not here: nothing barkloader serves
/// is a page that could start one.
const CROSS_SITE_FETCH_VALUES: &[&str] = &["cross-site", "same-site"];

#[derive(Debug, thiserror::Error)]
pub enum ServiceAuthError {
    #[error(transparent)]
    Secret(#[from] SecretError),
    #[error(
        "{ALLOWED_HOST_CONFIG_KEY} ({ALLOWED_HOST_ENV_VAR}) must be a host or host:port, got {0:?}"
    )]
    InvalidAllowedHost(String),
}

/// Why a request was turned away. Each maps to one status and error code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// The bearer token is missing, malformed or wrong.
    Unauthenticated,
    /// The request came from a browser context.
    BrowserOrigin,
    /// The Host header is missing or not one barkloader answers to.
    UnknownHost,
}

impl Refusal {
    fn status(self) -> StatusCode {
        match self {
            Refusal::Unauthenticated => StatusCode::UNAUTHORIZED,
            Refusal::BrowserOrigin | Refusal::UnknownHost => StatusCode::FORBIDDEN,
        }
    }

    fn code(self) -> &'static str {
        match self {
            Refusal::Unauthenticated => "unauthenticated",
            Refusal::BrowserOrigin | Refusal::UnknownHost => "forbidden",
        }
    }

    fn message(self) -> &'static str {
        match self {
            Refusal::Unauthenticated => "a valid Authorization: Bearer service key is required",
            Refusal::BrowserOrigin => "requests from a browser context are refused",
            Refusal::UnknownHost => "the Host header does not name this service",
        }
    }

    fn response(self) -> HttpResponse {
        HttpResponse::build(self.status()).json(json!({
            "error": { "code": self.code(), "message": self.message() }
        }))
    }
}

/// The checks every authenticated route runs, built once at startup.
pub struct ServiceAuth {
    key: Vec<u8>,
    /// Lowercase `host:port` values the Host header may carry.
    allowed_hosts: Vec<String>,
}

impl ServiceAuth {
    /// `port` is the one barkloader listens on; `extra_host` is the
    /// configured [`ALLOWED_HOST_CONFIG_KEY`], blank when unset.
    pub fn new(key: &str, port: u16, extra_host: &str) -> Result<Self, ServiceAuthError> {
        validate_secret("barkloaderKey", key)?;
        let mut allowed_hosts = vec![
            format!("127.0.0.1:{port}"),
            format!("localhost:{port}"),
            format!("[::1]:{port}"),
        ];
        let extra_host = extra_host.trim();
        if !extra_host.is_empty() {
            if !is_host_value(extra_host) {
                return Err(ServiceAuthError::InvalidAllowedHost(extra_host.to_string()));
            }
            allowed_hosts.push(extra_host.to_ascii_lowercase());
        }
        // Trimmed like the validator: an HTTP header value loses its
        // surrounding whitespace in transit, so an untrimmed key never matches.
        Ok(Self {
            key: key.trim().as_bytes().to_vec(),
            allowed_hosts,
        })
    }

    /// Browser-context and Host checks come first so a page that guessed the
    /// key still cannot use it from a browser.
    pub fn check(&self, headers: &HeaderMap) -> Result<(), Refusal> {
        if is_browser_context(headers) {
            return Err(Refusal::BrowserOrigin);
        }
        if !self.is_allowed_host(headers) {
            return Err(Refusal::UnknownHost);
        }
        match bearer_token(headers) {
            Some(token) if bool::from(token.as_bytes().ct_eq(&self.key)) => Ok(()),
            _ => Err(Refusal::Unauthenticated),
        }
    }

    /// Read from the Host header itself, never from `connection_info`, which
    /// trusts `Forwarded` and `X-Forwarded-Host` headers the caller controls.
    fn is_allowed_host(&self, headers: &HeaderMap) -> bool {
        let Some(host) = headers.get(header::HOST).and_then(|v| v.to_str().ok()) else {
            return false;
        };
        let host = host.to_ascii_lowercase();
        self.allowed_hosts.contains(&host)
    }
}

/// The middleware itself: wrap a scope with
/// `from_fn(move |req, next| service_auth(auth.clone(), req, next))`.
pub async fn service_auth(
    auth: Arc<ServiceAuth>,
    req: ServiceRequest,
    next: Next<impl MessageBody>,
) -> Result<ServiceResponse<EitherBody<impl MessageBody>>, Error> {
    match auth.check(req.headers()) {
        Ok(()) => Ok(next.call(req).await?.map_into_left_body()),
        Err(refusal) => {
            tracing::warn!(
                method = %req.method(),
                path = %req.path(),
                reason = ?refusal,
                "refused a request to an authenticated route"
            );
            Ok(req.into_response(refusal.response()).map_into_right_body())
        }
    }
}

fn is_browser_context(headers: &HeaderMap) -> bool {
    if headers.contains_key(header::ORIGIN) {
        return true;
    }
    headers
        .get("sec-fetch-site")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|site| {
            CROSS_SITE_FETCH_VALUES
                .iter()
                .any(|value| site.trim().eq_ignore_ascii_case(value))
        })
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    if !scheme.eq_ignore_ascii_case("Bearer") {
        return None;
    }
    Some(token)
}

/// A bare host name, IPv4 address, bracketed IPv6 address, each with an
/// optional port: the shape of a Host header, nothing that could hide a
/// scheme, path or user info.
fn is_host_value(value: &str) -> bool {
    value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::http::header::{HeaderName, HeaderValue};

    const KEY: &str = "0123456789abcdef0123456789abcdef";
    const PORT: u16 = 9653;

    /// A label, the request's headers and what `check` should answer.
    type CheckCase<'a> = (&'a str, Vec<(&'static str, &'a str)>, Result<(), Refusal>);

    fn auth() -> ServiceAuth {
        ServiceAuth::new(KEY, PORT, "").unwrap()
    }

    fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(
                HeaderName::from_static(name),
                HeaderValue::from_str(value).unwrap(),
            );
        }
        map
    }

    #[test]
    fn test_service_auth_check_table() {
        let bearer = format!("Bearer {KEY}");
        let lowercase_bearer = format!("bearer {KEY}");
        let overlong_bearer = format!("Bearer {KEY}x");
        let basic = format!("Basic {KEY}");
        let cases: &[CheckCase] = &[
            (
                "correct key on loopback",
                vec![("host", "127.0.0.1:9653"), ("authorization", &bearer)],
                Ok(()),
            ),
            (
                "localhost, any case",
                vec![("host", "LOCALHOST:9653"), ("authorization", &bearer)],
                Ok(()),
            ),
            (
                "bracketed ipv6 loopback",
                vec![("host", "[::1]:9653"), ("authorization", &bearer)],
                Ok(()),
            ),
            (
                "lowercase scheme",
                vec![
                    ("host", "127.0.0.1:9653"),
                    ("authorization", &lowercase_bearer),
                ],
                Ok(()),
            ),
            (
                "no authorization header",
                vec![("host", "127.0.0.1:9653")],
                Err(Refusal::Unauthenticated),
            ),
            (
                "wrong key",
                vec![
                    ("host", "127.0.0.1:9653"),
                    ("authorization", "Bearer ffffffffffffffffffffffffffffffff"),
                ],
                Err(Refusal::Unauthenticated),
            ),
            (
                "key as a prefix of the token",
                vec![
                    ("host", "127.0.0.1:9653"),
                    ("authorization", &overlong_bearer),
                ],
                Err(Refusal::Unauthenticated),
            ),
            (
                "basic scheme",
                vec![("host", "127.0.0.1:9653"), ("authorization", &basic)],
                Err(Refusal::Unauthenticated),
            ),
            (
                "correct key with an Origin",
                vec![
                    ("host", "127.0.0.1:9653"),
                    ("authorization", &bearer),
                    ("origin", "https://evil.example"),
                ],
                Err(Refusal::BrowserOrigin),
            ),
            (
                "correct key, cross-site fetch",
                vec![
                    ("host", "127.0.0.1:9653"),
                    ("authorization", &bearer),
                    ("sec-fetch-site", "cross-site"),
                ],
                Err(Refusal::BrowserOrigin),
            ),
            (
                "correct key, same-site fetch",
                vec![
                    ("host", "127.0.0.1:9653"),
                    ("authorization", &bearer),
                    ("sec-fetch-site", "same-site"),
                ],
                Err(Refusal::BrowserOrigin),
            ),
            (
                "correct key, rebound host",
                vec![("host", "evil.example"), ("authorization", &bearer)],
                Err(Refusal::UnknownHost),
            ),
            (
                "correct key, loopback on another port",
                vec![("host", "127.0.0.1:80"), ("authorization", &bearer)],
                Err(Refusal::UnknownHost),
            ),
            (
                "correct key, no host",
                vec![("authorization", &bearer)],
                Err(Refusal::UnknownHost),
            ),
            (
                "forwarded host is not trusted",
                vec![
                    ("host", "evil.example"),
                    ("x-forwarded-host", "127.0.0.1:9653"),
                    ("authorization", &bearer),
                ],
                Err(Refusal::UnknownHost),
            ),
        ];
        let auth = auth();
        for (label, pairs, expected) in cases {
            assert_eq!(auth.check(&headers(pairs)), *expected, "{label}");
        }
    }

    #[test]
    fn test_service_auth_new_allows_a_configured_host() {
        let auth = ServiceAuth::new(KEY, PORT, " Barkloader:9653 ").unwrap();
        let bearer = format!("Bearer {KEY}");
        let request = headers(&[("host", "barkloader:9653"), ("authorization", &bearer)]);
        assert_eq!(auth.check(&request), Ok(()));
    }

    #[test]
    fn test_service_auth_new_refuses_bad_config() {
        assert!(matches!(
            ServiceAuth::new("CHANGE_ME", PORT, ""),
            Err(ServiceAuthError::Secret(SecretError::Placeholder { .. }))
        ));
        for bad in ["http://barkloader", "user@host", "host/path", "a b"] {
            assert!(
                matches!(
                    ServiceAuth::new(KEY, PORT, bad),
                    Err(ServiceAuthError::InvalidAllowedHost(_))
                ),
                "{bad}"
            );
        }
    }
}
