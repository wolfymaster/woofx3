use lib_sandbox::host::{Enforcement, HttpClient, HttpRequest};
use lib_sandbox::net::{self, Refusal};
use serde_json::Value;
use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::runtime::Handle;
use tracing::warn;

/// Redirects a module's request may follow, as reqwest's default allows.
const MAX_REDIRECTS: usize = 10;

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
}

impl ReqwestHttpClient {
    pub fn new(policy: HttpPolicy) -> Self {
        let client = reqwest::Client::builder()
            // Followed here instead, so each hop is checked like the first.
            .redirect(reqwest::redirect::Policy::none())
            .dns_resolver(Arc::new(GuardedResolver {
                allow_private: policy.allow_private,
            }))
            .build()
            .expect("reqwest client with a custom resolver and no redirects always builds");
        Self { client, policy }
    }

    /// Why this request may not go to `url`, logged; an error when the policy
    /// enforces that refusal.
    fn check(
        &self,
        module_id: &str,
        grants: &HashSet<String>,
        enforcement: Enforcement,
        url: &reqwest::Url,
    ) -> Result<(), String> {
        let Some(refusal) = net::refusal(grants, url, self.policy.allow_private) else {
            return Ok(());
        };
        let enforced = self.policy.enforces(&refusal, enforcement);
        warn!(
            "ctx.http to an ungranted destination module={} host={} enforced={} reason={}",
            module_id,
            url.host_str().unwrap_or(""),
            enforced,
            refusal
        );
        if enforced {
            return Err(format!("permission_denied: ctx.http: {refusal}"));
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
        let headers = request.opts.get("headers").cloned().unwrap_or(Value::Null);

        Handle::current().block_on(async {
            for _ in 0..=MAX_REDIRECTS {
                self.check(request.module_id, request.grants, request.enforcement, &url)?;
                let response = send(&self.client, &url, &method, &headers, &body).await?;
                let status = response.status();
                let location = status
                    .is_redirection()
                    .then(|| response.headers().get(reqwest::header::LOCATION))
                    .flatten()
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string);
                let Some(location) = location else {
                    return into_value(response).await;
                };
                url = url
                    .join(&location)
                    .map_err(|e| format!("redirect to an invalid location {location:?}: {e}"))?;
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
            Err(format!("more than {MAX_REDIRECTS} redirects"))
        })
    }
}

async fn send(
    client: &reqwest::Client,
    url: &reqwest::Url,
    method: &reqwest::Method,
    headers: &Value,
    body: &Value,
) -> Result<reqwest::Response, String> {
    let mut builder = client.request(method.clone(), url.clone());

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

    builder.send().await.map_err(|e| e.to_string())
}

async fn into_value(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status().as_u16() as i64;
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
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
        let client = ReqwestHttpClient::new(HttpPolicy {
            mode: HttpPolicyMode::Enforce,
            allow_private: false,
        });
        let grants = grants(&["net:api.spotify.com"]);
        let result = tokio::task::block_in_place(|| {
            client.request(HttpRequest {
                module_id: "mymod",
                grants: &grants,
                url: "https://evil.example.com/steal",
                method: "GET",
                opts: Value::Null,
                enforcement: Enforcement::Policy,
            })
        });
        let error = result.unwrap_err();
        assert!(error.starts_with("permission_denied:"), "{error}");
        assert!(error.contains("evil.example.com"), "{error}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn enforcing_refuses_a_private_address_even_when_granted() {
        let client = ReqwestHttpClient::new(HttpPolicy {
            mode: HttpPolicyMode::Enforce,
            allow_private: false,
        });
        let grants = grants(&["origin:http://127.0.0.1:9"]);
        let result = tokio::task::block_in_place(|| {
            client.request(HttpRequest {
                module_id: "mymod",
                grants: &grants,
                url: "http://127.0.0.1:9/",
                method: "GET",
                opts: Value::Null,
                enforcement: Enforcement::Policy,
            })
        });
        assert!(result.unwrap_err().contains("private or local"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn logging_still_refuses_a_private_address_literal() {
        let client = ReqwestHttpClient::new(HttpPolicy {
            mode: HttpPolicyMode::Log,
            allow_private: false,
        });
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
}
