use lib_sandbox::host::{HttpClient, HttpRequest};
use lib_sandbox::net;
use serde_json::Value;
use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::runtime::Handle;
use tracing::warn;

/// Redirects a module's request may follow, as reqwest's default allows.
const MAX_REDIRECTS: usize = 10;

/// What happens when module code reaches a destination its module was not
/// granted (see `lib_sandbox::net`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HttpPolicyMode {
    /// Log the destination and send the request anyway, so modules written
    /// before host permissions can be found and updated before `Enforce`.
    Log,
    /// Refuse the request with `permission_denied`.
    Enforce,
}

#[derive(Debug, Clone, Copy)]
pub struct HttpPolicy {
    pub mode: HttpPolicyMode,
    /// Let module code reach loopback, private and link-local addresses: for
    /// a self-hosted engine whose modules talk to its own network. Never set
    /// on a managed engine, where those addresses are the engine's own
    /// services and its host's metadata endpoint.
    pub allow_private: bool,
}

impl HttpPolicy {
    /// `WOOFX3_MODULE_HTTP` (`log`, the default, or `enforce`) and
    /// `WOOFX3_MODULE_HTTP_ALLOW_PRIVATE` (`true` to allow).
    pub fn from_settings(mode: &str, allow_private: &str) -> Result<Self, String> {
        let mode = match mode.trim() {
            "" | "log" => HttpPolicyMode::Log,
            "enforce" => HttpPolicyMode::Enforce,
            other => {
                return Err(format!(
                    "WOOFX3_MODULE_HTTP must be log or enforce, not {other:?}"
                ));
            }
        };
        Ok(Self {
            mode,
            allow_private: allow_private.trim() == "true",
        })
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
            .dns_resolver(Arc::new(GuardedResolver { policy }))
            .build()
            .expect("reqwest client with a custom resolver and no redirects always builds");
        Self { client, policy }
    }

    /// Why this request may not go to `url`, logged; an error only when the
    /// policy enforces.
    fn check(
        &self,
        module_id: &str,
        grants: &HashSet<String>,
        url: &reqwest::Url,
    ) -> Result<(), String> {
        let Some(reason) = net::refusal(grants, url, self.policy.allow_private) else {
            return Ok(());
        };
        warn!(
            "ctx.http to an ungranted destination module={} host={} enforced={} reason={}",
            module_id,
            url.host_str().unwrap_or(""),
            self.policy.mode == HttpPolicyMode::Enforce,
            reason
        );
        match self.policy.mode {
            HttpPolicyMode::Log => Ok(()),
            HttpPolicyMode::Enforce => Err(format!("permission_denied: ctx.http: {reason}")),
        }
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
                self.check(request.module_id, request.grants, &url)?;
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
struct GuardedResolver {
    policy: HttpPolicy,
}

impl reqwest::dns::Resolve for GuardedResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let policy = self.policy;
        Box::pin(async move {
            let host = name.as_str().to_string();
            let addrs: Vec<SocketAddr> =
                tokio::net::lookup_host((host.as_str(), 0)).await?.collect();
            if !policy.allow_private {
                if let Some(addr) = addrs.iter().find(|addr| net::is_restricted_ip(addr.ip())) {
                    warn!(
                        "ctx.http host resolves to a private or local address host={} address={} enforced={}",
                        host,
                        addr.ip(),
                        policy.mode == HttpPolicyMode::Enforce
                    );
                    if policy.mode == HttpPolicyMode::Enforce {
                        return Err(format!("permission_denied: ctx.http: {host} resolves to a private or local address").into());
                    }
                }
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
    fn the_policy_logs_by_default_and_enforces_when_asked() {
        let default = HttpPolicy::from_settings("", "").unwrap();
        assert_eq!(default.mode, HttpPolicyMode::Log);
        assert!(!default.allow_private);
        let strict = HttpPolicy::from_settings("enforce", "true").unwrap();
        assert_eq!(strict.mode, HttpPolicyMode::Enforce);
        assert!(strict.allow_private);
        assert!(HttpPolicy::from_settings("strict", "").is_err());
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
            })
        });
        assert!(result.unwrap_err().contains("private or local"));
    }
}
