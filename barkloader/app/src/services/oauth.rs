//! `ctx.oauth`: OAuth on behalf of module code that must never hold the
//! credentials (`lib_sandbox::oauth`).
//!
//! The engine exchanges the authorization code the dashboard collected,
//! keeps the tokens sealed among the module's settings, refreshes them, and
//! attaches the access token to requests module code asks it to make, only
//! to the hosts the integration declares. Requests to the provider's token
//! endpoint go through the same guarded HTTP client as module requests: the
//! endpoint is named by a manifest too.

use lib_sandbox::ModuleRegistry;
use lib_sandbox::host::{
    CallScope, HostError, HostExtension, HostFunction, HttpClient, HttpRequest, SettingsClient,
};
use lib_sandbox::oauth::{OAuthIntegration, StoredOAuthToken, token_setting_key};
use serde_json::{Map, Value, json};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

/// A token this close to its expiry is refreshed before use.
const EXPIRY_MARGIN_MS: i64 = 60_000;

/// Writes a setting sealed (`lib_module::db_proxy::set_secret_module_setting`).
pub type SealedWrite = dyn Fn(&str, &str, &str) -> Result<(), String> + Send + Sync;

/// What the dashboard collected when the streamer approved access.
pub struct Authorization {
    pub code: String,
    pub code_verifier: String,
    pub redirect_uri: String,
    /// The OAuth client to exchange as, when the dashboard supplies the app
    /// (one woofx3 provides); otherwise the module's `clientIdSetting`.
    pub client_id: Option<String>,
    /// The token endpoint the dashboard checked when it chose `client_id`.
    /// Required with `client_id`: the dashboard may hand out an app only for
    /// endpoints that app is registered for, and the module can be updated
    /// between that check and this exchange, so the exchange is refused
    /// unless the installed integration's `tokenUrl` is still the same.
    pub token_url: Option<String>,
}

pub struct OAuthService {
    registry: Arc<ModuleRegistry>,
    settings: Arc<dyn SettingsClient>,
    write_sealed: Arc<SealedWrite>,
    http: Arc<dyn HttpClient>,
    now_ms: Arc<dyn Fn() -> i64 + Send + Sync>,
}

impl OAuthService {
    pub fn new(
        registry: Arc<ModuleRegistry>,
        settings: Arc<dyn SettingsClient>,
        write_sealed: Arc<SealedWrite>,
        http: Arc<dyn HttpClient>,
    ) -> Self {
        Self {
            registry,
            settings,
            write_sealed,
            http,
            now_ms: Arc::new(|| {
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0)
            }),
        }
    }

    #[cfg(test)]
    fn with_clock(mut self, now_ms: impl Fn() -> i64 + Send + Sync + 'static) -> Self {
        self.now_ms = Arc::new(now_ms);
        self
    }

    /// Exchange `authorization` for tokens and keep them. Returns the scopes
    /// the provider granted.
    pub fn complete(
        &self,
        module_id: &str,
        integration_id: &str,
        authorization: Authorization,
    ) -> Result<Vec<String>, String> {
        let integration = self.integration(module_id, integration_id)?;
        let settings = self.settings.list_by_module(module_id)?;
        let client_id = match authorization.client_id.filter(|id| !id.is_empty()) {
            Some(id) => {
                let Some(checked) = authorization.token_url.as_deref() else {
                    return Err(format!(
                        "{integration_id}: a supplied client id needs the tokenUrl it was chosen for"
                    ));
                };
                if checked != integration.token_url {
                    return Err(format!(
                        "{integration_id}: the module's tokenUrl changed since this connect started; connect again"
                    ));
                }
                id
            }
            None => setting_string(&settings, &integration.client_id_setting).ok_or_else(|| {
                format!(
                    "{integration_id}: no client id; set the module's {:?} setting",
                    integration.client_id_setting
                )
            })?,
        };
        let mut form = vec![
            ("grant_type", "authorization_code".to_string()),
            ("code", authorization.code),
            ("redirect_uri", authorization.redirect_uri),
            ("client_id", client_id.clone()),
            ("code_verifier", authorization.code_verifier),
        ];
        if let Some(secret) = client_secret(&integration, &settings) {
            form.push(("client_secret", secret));
        }
        let token = self.token_request(module_id, &integration, &form, &client_id, None)?;
        let scope = token.scope.clone();
        self.save(module_id, integration_id, &token)?;
        Ok(scope)
    }

    /// Send module code's request with the integration's access token.
    pub fn request(
        &self,
        module_id: &str,
        integration_id: &str,
        url: &str,
        method: &str,
        opts: Value,
    ) -> Result<Value, String> {
        let integration = self.integration(module_id, integration_id)?;
        let mut token = self.load(module_id, integration_id)?.ok_or_else(|| {
            format!("{integration_id} is not connected; connect it from the module's settings")
        })?;
        if token
            .expires_at_ms
            .is_some_and(|at| at - EXPIRY_MARGIN_MS <= (self.now_ms)())
        {
            token = self.refresh(module_id, &integration, token)?;
        }
        let response = self.send_with_token(module_id, &integration, &token, url, method, &opts)?;
        let unauthorized = response.get("status").and_then(Value::as_i64) == Some(401);
        if !unauthorized || token.refresh_token.is_none() {
            return Ok(response);
        }
        // The provider revoked or expired the token early: refresh once.
        let token = self.refresh(module_id, &integration, token)?;
        self.send_with_token(module_id, &integration, &token, url, method, &opts)
    }

    fn send_with_token(
        &self,
        module_id: &str,
        integration: &OAuthIntegration,
        token: &StoredOAuthToken,
        url: &str,
        method: &str,
        opts: &Value,
    ) -> Result<Value, String> {
        let mut opts = opts.as_object().cloned().unwrap_or_default();
        let mut headers = opts
            .get("headers")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        headers.retain(|name, _| !name.eq_ignore_ascii_case("authorization"));
        headers.insert(
            "Authorization".to_string(),
            Value::String(format!("Bearer {}", token.access_token)),
        );
        opts.insert("headers".to_string(), Value::Object(headers));
        let grants = host_grants(integration.hosts.iter().map(String::as_str));
        self.http.request(HttpRequest {
            module_id,
            grants: &grants,
            url,
            method,
            opts: Value::Object(opts),
        })
    }

    fn refresh(
        &self,
        module_id: &str,
        integration: &OAuthIntegration,
        token: StoredOAuthToken,
    ) -> Result<StoredOAuthToken, String> {
        let refresh_token = token.refresh_token.clone().ok_or_else(|| {
            format!(
                "{}: the token expired and there is no refresh token; connect it again",
                integration.id
            )
        })?;
        let settings = self.settings.list_by_module(module_id)?;
        let mut form = vec![
            ("grant_type", "refresh_token".to_string()),
            ("refresh_token", refresh_token.clone()),
            ("client_id", token.client_id.clone()),
        ];
        if let Some(secret) = client_secret(integration, &settings) {
            form.push(("client_secret", secret));
        }
        let refreshed = self.token_request(
            module_id,
            integration,
            &form,
            &token.client_id,
            Some(refresh_token),
        )?;
        self.save(module_id, &integration.id, &refreshed)?;
        Ok(refreshed)
    }

    /// POST `form` to the integration's token endpoint and read the token.
    /// `previous_refresh_token` is kept when a refresh answer omits one.
    fn token_request(
        &self,
        module_id: &str,
        integration: &OAuthIntegration,
        form: &[(&str, String)],
        client_id: &str,
        previous_refresh_token: Option<String>,
    ) -> Result<StoredOAuthToken, String> {
        let token_host = url::Url::parse(&integration.token_url)
            .ok()
            .and_then(|url| url.host_str().map(str::to_string))
            .ok_or_else(|| format!("{}: tokenUrl has no host", integration.id))?;
        let grants = host_grants([token_host.as_str()]);
        let body = form_urlencode(form);
        let response = self.http.request(HttpRequest {
            module_id,
            grants: &grants,
            url: &integration.token_url,
            method: "POST",
            opts: json!({
                "headers": { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
                "body": body,
            }),
        })?;
        let status = response.get("status").and_then(Value::as_i64).unwrap_or(0);
        let answer = response.get("body").cloned().unwrap_or(Value::Null);
        if !(200..300).contains(&status) {
            let error = answer
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("no error code");
            return Err(format!(
                "{}: the token endpoint answered {status} ({error})",
                integration.id
            ));
        }
        let access_token = answer
            .get("access_token")
            .and_then(Value::as_str)
            .filter(|t| !t.is_empty())
            .ok_or_else(|| {
                format!(
                    "{}: the token endpoint answered without an access_token",
                    integration.id
                )
            })?;
        Ok(StoredOAuthToken {
            access_token: access_token.to_string(),
            refresh_token: answer
                .get("refresh_token")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or(previous_refresh_token),
            expires_at_ms: answer
                .get("expires_in")
                .and_then(Value::as_i64)
                .map(|seconds| (self.now_ms)() + seconds * 1000),
            scope: answer
                .get("scope")
                .and_then(Value::as_str)
                .map(|scope| scope.split_whitespace().map(str::to_string).collect())
                .unwrap_or_else(|| integration.scopes.clone()),
            client_id: client_id.to_string(),
        })
    }

    fn integration(
        &self,
        module_id: &str,
        integration_id: &str,
    ) -> Result<OAuthIntegration, String> {
        self.registry
            .oauth_integration(module_id, integration_id)
            .ok_or_else(|| {
                format!("module {module_id} declares no OAuth integration {integration_id:?}")
            })
    }

    fn load(
        &self,
        module_id: &str,
        integration_id: &str,
    ) -> Result<Option<StoredOAuthToken>, String> {
        let settings = self.settings.list_by_module(module_id)?;
        let Some(raw) = setting_string(&settings, &token_setting_key(integration_id)) else {
            return Ok(None);
        };
        serde_json::from_str(&raw).map(Some).map_err(|e| {
            format!("{integration_id}: the stored token is unreadable ({e}); connect it again")
        })
    }

    fn save(
        &self,
        module_id: &str,
        integration_id: &str,
        token: &StoredOAuthToken,
    ) -> Result<(), String> {
        let raw = serde_json::to_string(token).map_err(|e| e.to_string())?;
        (self.write_sealed)(module_id, &token_setting_key(integration_id), &raw)
    }
}

/// Writes sealed settings through db-proxy at `db_proxy_url`; without one,
/// every write fails, so a connect reports that it could not keep the token.
pub fn sealed_setting_writer(db_proxy_url: String) -> Arc<SealedWrite> {
    Arc::new(move |module_id: &str, key: &str, value: &str| {
        if db_proxy_url.is_empty() {
            return Err(
                "databaseProxyUrl is not set; there is nowhere to keep the token".to_string(),
            );
        }
        tokio::runtime::Handle::current()
            .block_on(lib_module::db_proxy::set_secret_module_setting(
                &db_proxy_url,
                module_id,
                key,
                value,
            ))
            .map_err(|e| e.to_string())
    })
}

/// `ctx.oauth.request({ integration, url, method, headers?, query?, body? })`.
pub struct OAuthExtension {
    functions: Vec<HostFunction>,
}

impl OAuthExtension {
    pub fn new(service: Arc<OAuthService>) -> Self {
        let request = HostFunction::scoped("request", move |scope: &CallScope, args: Value| {
            let args = args.as_object().cloned().unwrap_or_default();
            let integration = string_arg(&args, "integration")?;
            let url = string_arg(&args, "url")?;
            let method = args
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or("GET")
                .to_string();
            let mut opts = Map::new();
            for key in ["headers", "query", "body"] {
                if let Some(value) = args.get(key) {
                    opts.insert(key.to_string(), value.clone());
                }
            }
            service
                .request(
                    scope.module_id(),
                    &integration,
                    &url,
                    &method,
                    Value::Object(opts),
                )
                .map_err(HostError::new)
        });
        Self {
            functions: vec![request],
        }
    }
}

impl HostExtension for OAuthExtension {
    fn namespace(&self) -> &str {
        "oauth"
    }

    fn functions(&self) -> &[HostFunction] {
        &self.functions
    }
}

fn string_arg(args: &Map<String, Value>, name: &str) -> Result<String, HostError> {
    args.get(name)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| HostError::new(format!("ctx.oauth.request: `{name}` is required")))
}

fn host_grants<'a>(hosts: impl IntoIterator<Item = &'a str>) -> HashSet<String> {
    hosts
        .into_iter()
        .map(|host| format!("{}{host}", lib_sandbox::net::NET_PERMISSION_PREFIX))
        .collect()
}

fn setting_string(settings: &HashMap<String, Value>, key: &str) -> Option<String> {
    settings
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn client_secret(
    integration: &OAuthIntegration,
    settings: &HashMap<String, Value>,
) -> Option<String> {
    integration
        .client_secret_setting
        .as_deref()
        .and_then(|setting| setting_string(settings, setting))
}

fn form_urlencode(form: &[(&str, String)]) -> String {
    url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(form.iter().map(|(k, v)| (*k, v.as_str())))
        .finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use lib_sandbox::{ModuleMetadata, ModuleState, RegisteredModule};
    use std::sync::Mutex;

    const NOW: i64 = 1_000_000_000_000;

    fn spotify() -> OAuthIntegration {
        OAuthIntegration {
            id: "spotify".to_string(),
            authorize_url: "https://accounts.spotify.com/authorize".to_string(),
            token_url: "https://accounts.spotify.com/api/token".to_string(),
            scopes: vec!["user-read-playback-state".to_string()],
            client_id_setting: "clientId".to_string(),
            client_secret_setting: Some("clientSecret".to_string()),
            hosts: vec!["api.spotify.com".to_string()],
        }
    }

    struct Settings(Mutex<HashMap<String, Value>>);

    impl SettingsClient for Settings {
        fn list_by_module(&self, _module_id: &str) -> Result<HashMap<String, Value>, String> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn set(&self, _module_id: &str, key: &str, value: &str) -> Result<(), String> {
            self.0
                .lock()
                .unwrap()
                .insert(key.to_string(), Value::String(value.to_string()));
            Ok(())
        }
    }

    /// Answers the token endpoint and the API, recording what it was sent.
    struct FakeProvider {
        sent: Mutex<Vec<(String, HashSet<String>, Value)>>,
        token_answers: Mutex<Vec<Value>>,
        api_statuses: Mutex<Vec<i64>>,
    }

    impl HttpClient for FakeProvider {
        fn request(&self, request: HttpRequest<'_>) -> Result<Value, String> {
            self.sent.lock().unwrap().push((
                request.url.to_string(),
                request.grants.clone(),
                request.opts.clone(),
            ));
            if request.url.contains("/api/token") {
                let body = self.token_answers.lock().unwrap().remove(0);
                return Ok(json!({ "status": 200, "body": body }));
            }
            let status = self.api_statuses.lock().unwrap().remove(0);
            Ok(json!({ "status": status, "body": { "ok": true } }))
        }
    }

    fn service(settings: Arc<Settings>, provider: Arc<FakeProvider>) -> OAuthService {
        let registry = Arc::new(ModuleRegistry::new());
        registry
            .register_module(
                "spotify".to_string(),
                RegisteredModule {
                    actions: Default::default(),
                    metadata: ModuleMetadata {
                        name: "spotify".to_string(),
                        version: "1.0.0".to_string(),
                        installed_at: 0,
                        updated_at: 0,
                    },
                    functions: HashMap::new(),
                    state: ModuleState::Active,
                    event_types: Default::default(),
                    permissions: Default::default(),
                    url_settings: Default::default(),
                    oauth: vec![spotify()],
                },
            )
            .unwrap();
        let sealed_settings = settings.clone();
        let write_sealed: Arc<SealedWrite> =
            Arc::new(move |module_id, key, value| sealed_settings.set(module_id, key, value));
        OAuthService::new(registry, settings, write_sealed, provider).with_clock(|| NOW)
    }

    fn provider(token_answers: Vec<Value>, api_statuses: Vec<i64>) -> Arc<FakeProvider> {
        Arc::new(FakeProvider {
            sent: Mutex::new(Vec::new()),
            token_answers: Mutex::new(token_answers),
            api_statuses: Mutex::new(api_statuses),
        })
    }

    fn settings(entries: &[(&str, &str)]) -> Arc<Settings> {
        Arc::new(Settings(Mutex::new(
            entries
                .iter()
                .map(|(k, v)| (k.to_string(), Value::String(v.to_string())))
                .collect(),
        )))
    }

    fn stored(settings: &Settings) -> StoredOAuthToken {
        let raw = settings
            .0
            .lock()
            .unwrap()
            .get("oauth.spotify")
            .and_then(Value::as_str)
            .unwrap()
            .to_string();
        serde_json::from_str(&raw).unwrap()
    }

    #[test]
    fn completing_exchanges_the_code_with_the_modules_client_and_keeps_the_token() {
        let settings = settings(&[("clientId", "module-app"), ("clientSecret", "shh")]);
        let provider = provider(
            vec![
                json!({ "access_token": "a1", "refresh_token": "r1", "expires_in": 3600, "scope": "user-read-playback-state" }),
            ],
            vec![],
        );
        let scope = service(settings.clone(), provider.clone())
            .complete(
                "spotify",
                "spotify",
                Authorization {
                    code: "the-code".to_string(),
                    code_verifier: "verifier".to_string(),
                    redirect_uri: "https://dash.convex.site/api/integrations/oauth/callback"
                        .to_string(),
                    client_id: None,
                    token_url: None,
                },
            )
            .unwrap();
        assert_eq!(scope, vec!["user-read-playback-state"]);
        assert_eq!(
            stored(&settings),
            StoredOAuthToken {
                access_token: "a1".to_string(),
                refresh_token: Some("r1".to_string()),
                expires_at_ms: Some(NOW + 3_600_000),
                scope: vec!["user-read-playback-state".to_string()],
                client_id: "module-app".to_string(),
            }
        );
        let sent = provider.sent.lock().unwrap();
        let (url, grants, opts) = &sent[0];
        assert_eq!(url, "https://accounts.spotify.com/api/token");
        assert_eq!(
            grants,
            &HashSet::from(["net:accounts.spotify.com".to_string()])
        );
        let body = opts["body"].as_str().unwrap();
        for part in [
            "grant_type=authorization_code",
            "code=the-code",
            "code_verifier=verifier",
            "client_id=module-app",
            "client_secret=shh",
        ] {
            assert!(body.contains(part), "{body} lacks {part}");
        }
    }

    #[test]
    fn a_dashboard_supplied_client_takes_the_place_of_the_modules() {
        let settings = settings(&[]);
        let provider = provider(vec![json!({ "access_token": "a1" })], vec![]);
        service(settings.clone(), provider.clone())
            .complete(
                "spotify",
                "spotify",
                Authorization {
                    code: "c".to_string(),
                    code_verifier: "v".to_string(),
                    redirect_uri: "https://x".to_string(),
                    client_id: Some("woofx3-app".to_string()),
                    token_url: Some("https://accounts.spotify.com/api/token".to_string()),
                },
            )
            .unwrap();
        assert_eq!(stored(&settings).client_id, "woofx3-app");
        assert!(
            !provider.sent.lock().unwrap()[0].2["body"]
                .as_str()
                .unwrap()
                .contains("client_secret")
        );
    }

    #[test]
    fn a_dashboard_supplied_client_is_refused_at_any_other_token_endpoint() {
        for token_url in [None, Some("https://attacker.example/token")] {
            let settings = settings(&[]);
            let provider = provider(vec![json!({ "access_token": "a1" })], vec![]);
            let err = service(settings.clone(), provider.clone())
                .complete(
                    "spotify",
                    "spotify",
                    Authorization {
                        code: "c".to_string(),
                        code_verifier: "v".to_string(),
                        redirect_uri: "https://x".to_string(),
                        client_id: Some("woofx3-app".to_string()),
                        token_url: token_url.map(str::to_string),
                    },
                )
                .unwrap_err();
            assert!(err.contains("tokenUrl"), "{err}");
            assert!(provider.sent.lock().unwrap().is_empty());
            assert!(!settings.0.lock().unwrap().contains_key("oauth.spotify"));
        }
    }

    #[test]
    fn a_request_carries_the_token_only_to_the_integrations_hosts() {
        let token = json!({ "accessToken": "a1", "refreshToken": "r1", "expiresAtMs": NOW + 3_600_000, "scope": [], "clientId": "app" });
        let settings = settings(&[("oauth.spotify", &token.to_string())]);
        let provider = provider(vec![], vec![200]);
        let response = service(settings, provider.clone())
            .request(
                "spotify",
                "spotify",
                "https://api.spotify.com/v1/me/player",
                "GET",
                json!({ "headers": { "authorization": "Bearer forged" } }),
            )
            .unwrap();
        assert_eq!(response["status"], 200);
        let sent = provider.sent.lock().unwrap();
        let (_, grants, opts) = &sent[0];
        assert_eq!(grants, &HashSet::from(["net:api.spotify.com".to_string()]));
        assert_eq!(opts["headers"], json!({ "Authorization": "Bearer a1" }));
    }

    #[test]
    fn an_expiring_token_is_refreshed_first_and_a_401_once_more() {
        let token = json!({ "accessToken": "old", "refreshToken": "r1", "expiresAtMs": NOW + 10_000, "scope": [], "clientId": "app" });
        let settings = settings(&[
            ("oauth.spotify", &token.to_string()),
            ("clientSecret", "shh"),
        ]);
        let provider = provider(
            vec![
                json!({ "access_token": "a2", "expires_in": 3600 }),
                json!({ "access_token": "a3", "refresh_token": "r2" }),
            ],
            vec![401, 200],
        );
        let response = service(settings.clone(), provider.clone())
            .request(
                "spotify",
                "spotify",
                "https://api.spotify.com/v1/me",
                "GET",
                Value::Null,
            )
            .unwrap();
        assert_eq!(response["status"], 200);
        let token = stored(&settings);
        assert_eq!(token.access_token, "a3");
        assert_eq!(token.refresh_token, Some("r2".to_string()));
        let sent = provider.sent.lock().unwrap();
        let urls: Vec<&str> = sent.iter().map(|(url, _, _)| url.as_str()).collect();
        assert_eq!(
            urls,
            vec![
                "https://accounts.spotify.com/api/token",
                "https://api.spotify.com/v1/me",
                "https://accounts.spotify.com/api/token",
                "https://api.spotify.com/v1/me",
            ]
        );
        assert!(
            sent[0].2["body"]
                .as_str()
                .unwrap()
                .contains("grant_type=refresh_token")
        );
    }

    #[test]
    fn an_unconnected_or_undeclared_integration_is_refused() {
        let svc = service(settings(&[]), provider(vec![], vec![]));
        assert!(
            svc.request(
                "spotify",
                "spotify",
                "https://api.spotify.com/",
                "GET",
                Value::Null
            )
            .unwrap_err()
            .contains("not connected")
        );
        assert!(
            svc.request(
                "spotify",
                "github",
                "https://api.github.com/",
                "GET",
                Value::Null
            )
            .unwrap_err()
            .contains("declares no OAuth integration")
        );
    }
}
