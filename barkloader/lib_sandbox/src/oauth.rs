//! OAuth integrations a module declares, for `ctx.oauth`.
//!
//! Module code is end-user code, so it never holds an OAuth client secret or
//! a user's token. The module declares the integration in its manifest; the
//! engine performs the code exchange, keeps the tokens, refreshes them, and
//! attaches them to the requests module code asks it to make
//! (`ctx.oauth.request`), only to the hosts the integration declares.
//!
//! Tokens are kept in the module's own settings, under a reserved key per
//! integration (`token_setting_key`), written as `secret` so db-proxy seals
//! them at rest and the settings API never returns them. The key is reserved
//! everywhere module code or a manifest could reach it: a manifest setting
//! may not take it, `ctx.module.setSetting` refuses it, and
//! `ctx.module.settings` leaves it out (`is_reserved_setting_key`).

use serde::{Deserialize, Serialize};

/// Prefix of the setting keys `ctx.oauth` keeps tokens under.
const TOKEN_SETTING_PREFIX: &str = "oauth.";

/// An OAuth provider a module's code may call through `ctx.oauth`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OAuthIntegration {
    /// Names the integration to `ctx.oauth.request` and to the dashboard's
    /// connect button (`action: { kind: "integration", integration: id }`).
    pub id: String,
    /// Where the dashboard sends the streamer to approve access.
    pub authorize_url: String,
    /// Where the engine exchanges the authorization code and refreshes.
    pub token_url: String,
    #[serde(default)]
    pub scopes: Vec<String>,
    /// The id of the module setting holding the OAuth client id.
    pub client_id_setting: String,
    /// The id of the `secret` module setting holding the client secret, for a
    /// provider that needs one. Without it the client is public and relies on
    /// PKCE, which the flow always uses.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_secret_setting: Option<String>,
    /// The hosts `ctx.oauth.request` may send this integration's token to:
    /// `https` on port 443, as for a `net:` permission.
    pub hosts: Vec<String>,
}

/// The module setting key a connected integration's tokens are kept under.
pub fn token_setting_key(integration_id: &str) -> String {
    format!("{TOKEN_SETTING_PREFIX}{integration_id}")
}

/// Whether `key` is one only the engine writes and module code never sees.
pub fn is_reserved_setting_key(key: &str) -> bool {
    key.starts_with(TOKEN_SETTING_PREFIX)
}

/// A connected integration's tokens, as stored under `token_setting_key`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredOAuthToken {
    pub access_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    /// Milliseconds since the epoch; absent when the provider gave no expiry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at_ms: Option<i64>,
    #[serde(default)]
    pub scope: Vec<String>,
    /// The client id the token was issued to; a refresh must present the same.
    pub client_id: String,
    /// The token endpoint and API hosts the integration declared when the
    /// token was issued. Module code is end-user code and its manifest can
    /// change with an update, so the token is used only while the declaration
    /// still fits them (`fits`): otherwise an update could send the refresh
    /// token, and the client id it was issued to, to a new `tokenUrl`, or the
    /// access token to a new host. Empty on a token stored before they were
    /// recorded, which therefore fits nothing.
    #[serde(default)]
    pub token_url: String,
    #[serde(default)]
    pub hosts: Vec<String>,
}

impl StoredOAuthToken {
    /// Whether `integration`, as installed now, may still use this token: the
    /// same token endpoint, and no host the token was not issued for.
    pub fn fits(&self, integration: &OAuthIntegration) -> bool {
        !self.token_url.is_empty()
            && integration.token_url == self.token_url
            && integration
                .hosts
                .iter()
                .all(|host| self.hosts.contains(host))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_keys_are_reserved_and_other_keys_are_not() {
        assert_eq!(token_setting_key("spotify"), "oauth.spotify");
        assert!(is_reserved_setting_key("oauth.spotify"));
        assert!(!is_reserved_setting_key("clientId"));
        assert!(!is_reserved_setting_key("oauthClientId"));
    }

    fn integration() -> OAuthIntegration {
        OAuthIntegration {
            id: "spotify".to_string(),
            authorize_url: "https://accounts.spotify.com/authorize".to_string(),
            token_url: "https://accounts.spotify.com/api/token".to_string(),
            scopes: vec![],
            client_id_setting: "clientId".to_string(),
            client_secret_setting: None,
            hosts: vec!["api.spotify.com".to_string()],
        }
    }

    fn token() -> StoredOAuthToken {
        StoredOAuthToken {
            access_token: "a".to_string(),
            refresh_token: Some("r".to_string()),
            expires_at_ms: None,
            scope: vec![],
            client_id: "app".to_string(),
            token_url: "https://accounts.spotify.com/api/token".to_string(),
            hosts: vec![
                "api.spotify.com".to_string(),
                "accounts.spotify.com".to_string(),
            ],
        }
    }

    #[test]
    fn a_token_fits_its_declaration_and_any_narrower_one() {
        assert!(token().fits(&integration()));
        assert!(token().fits(&OAuthIntegration {
            hosts: vec![],
            ..integration()
        }));
    }

    #[test]
    fn a_token_fits_no_declaration_that_moved_its_endpoint_or_added_a_host() {
        assert!(!token().fits(&OAuthIntegration {
            token_url: "https://attacker.example/token".to_string(),
            ..integration()
        }));
        assert!(!token().fits(&OAuthIntegration {
            hosts: vec![
                "api.spotify.com".to_string(),
                "attacker.example".to_string()
            ],
            ..integration()
        }));
        let unbound: StoredOAuthToken = serde_json::from_value(serde_json::json!({
            "accessToken": "a", "scope": [], "clientId": "app"
        }))
        .unwrap();
        assert!(!unbound.fits(&integration()));
    }

    #[test]
    fn an_integration_reads_the_manifest_shape() {
        let integration: OAuthIntegration = serde_json::from_value(serde_json::json!({
            "id": "spotify",
            "authorizeUrl": "https://accounts.spotify.com/authorize",
            "tokenUrl": "https://accounts.spotify.com/api/token",
            "scopes": ["user-read-playback-state"],
            "clientIdSetting": "clientId",
            "hosts": ["api.spotify.com"]
        }))
        .unwrap();
        assert_eq!(integration.client_secret_setting, None);
        assert_eq!(integration.hosts, vec!["api.spotify.com"]);
    }
}
