//! Short-lived signed grants to write one object into the repository.
//!
//! S3-compatible backends sign their own upload URLs; local disk cannot
//! (see `lib_repository::UploadEndpoint`). This module is the local
//! equivalent: a stateless, HMAC-signed capability naming exactly one
//! repository key, one content type, and one expiry.
//!
//! Stateless on purpose. A server-side table of outstanding tokens would
//! have to survive restarts, be swept for expiry, and be shared if
//! barkloader were ever run as more than one process. The signature
//! carries all of that instead: the token is only as good as the
//! secret, and it stops being good on its own schedule.

use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// What a verified token authorizes. Every field is signed, so none of
/// it can be re-pointed by the client after issuance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UploadGrant {
    /// Repository key the bytes may be written to, and nothing else.
    pub key: String,
    /// Content type the client declared. `None` means the client did
    /// not declare one; the grant still pins the key.
    pub content_type: Option<String>,
    /// Unix seconds. Absolute rather than a duration so a token cannot
    /// be replayed indefinitely by withholding it.
    pub expires_at: i64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum TokenError {
    /// Not two dot-separated parts, or not decodable.
    Malformed,
    /// Decoded fine but the signature does not match the secret.
    BadSignature,
    /// Signature is good; the grant has simply run out.
    Expired,
}

impl std::fmt::Display for TokenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TokenError::Malformed => write!(f, "malformed upload token"),
            TokenError::BadSignature => write!(f, "upload token signature mismatch"),
            TokenError::Expired => write!(f, "upload token expired"),
        }
    }
}

/// Mint a token for `key`, valid for `ttl` from `now`.
pub fn issue(
    secret: &str,
    key: &str,
    content_type: Option<&str>,
    ttl: Duration,
    now: i64,
) -> Result<(String, UploadGrant), anyhow::Error> {
    if secret.is_empty() {
        anyhow::bail!("upload token secret must not be empty");
    }
    if key.is_empty() {
        anyhow::bail!("upload token key must not be empty");
    }

    let grant = UploadGrant {
        key: key.to_string(),
        content_type: content_type.map(|c| c.to_string()),
        expires_at: now.saturating_add(ttl.as_secs() as i64),
    };
    let payload = serde_json::to_vec(&grant)?;
    let encoded = URL_SAFE_NO_PAD.encode(&payload);
    let signature = sign(secret, encoded.as_bytes());
    Ok((format!("{}.{}", encoded, signature), grant))
}

/// Verify a token and return what it authorizes.
///
/// Order is load-bearing: the signature is checked before the expiry, so
/// an unsigned or forged token never reports "expired" -- which would
/// tell an attacker their forgery decoded correctly.
pub fn verify(secret: &str, token: &str, now: i64) -> Result<UploadGrant, TokenError> {
    let Some((encoded, signature)) = token.split_once('.') else {
        return Err(TokenError::Malformed);
    };
    if encoded.is_empty() || signature.is_empty() {
        return Err(TokenError::Malformed);
    }

    let expected = sign(secret, encoded.as_bytes());
    if !constant_time_eq(expected.as_bytes(), signature.as_bytes()) {
        return Err(TokenError::BadSignature);
    }

    let Ok(payload) = URL_SAFE_NO_PAD.decode(encoded) else {
        return Err(TokenError::Malformed);
    };
    let Ok(grant) = serde_json::from_slice::<UploadGrant>(&payload) else {
        return Err(TokenError::Malformed);
    };
    if grant.expires_at <= now {
        return Err(TokenError::Expired);
    }
    Ok(grant)
}

fn sign(secret: &str, message: &[u8]) -> String {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts keys of any length");
    mac.update(message);
    let bytes = mac.finalize().into_bytes();
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Length-independent comparison. `Mac::verify_slice` would do this too,
/// but it needs the raw signature bytes; comparing the hex form keeps
/// the token format the only thing this module has to agree on.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "test-barkloader-key";
    const NOW: i64 = 1_700_000_000;

    #[test]
    fn issued_token_round_trips() {
        let (token, issued) = issue(
            SECRET,
            "user/app-1/res-1/photo.png",
            Some("image/png"),
            Duration::from_secs(300),
            NOW,
        )
        .expect("issue");

        let verified = verify(SECRET, &token, NOW).expect("verify");
        assert_eq!(verified, issued);
        assert_eq!(verified.key, "user/app-1/res-1/photo.png");
        assert_eq!(verified.content_type.as_deref(), Some("image/png"));
        assert_eq!(verified.expires_at, NOW + 300);
    }

    #[test]
    fn token_without_content_type_round_trips() {
        let (token, _) = issue(
            SECRET,
            "user/app-1/res-1/blob.bin",
            None,
            Duration::from_secs(60),
            NOW,
        )
        .expect("issue");
        let verified = verify(SECRET, &token, NOW).expect("verify");
        assert_eq!(verified.content_type, None);
    }

    #[test]
    fn expired_token_is_rejected() {
        let (token, _) = issue(
            SECRET,
            "user/app-1/res-1/photo.png",
            Some("image/png"),
            Duration::from_secs(300),
            NOW,
        )
        .expect("issue");

        assert!(
            verify(SECRET, &token, NOW + 299).is_ok(),
            "must still be valid one second before expiry"
        );
        assert_eq!(verify(SECRET, &token, NOW + 300), Err(TokenError::Expired));
        assert_eq!(
            verify(SECRET, &token, NOW + 10_000),
            Err(TokenError::Expired)
        );
    }

    #[test]
    fn token_signed_with_another_secret_is_rejected() {
        let (token, _) = issue(
            SECRET,
            "user/app-1/res-1/photo.png",
            Some("image/png"),
            Duration::from_secs(300),
            NOW,
        )
        .expect("issue");
        assert_eq!(
            verify("a-different-secret", &token, NOW),
            Err(TokenError::BadSignature)
        );
    }

    #[test]
    fn tampering_with_the_key_is_rejected() {
        let (token, _) = issue(
            SECRET,
            "user/app-1/res-1/photo.png",
            Some("image/png"),
            Duration::from_secs(300),
            NOW,
        )
        .expect("issue");
        let (_, signature) = token.split_once('.').expect("token shape");

        // Re-point the grant at another application's key space and
        // keep the original signature.
        let forged_payload = serde_json::to_vec(&UploadGrant {
            key: "user/app-2/res-1/photo.png".to_string(),
            content_type: Some("image/png".to_string()),
            expires_at: NOW + 300,
        })
        .expect("encode");
        let forged = format!("{}.{}", URL_SAFE_NO_PAD.encode(forged_payload), signature);

        assert_eq!(verify(SECRET, &forged, NOW), Err(TokenError::BadSignature));
    }

    #[test]
    fn malformed_tokens_are_rejected_before_expiry_is_considered() {
        assert_eq!(
            verify(SECRET, "no-dot-here", NOW),
            Err(TokenError::Malformed)
        );
        assert_eq!(verify(SECRET, ".onlysig", NOW), Err(TokenError::Malformed));
        assert_eq!(
            verify(SECRET, "onlypayload.", NOW),
            Err(TokenError::Malformed)
        );
        // Well-formed shape, garbage payload: the signature check runs
        // first, so this reports a signature mismatch rather than
        // confirming the payload decoded.
        assert_eq!(
            verify(SECRET, "!!!notbase64!!!.deadbeef", NOW),
            Err(TokenError::BadSignature)
        );
    }

    #[test]
    fn empty_secret_or_key_fails_fast() {
        assert!(issue("", "user/a/b/c.png", None, Duration::from_secs(60), NOW).is_err());
        assert!(issue(SECRET, "", None, Duration::from_secs(60), NOW).is_err());
    }
}
