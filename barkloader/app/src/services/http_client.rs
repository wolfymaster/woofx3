use lib_sandbox::host::HttpClient;
use serde_json::Value;
use tokio::runtime::Handle;

pub struct ReqwestHttpClient {
    client: reqwest::Client,
}

impl ReqwestHttpClient {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }
}

impl HttpClient for ReqwestHttpClient {
    fn request(&self, url: &str, method: &str, opts: Value) -> Result<Value, String> {
        let client = self.client.clone();
        let url = url.to_string();
        let method_str = method.to_string();

        Handle::current().block_on(async move {
            let method = reqwest::Method::from_bytes(method_str.as_bytes())
                .map_err(|e| format!("invalid HTTP method: {}", e))?;

            let mut builder = client.request(method, &url);

            if let Some(query) = opts.get("query").and_then(|q| q.as_object()) {
                let pairs: Vec<(String, String)> = query
                    .iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect();
                builder = builder.query(&pairs);
            }

            if let Some(headers) = opts.get("headers").and_then(|h| h.as_object()) {
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

            match opts.get("body") {
                Some(Value::String(s)) => {
                    builder = builder.body(s.clone());
                }
                Some(Value::Null) | None => {
                    // Some APIs (e.g. Spotify's queue endpoint) require a
                    // Content-Length header even on a bodyless POST/PUT/PATCH
                    // and reply 411 Length Required without one. reqwest/hyper
                    // omit Content-Length whenever the body is zero-length —
                    // setting an empty body isn't enough, the header must be
                    // added explicitly.
                    if matches!(method_str.to_uppercase().as_str(), "POST" | "PUT" | "PATCH") {
                        builder = builder.header(reqwest::header::CONTENT_LENGTH, "0");
                    }
                }
                Some(other) => {
                    builder = builder.json(other);
                }
            }

            let response = builder.send().await.map_err(|e| e.to_string())?;
            let status = response.status().as_u16() as i64;

            let bytes = response.bytes().await.map_err(|e| e.to_string())?;
            let body_value: Value = if bytes.is_empty() {
                Value::Null
            } else if let Ok(json) = serde_json::from_slice::<Value>(&bytes) {
                json
            } else {
                Value::String(String::from_utf8_lossy(&bytes).to_string())
            };

            Ok::<Value, String>(serde_json::json!({
                "status": status,
                "body": body_value
            }))
        })
    }
}
