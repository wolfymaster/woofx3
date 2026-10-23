use lib_sandbox::host::{Enforcement, HttpClient, HttpRequest, MAX_INVOCATION_TIMEOUT};
use lib_sandbox::net::{self, Refusal};
use serde_json::Value;
use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::runtime::Handle;
use tracing::warn;

const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// Under the longest an invocation may take (`MAX_INVOCATION_TIMEOUT`), so
/// one request cannot use all of it.
const DEFAULT_MAX_REQUEST_TIMEOUT: Duration = Duration::from_secs(25);
const DEFAULT_MAX_RESPONSE_BYTES: u64 = 4 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS: usize = 5;

/// Request headers that carry credentials, dropped before a redirect hop to
/// another origin, as browsers and reqwest do.
const CREDENTIAL_HEADERS: &[&str] = &["authorization", "proxy-authorization", "cookie"];

/// What happens when module code reaches a destination outside its grants
/// (see `lib_sandbox::net`). Private and local addresses are a separate rule
/// (`HttpPolicy::allow_private`) that this mode never relaxes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HttpPolicyMode {
    /// Refuse the request with `permission_denied`.
    Enforce,
    /// Log the destination and send the request anyway: an explicit opt-in so
    /// an operator can find and update modules written before host
    /// permissions.
    Log,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PolicyError {
    #[error("WOOFX3_MODULE_HTTP must be enforce or log, not {0:?}")]
    Mode(String),
    #[error("WOOFX3_MODULE_HTTP_ALLOW_PRIVATE must be true or false, not {0:?}")]
    AllowPrivate(String),
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LimitsError {
    #[error("{name} must be a whole number above zero, not {value:?}")]
    Invalid { name: &'static str, value: String },
    #[error("{name} must be at most {max} ms, the longest an invocation may take, not {value}")]
    TooLong {
        name: &'static str,
        value: u64,
        max: u64,
    },
}

/// What one `ctx.http` request may cost the engine. Read once at startup.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HttpClientLimits {
    /// Time allowed to open the connection.
    pub connect_timeout: Duration,
    /// Ceiling on the whole request (redirects and body included); the
    /// invocation's own deadline cuts it shorter when that comes first.
    pub max_request_timeout: Duration,
    /// Largest response body read into memory, which the module VM's memory
    /// limit does not cover.
    pub max_response_bytes: u64,
    /// Redirects followed before the request fails.
    pub max_redirects: usize,
}

impl Default for HttpClientLimits {
    fn default() -> Self {
        Self {
            connect_timeout: DEFAULT_CONNECT_TIMEOUT,
            max_request_timeout: DEFAULT_MAX_REQUEST_TIMEOUT,
            max_response_bytes: DEFAULT_MAX_RESPONSE_BYTES,
            max_redirects: DEFAULT_MAX_REDIRECTS,
        }
    }
}

impl HttpClientLimits {
    /// Reads `WOOFX3_MODULE_HTTP_CONNECT_TIMEOUT_MS`, `_REQUEST_TIMEOUT_MS`,
    /// `_MAX_RESPONSE_BYTES` and `_MAX_REDIRECTS` through `lookup`. A blank
    /// value keeps the default; anything but a whole number above zero is an
    /// error, and so is a timeout longer than `MAX_INVOCATION_TIMEOUT`, which
    /// would let the connect-time token exchange (it has no invocation
    /// deadline) hold a thread for that long.
    pub fn from_lookup(lookup: impl Fn(&str) -> String) -> Result<Self, LimitsError> {
        let defaults = Self::default();
        let number = |name: &'static str, default: u64| -> Result<u64, LimitsError> {
            let value = lookup(name);
            let value = value.trim();
            if value.is_empty() {
                return Ok(default);
            }
            match value.parse::<u64>() {
                Ok(parsed) if parsed > 0 => Ok(parsed),
                _ => Err(LimitsError::Invalid {
                    name,
                    value: value.to_string(),
                }),
            }
        };
        let timeout = |name: &'static str, default: Duration| -> Result<Duration, LimitsError> {
            let millis = number(name, default.as_millis() as u64)?;
            let max = MAX_INVOCATION_TIMEOUT.as_millis() as u64;
            if millis > max {
                return Err(LimitsError::TooLong {
                    name,
                    value: millis,
                    max,
                });
            }
            Ok(Duration::from_millis(millis))
        };
        Ok(Self {
            connect_timeout: timeout(
                "WOOFX3_MODULE_HTTP_CONNECT_TIMEOUT_MS",
                defaults.connect_timeout,
            )?,
            max_request_timeout: timeout(
                "WOOFX3_MODULE_HTTP_REQUEST_TIMEOUT_MS",
                defaults.max_request_timeout,
            )?,
            max_response_bytes: number(
                "WOOFX3_MODULE_HTTP_MAX_RESPONSE_BYTES",
                defaults.max_response_bytes,
            )?,
            max_redirects: number(
                "WOOFX3_MODULE_HTTP_MAX_REDIRECTS",
                defaults.max_redirects as u64,
            )? as usize,
        })
    }
}

/// Why a request stopped for running past a limit. Crosses the `HttpClient`
/// boundary as its message.
#[derive(Debug, thiserror::Error)]
enum LimitError {
    #[error("deadline_exceeded: ctx.http: the request did not finish in time")]
    DeadlineExceeded,
    #[error("response_too_large: ctx.http: the response is larger than {limit} bytes")]
    ResponseTooLarge { limit: u64 },
    #[error("too_many_redirects: ctx.http: more than {max} redirects")]
    TooManyRedirects { max: usize },
}

/// Why the client refused to send a request. Crosses the `HttpClient`
/// boundary as its message, which starts with the `permission_denied` code
/// module code sees.
#[derive(Debug, thiserror::Error)]
enum EgressError {
    #[error("permission_denied: ctx.http: {0}")]
    Refused(Refusal),
    #[error(
        "permission_denied: ctx.http: a request carrying credentials for {from} is not followed to another origin, {to}"
    )]
    CrossOriginRedirect { from: String, to: String },
}

/// The two egress rules for module requests, parsed once at startup.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HttpPolicy {
    /// The grant rule: what happens to a destination the module was not
    /// granted.
    pub mode: HttpPolicyMode,
    /// The private-address rule: let module code reach loopback, private and
    /// link-local addresses, for a self-hosted engine whose modules talk to
    /// its own network. Never set on a managed engine, where those addresses
    /// are the engine's own services and its host's metadata endpoint. When
    /// false these addresses are refused in every mode.
    pub allow_private: bool,
}

impl HttpPolicy {
    /// `WOOFX3_MODULE_HTTP` (`enforce`, the default, or `log`) and
    /// `WOOFX3_MODULE_HTTP_ALLOW_PRIVATE` (`false`, the default, or `true`).
    /// Any other value is an error, so a typo never weakens the policy.
    pub fn from_settings(mode: &str, allow_private: &str) -> Result<Self, PolicyError> {
        let mode = match mode.trim() {
            "" | "enforce" => HttpPolicyMode::Enforce,
            "log" => HttpPolicyMode::Log,
            other => return Err(PolicyError::Mode(other.to_string())),
        };
        let allow_private = match allow_private.trim() {
            "" | "false" => false,
            "true" => true,
            other => return Err(PolicyError::AllowPrivate(other.to_string())),
        };
        Ok(Self {
            mode,
            allow_private,
        })
    }

    /// Whether `refusal` stops the request. Only the grant rule follows the
    /// mode, and only for requests that defer to it; a URL that is not
    /// http(s) or names a private address never goes.
    fn enforces(&self, refusal: &Refusal, enforcement: Enforcement) -> bool {
        match refusal {
            Refusal::Unreachable(_) | Refusal::PrivateAddress(_) => true,
            Refusal::Ungranted(_) => {
                enforcement == Enforcement::Always || self.mode == HttpPolicyMode::Enforce
            }
        }
    }
}

/// The HTTP client behind `ctx.http`. Every request and every redirect hop
/// is checked against the invocation's grants, and every address a host name
/// resolves to against the private ranges, before anything is sent.
pub struct ReqwestHttpClient {
    client: reqwest::Client,
    policy: HttpPolicy,
    limits: HttpClientLimits,
}

impl ReqwestHttpClient {
    pub fn new(policy: HttpPolicy, limits: HttpClientLimits) -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(limits.connect_timeout)
            // Followed here instead, so each hop is checked like the first.
            .redirect(reqwest::redirect::Policy::none())
            // A proxy would resolve the destination itself and skip the
            // resolver's check of the addresses it answers with.
            .no_proxy()
            .dns_resolver(Arc::new(GuardedResolver {
                allow_private: policy.allow_private,
            }))
            .build()
            .expect("reqwest client with a custom resolver and no redirects always builds");
        Self {
            client,
            policy,
            limits,
        }
    }

    /// Why this request may not go to `url`, logged; an error when the policy
    /// enforces that refusal.
    fn check(
        &self,
        module_id: &str,
        grants: &HashSet<String>,
        enforcement: Enforcement,
        url: &reqwest::Url,
    ) -> Result<(), EgressError> {
        let Some(refusal) = net::refusal(grants, url, self.policy.allow_private) else {
            return Ok(());
        };
        let enforced = self.policy.enforces(&refusal, enforcement);
        warn!(
            "ctx.http destination not allowed module={} host={} enforced={} reason={}",
            module_id,
            url.host_str().unwrap_or(""),
            enforced,
            refusal
        );
        if enforced {
            return Err(EgressError::Refused(refusal));
        }
        Ok(())
    }
}

impl HttpClient for ReqwestHttpClient {
    fn request(&self, request: HttpRequest<'_>) -> Result<Value, String> {
        let mut url = reqwest::Url::parse(request.url)
            .map_err(|e| format!("invalid URL {:?}: {e}", request.url))?;
        if let Some(query) = request.opts.get("query").and_then(|q| q.as_object()) {
            let mut pairs = url.query_pairs_mut();
            for (k, v) in query {
                if let Some(s) = v.as_str() {
                    pairs.append_pair(k, s);
                }
            }
        }
        let mut method = reqwest::Method::from_bytes(request.method.as_bytes())
            .map_err(|e| format!("invalid HTTP method: {}", e))?;
        let mut body = request.opts.get("body").cloned().unwrap_or(Value::Null);
        let mut headers = request.opts.get("headers").cloned().unwrap_or(Value::Null);
        let first_origin = url.origin();
        // One budget for the whole request, redirects and body included.
        let give_up_at = Instant::now() + self.limits.max_request_timeout;
        let give_up_at = request.deadline.map_or(give_up_at, |d| d.min(give_up_at));

        Handle::current().block_on(async {
            for _ in 0..=self.limits.max_redirects {
                self.check(request.module_id, request.grants, request.enforcement, &url)
                    .map_err(|e| e.to_string())?;
                let budget = give_up_at.saturating_duration_since(Instant::now());
                if budget.is_zero() {
                    return Err(LimitError::DeadlineExceeded.to_string());
                }
                let response = send(&self.client, &url, &method, &headers, &body, budget).await?;
                let status = response.status();
                let location = status
                    .is_redirection()
                    .then(|| response.headers().get(reqwest::header::LOCATION))
                    .flatten()
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string);
                let Some(location) = location else {
                    return into_value(response, self.limits.max_response_bytes).await;
                };
                url = url
                    .join(&location)
                    .map_err(|e| format!("redirect to an invalid location {location:?}: {e}"))?;
                if url.origin() != first_origin {
                    if request.enforcement == Enforcement::Always {
                        return Err(EgressError::CrossOriginRedirect {
                            from: first_origin.ascii_serialization(),
                            to: url.origin().ascii_serialization(),
                        }
                        .to_string());
                    }
                    drop_credential_headers(&mut headers);
                }
                // As browsers and reqwest do: a 303, or a 301/302 after a
                // POST, is followed with a GET and no body.
                if status == reqwest::StatusCode::SEE_OTHER
                    || (method == reqwest::Method::POST
                        && matches!(
                            status,
                            reqwest::StatusCode::MOVED_PERMANENTLY | reqwest::StatusCode::FOUND
                        ))
                {
                    method = reqwest::Method::GET;
                    body = Value::Null;
                }
            }
            Err(LimitError::TooManyRedirects {
                max: self.limits.max_redirects,
            }
            .to_string())
        })
    }
}

/// Remove `CREDENTIAL_HEADERS` from a module's header map, whatever their
/// case. Once removed they stay removed for the rest of the redirect chain.
fn drop_credential_headers(headers: &mut Value) {
    if let Some(headers) = headers.as_object_mut() {
        headers.retain(|name, _| {
            !CREDENTIAL_HEADERS
                .iter()
                .any(|credential| name.eq_ignore_ascii_case(credential))
        });
    }
}

async fn send(
    client: &reqwest::Client,
    url: &reqwest::Url,
    method: &reqwest::Method,
    headers: &Value,
    body: &Value,
    timeout: Duration,
) -> Result<reqwest::Response, String> {
    let mut builder = client.request(method.clone(), url.clone()).timeout(timeout);

    if let Some(headers) = headers.as_object() {
        for (k, v) in headers {
            if let Some(v_str) = v.as_str() {
                let name = k
                    .parse::<reqwest::header::HeaderName>()
                    .map_err(|e| format!("invalid header name '{}': {}", k, e))?;
                let value = v_str
                    .parse::<reqwest::header::HeaderValue>()
                    .map_err(|e| format!("invalid header value for '{}': {}", k, e))?;
                builder = builder.header(name, value);
            }
        }
    }

    match body {
        Value::String(s) => {
            builder = builder.body(s.clone());
        }
        Value::Null => {
            // Some APIs (e.g. Spotify's queue endpoint) require a
            // Content-Length header even on a bodyless POST/PUT/PATCH
            // and reply 411 Length Required without one. reqwest/hyper
            // omit Content-Length whenever the body is zero-length —
            // setting an empty body isn't enough, the header must be
            // added explicitly.
            if matches!(method.as_str(), "POST" | "PUT" | "PATCH") {
                builder = builder.header(reqwest::header::CONTENT_LENGTH, "0");
            }
        }
        other => {
            builder = builder.json(other);
        }
    }

    builder.send().await.map_err(transport_error)
}

fn transport_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return LimitError::DeadlineExceeded.to_string();
    }
    error.to_string()
}

/// Read the body chunk by chunk, so a response over `max_bytes` is abandoned
/// as it arrives rather than buffered whole.
async fn read_body(mut response: reqwest::Response, max_bytes: u64) -> Result<Vec<u8>, String> {
    let too_large = || LimitError::ResponseTooLarge { limit: max_bytes }.to_string();
    if response.content_length().is_some_and(|len| len > max_bytes) {
        return Err(too_large());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(transport_error)? {
        if bytes.len() as u64 + chunk.len() as u64 > max_bytes {
            return Err(too_large());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn into_value(response: reqwest::Response, max_bytes: u64) -> Result<Value, String> {
    let status = response.status().as_u16() as i64;
    let bytes = read_body(response, max_bytes).await?;
    let body_value: Value = if bytes.is_empty() {
        Value::Null
    } else if let Ok(json) = serde_json::from_slice::<Value>(&bytes) {
        json
    } else {
        Value::String(String::from_utf8_lossy(&bytes).to_string())
    };
    Ok(serde_json::json!({
        "status": status,
        "body": body_value
    }))
}

/// Resolves host names for module requests and checks every address: a
/// granted host could still resolve to the engine's own network, by mistake
/// or because its owner pointed it there. Checking here, rather than before
/// sending, means the address checked is the address connected to.
/// Private addresses are refused whatever the grant mode, unless the engine
/// allows them.
struct GuardedResolver {
    allow_private: bool,
}

impl reqwest::dns::Resolve for GuardedResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let allow_private = self.allow_private;
        Box::pin(async move {
            let host = name.as_str().to_string();
            let addrs: Vec<SocketAddr> =
                tokio::net::lookup_host((host.as_str(), 0)).await?.collect();
            if !allow_private
                && let Some(addr) = addrs.iter().find(|addr| net::is_restricted_ip(addr.ip()))
            {
                warn!(
                    "ctx.http host resolves to a private or local address host={} address={}",
                    host,
                    addr.ip()
                );
                return Err(format!(
                    "permission_denied: ctx.http: {host} resolves to a private or local address"
                )
                .into());
            }
            let addrs: reqwest::dns::Addrs = Box::new(addrs.into_iter());
            Ok(addrs)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_policy_enforces_by_default_and_rejects_unknown_values() {
        let policy = |mode, allow_private| HttpPolicy {
            mode,
            allow_private,
        };
        let cases: &[(&str, &str, Result<HttpPolicy, PolicyError>)] = &[
            ("", "", Ok(policy(HttpPolicyMode::Enforce, false))),
            (
                "enforce",
                "false",
                Ok(policy(HttpPolicyMode::Enforce, false)),
            ),
            (
                " enforce ",
                " true ",
                Ok(policy(HttpPolicyMode::Enforce, true)),
            ),
            ("log", "", Ok(policy(HttpPolicyMode::Log, false))),
            ("log", "true", Ok(policy(HttpPolicyMode::Log, true))),
            ("strict", "", Err(PolicyError::Mode("strict".to_string()))),
            (
                "enforced",
                "",
                Err(PolicyError::Mode("enforced".to_string())),
            ),
            ("Log", "", Err(PolicyError::Mode("Log".to_string()))),
            ("", "yes", Err(PolicyError::AllowPrivate("yes".to_string()))),
            ("", "1", Err(PolicyError::AllowPrivate("1".to_string()))),
            (
                "",
                "True",
                Err(PolicyError::AllowPrivate("True".to_string())),
            ),
            (
                "",
                "flase",
                Err(PolicyError::AllowPrivate("flase".to_string())),
            ),
        ];
        for (mode, allow_private, expected) in cases {
            assert_eq!(
                &HttpPolicy::from_settings(mode, allow_private),
                expected,
                "mode={mode:?} allow_private={allow_private:?}"
            );
        }
    }

    fn grants(entries: &[&str]) -> HashSet<String> {
        entries.iter().map(|s| s.to_string()).collect()
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn enforcing_refuses_an_undeclared_host_before_sending() {
        let client = ReqwestHttpClient::new(
            HttpPolicy {
                mode: HttpPolicyMode::Enforce,
                allow_private: false,
            },
            HttpClientLimits::default(),
        );
        let grants = grants(&["net:api.spotify.com"]);
        let result = tokio::task::block_in_place(|| {
            client.request(HttpRequest {
                module_id: "mymod",
                grants: &grants,
                url: "https://evil.example.com/steal",
                method: "GET",
                opts: Value::Null,
                enforcement: Enforcement::Policy,
                deadline: None,
            })
        });
        let error = result.unwrap_err();
        assert!(error.starts_with("permission_denied:"), "{error}");
        assert!(error.contains("evil.example.com"), "{error}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn enforcing_refuses_a_private_address_even_when_granted() {
        let client = ReqwestHttpClient::new(
            HttpPolicy {
                mode: HttpPolicyMode::Enforce,
                allow_private: false,
            },
            HttpClientLimits::default(),
        );
        let grants = grants(&["origin:http://127.0.0.1:9"]);
        let result = tokio::task::block_in_place(|| {
            client.request(HttpRequest {
                module_id: "mymod",
                grants: &grants,
                url: "http://127.0.0.1:9/",
                method: "GET",
                opts: Value::Null,
                enforcement: Enforcement::Policy,
                deadline: None,
            })
        });
        assert!(result.unwrap_err().contains("private or local"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn logging_still_refuses_a_private_address_literal() {
        let client = ReqwestHttpClient::new(
            HttpPolicy {
                mode: HttpPolicyMode::Log,
                allow_private: false,
            },
            HttpClientLimits::default(),
        );
        let grants = grants(&[]);
        for url in [
            "http://127.0.0.1:5555/",
            "http://169.254.169.254/latest/meta-data/",
            "http://[::ffff:127.0.0.1]:9/",
        ] {
            let result = tokio::task::block_in_place(|| {
                client.request(HttpRequest {
                    module_id: "mymod",
                    grants: &grants,
                    url,
                    method: "GET",
                    opts: Value::Null,
                    enforcement: Enforcement::Policy,
                    deadline: None,
                })
            });
            let error = result.unwrap_err();
            assert!(error.starts_with("permission_denied:"), "{url}: {error}");
            assert!(error.contains("private or local"), "{url}: {error}");
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn the_resolver_refuses_private_answers_whatever_the_mode() {
        use reqwest::dns::Resolve;
        use std::str::FromStr;

        let resolver = GuardedResolver {
            allow_private: false,
        };
        let name = reqwest::dns::Name::from_str("localhost").unwrap();
        let error = match resolver.resolve(name).await {
            Ok(_) => panic!("localhost resolved for a module"),
            Err(error) => error.to_string(),
        };
        assert!(error.contains("private or local"), "{error}");

        let permissive = GuardedResolver {
            allow_private: true,
        };
        let name = reqwest::dns::Name::from_str("localhost").unwrap();
        assert!(permissive.resolve(name).await.is_ok());
    }

    /// Request heads a test server received, lowercased.
    type Heads = Arc<std::sync::Mutex<Vec<String>>>;

    /// A loopback HTTP server answering every request with `response`. Returns
    /// its origin and the request heads it receives.
    async fn serve(response: String) -> (String, Heads) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let heads = Heads::default();
        let received = heads.clone();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let mut head = Vec::new();
                let mut buf = [0u8; 1024];
                while !head.windows(4).any(|w| w == b"\r\n\r\n") {
                    match stream.read(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => head.extend_from_slice(&buf[..n]),
                    }
                }
                received
                    .lock()
                    .unwrap()
                    .push(String::from_utf8_lossy(&head).to_ascii_lowercase());
                // A client that hung up early fails its own assertions.
                let _ = stream.write_all(response.as_bytes()).await;
                let _ = stream.shutdown().await;
            }
        });
        (origin, heads)
    }

    /// A server that answers 200, and one on another port that redirects to
    /// it, with grants for both.
    struct CrossOriginRedirect {
        start: String,
        start_heads: Heads,
        target_heads: Heads,
        grants: HashSet<String>,
    }

    async fn cross_origin_redirect() -> CrossOriginRedirect {
        let (target, target_heads) = serve(
            "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok".to_string(),
        )
        .await;
        let (start, start_heads) = serve(format!(
            "HTTP/1.1 302 Found\r\nLocation: {target}/landing\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        ))
        .await;
        let grants = grants(&[&format!("origin:{start}"), &format!("origin:{target}")]);
        CrossOriginRedirect {
            start,
            start_heads,
            target_heads,
            grants,
        }
    }

    fn loopback_client() -> ReqwestHttpClient {
        ReqwestHttpClient::new(
            HttpPolicy {
                mode: HttpPolicyMode::Enforce,
                allow_private: true,
            },
            HttpClientLimits::default(),
        )
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_cross_origin_redirect_drops_credential_headers() {
        let CrossOriginRedirect {
            start,
            start_heads,
            target_heads,
            grants,
        } = cross_origin_redirect().await;
        let client = loopback_client();
        let url = format!("{start}/start");
        let response = tokio::task::block_in_place(|| {
            client.request(HttpRequest {
                module_id: "mymod",
                grants: &grants,
                url: &url,
                method: "GET",
                opts: serde_json::json!({ "headers": {
                    "Authorization": "Bearer secret",
                    "proxy-authorization": "Basic c2VjcmV0",
                    "Cookie": "session=secret",
                    "X-Trace": "kept",
                } }),
                enforcement: Enforcement::Policy,
                deadline: None,
            })
        })
        .unwrap();
        assert_eq!(response["status"], 200);
        let start_head = start_heads.lock().unwrap()[0].clone();
        assert!(
            start_head.contains("authorization: bearer secret"),
            "{start_head}"
        );
        let target_head = target_heads.lock().unwrap()[0].clone();
        assert!(target_head.starts_with("get /landing"), "{target_head}");
        assert!(!target_head.contains("secret"), "{target_head}");
        assert!(!target_head.contains("authorization"), "{target_head}");
        assert!(!target_head.contains("cookie"), "{target_head}");
        assert!(target_head.contains("x-trace: kept"), "{target_head}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_credential_request_refuses_a_cross_origin_redirect() {
        let CrossOriginRedirect {
            start,
            start_heads,
            target_heads,
            grants,
        } = cross_origin_redirect().await;
        let client = loopback_client();
        let url = format!("{start}/start");
        let error = tokio::task::block_in_place(|| {
            client.request(HttpRequest {
                module_id: "mymod",
                grants: &grants,
                url: &url,
                method: "GET",
                opts: serde_json::json!({ "headers": { "Authorization": "Bearer secret" } }),
                enforcement: Enforcement::Always,
                deadline: None,
            })
        })
        .unwrap_err();
        assert!(error.starts_with("permission_denied:"), "{error}");
        assert!(error.contains("another origin"), "{error}");
        assert_eq!(start_heads.lock().unwrap().len(), 1);
        assert!(target_heads.lock().unwrap().is_empty());
    }

    fn limited_client(limits: HttpClientLimits) -> Arc<ReqwestHttpClient> {
        Arc::new(ReqwestHttpClient::new(
            HttpPolicy {
                mode: HttpPolicyMode::Enforce,
                allow_private: true,
            },
            limits,
        ))
    }

    /// Fails the test, rather than hanging it, when the client never gives up.
    const TEST_HANG_GUARD: Duration = Duration::from_secs(10);

    async fn get(
        client: &Arc<ReqwestHttpClient>,
        origin: &str,
        deadline: Option<Instant>,
    ) -> Result<Value, String> {
        let client = client.clone();
        let origin = origin.to_string();
        let call = tokio::task::spawn_blocking(move || {
            let grants = grants(&[&format!("origin:{origin}")]);
            let url = format!("{origin}/");
            client.request(HttpRequest {
                module_id: "mymod",
                grants: &grants,
                url: &url,
                method: "GET",
                opts: Value::Null,
                enforcement: Enforcement::Policy,
                deadline,
            })
        });
        tokio::time::timeout(TEST_HANG_GUARD, call)
            .await
            .expect("the client did not give up on its own")
            .unwrap()
    }

    /// A loopback server that accepts connections and never answers.
    async fn stall() -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            let mut held = Vec::new();
            while let Ok((stream, _)) = listener.accept().await {
                held.push(stream);
            }
        });
        origin
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_stalled_server_is_abandoned_at_the_invocation_deadline() {
        let origin = stall().await;
        let client = limited_client(HttpClientLimits::default());
        let started = Instant::now();
        let error = get(
            &client,
            &origin,
            Some(Instant::now() + Duration::from_millis(300)),
        )
        .await
        .unwrap_err();
        assert!(error.starts_with("deadline_exceeded:"), "{error}");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "{:?}",
            started.elapsed()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_stalled_server_is_abandoned_at_the_request_ceiling() {
        let origin = stall().await;
        let client = limited_client(HttpClientLimits {
            max_request_timeout: Duration::from_millis(300),
            ..HttpClientLimits::default()
        });
        let started = Instant::now();
        let error = get(&client, &origin, None).await.unwrap_err();
        assert!(error.starts_with("deadline_exceeded:"), "{error}");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "{:?}",
            started.elapsed()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_body_that_stalls_after_the_headers_is_abandoned_at_the_deadline() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            let mut held = Vec::new();
            while let Ok((mut stream, _)) = listener.accept().await {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf).await;
                let _ = stream
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nabc")
                    .await;
                held.push(stream);
            }
        });
        let client = limited_client(HttpClientLimits::default());
        let started = Instant::now();
        let error = get(
            &client,
            &origin,
            Some(Instant::now() + Duration::from_millis(300)),
        )
        .await
        .unwrap_err();
        assert!(error.starts_with("deadline_exceeded:"), "{error}");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "{:?}",
            started.elapsed()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_deadline_that_has_passed_sends_nothing() {
        let (origin, heads) =
            serve("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n".to_string()).await;
        let client = limited_client(HttpClientLimits::default());
        let error = get(&client, &origin, Some(Instant::now()))
            .await
            .unwrap_err();
        assert!(error.starts_with("deadline_exceeded:"), "{error}");
        assert!(heads.lock().unwrap().is_empty());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_body_streamed_past_the_cap_is_aborted() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf).await;
                // No Content-Length: the cap can only be enforced as bytes arrive.
                let _ = stream
                    .write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n")
                    .await;
                let chunk = [b'x'; 1024];
                for _ in 0..1024 {
                    if stream.write_all(&chunk).await.is_err() {
                        return;
                    }
                }
            }
        });
        let client = limited_client(HttpClientLimits {
            max_response_bytes: 4096,
            ..HttpClientLimits::default()
        });
        let error = get(&client, &origin, None).await.unwrap_err();
        assert!(error.starts_with("response_too_large:"), "{error}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_content_length_over_the_cap_is_refused_before_reading() {
        let (origin, _) = serve(
            "HTTP/1.1 200 OK\r\nContent-Length: 1000000\r\nConnection: close\r\n\r\nshort"
                .to_string(),
        )
        .await;
        let client = limited_client(HttpClientLimits {
            max_response_bytes: 4096,
            ..HttpClientLimits::default()
        });
        let error = get(&client, &origin, None).await.unwrap_err();
        assert!(error.starts_with("response_too_large:"), "{error}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_body_at_the_cap_is_returned() {
        let (origin, _) = serve(
            "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello".to_string(),
        )
        .await;
        let client = limited_client(HttpClientLimits {
            max_response_bytes: 5,
            ..HttpClientLimits::default()
        });
        let response = get(&client, &origin, None).await.unwrap();
        assert_eq!(response["body"], "hello");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_redirect_chain_over_the_limit_is_refused() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let heads = Heads::default();
        let received = heads.clone();
        let location = format!("{origin}/again");
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            while let Ok((mut stream, _)) = listener.accept().await {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf).await;
                received.lock().unwrap().push(String::new());
                let _ = stream
                    .write_all(
                        format!(
                            "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        )
                        .as_bytes(),
                    )
                    .await;
            }
        });
        let client = limited_client(HttpClientLimits {
            max_redirects: 2,
            ..HttpClientLimits::default()
        });
        let error = get(&client, &origin, None).await.unwrap_err();
        assert!(error.starts_with("too_many_redirects:"), "{error}");
        // The first request plus two followed redirects.
        assert_eq!(heads.lock().unwrap().len(), 3);
    }

    #[test]
    fn limits_default_when_blank_and_reject_anything_but_a_positive_number() {
        let from = |pairs: &[(&str, &str)]| {
            HttpClientLimits::from_lookup(|name| {
                pairs
                    .iter()
                    .find(|(key, _)| *key == name)
                    .map_or(String::new(), |(_, value)| value.to_string())
            })
        };
        assert_eq!(from(&[]), Ok(HttpClientLimits::default()));
        let custom = from(&[
            ("WOOFX3_MODULE_HTTP_CONNECT_TIMEOUT_MS", " 250 "),
            ("WOOFX3_MODULE_HTTP_REQUEST_TIMEOUT_MS", "1000"),
            ("WOOFX3_MODULE_HTTP_MAX_RESPONSE_BYTES", "10"),
            ("WOOFX3_MODULE_HTTP_MAX_REDIRECTS", "1"),
        ])
        .unwrap();
        assert_eq!(custom.connect_timeout, Duration::from_millis(250));
        assert_eq!(custom.max_request_timeout, Duration::from_secs(1));
        assert_eq!(custom.max_response_bytes, 10);
        assert_eq!(custom.max_redirects, 1);
        for name in [
            "WOOFX3_MODULE_HTTP_CONNECT_TIMEOUT_MS",
            "WOOFX3_MODULE_HTTP_REQUEST_TIMEOUT_MS",
        ] {
            assert!(from(&[(name, "30000")]).is_ok(), "{name}");
            assert!(
                matches!(
                    from(&[(name, "30001")]),
                    Err(LimitsError::TooLong { max: 30_000, .. })
                ),
                "{name}"
            );
        }
        for bad in ["0", "-1", "4MiB", "1.5"] {
            assert!(
                matches!(
                    from(&[("WOOFX3_MODULE_HTTP_MAX_RESPONSE_BYTES", bad)]),
                    Err(LimitsError::Invalid { .. })
                ),
                "{bad}"
            );
        }
    }
}
