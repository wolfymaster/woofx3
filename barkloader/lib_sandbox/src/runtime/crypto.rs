//! `ctx.crypto`: the signature primitives a webhook handler needs to verify
//! an inbound request. Pure computation over the arguments; nothing here
//! touches the host, so no call can reach the engine. Both runtime adapters
//! bind these functions after marshaling their arguments to strings.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use hmac::{Hmac, Mac};
use subtle::ConstantTimeEq;

/// How binary values (digests, keys, signatures) are written as strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    Hex,
    Base64,
}

impl Encoding {
    /// `None` is the documented default, hex.
    pub fn parse(raw: Option<&str>) -> Result<Self, String> {
        match raw.unwrap_or("hex") {
            "hex" => Ok(Self::Hex),
            "base64" => Ok(Self::Base64),
            other => Err(format!(
                "unknown encoding {other:?}; expected \"hex\" or \"base64\""
            )),
        }
    }

    fn encode(self, bytes: &[u8]) -> String {
        match self {
            Self::Hex => hex::encode(bytes),
            Self::Base64 => BASE64.encode(bytes),
        }
    }

    fn decode(self, text: &str) -> Option<Vec<u8>> {
        match self {
            Self::Hex => hex::decode(text).ok(),
            Self::Base64 => BASE64.decode(text).ok(),
        }
    }
}

/// HMAC of `data` under `key`, both taken as UTF-8.
pub fn hmac(algorithm: &str, key: &str, data: &str, encoding: Encoding) -> Result<String, String> {
    let digest = match algorithm {
        "sha1" => mac::<Hmac<sha1::Sha1>>(key, data),
        "sha256" => mac::<Hmac<sha2::Sha256>>(key, data),
        "sha512" => mac::<Hmac<sha2::Sha512>>(key, data),
        other => {
            return Err(format!(
                "unknown algorithm {other:?}; expected \"sha1\", \"sha256\" or \"sha512\""
            ));
        }
    };
    Ok(encoding.encode(&digest))
}

fn mac<M: Mac + hmac::digest::KeyInit>(key: &str, data: &str) -> Vec<u8> {
    let mut mac = <M as hmac::digest::KeyInit>::new_from_slice(key.as_bytes())
        .expect("HMAC accepts a key of any length");
    mac.update(data.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

/// Whether `signature` is a valid Ed25519 signature of `message` (UTF-8)
/// under `public_key`.
///
/// A malformed public key is the module author's mistake, so it is an error.
/// A malformed signature is whatever the caller sent, so it is simply not
/// valid: `false`, never an error.
pub fn verify_ed25519(
    public_key: &str,
    signature: &str,
    message: &str,
    encoding: Encoding,
) -> Result<bool, String> {
    let key_bytes: [u8; 32] = encoding
        .decode(public_key)
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(|| "Ed25519 public key is not 32 bytes in the given encoding".to_string())?;
    let key = VerifyingKey::from_bytes(&key_bytes)
        .map_err(|e| format!("invalid Ed25519 public key: {e}"))?;
    let Some(signature_bytes) = encoding
        .decode(signature)
        .and_then(|bytes| <[u8; 64]>::try_from(bytes).ok())
    else {
        return Ok(false);
    };
    Ok(key
        .verify(message.as_bytes(), &Signature::from_bytes(&signature_bytes))
        .is_ok())
}

/// Constant-time comparison, so a signature check does not reveal how many
/// leading bytes matched. Different lengths compare unequal.
pub fn timing_safe_equal(a: &str, b: &str) -> bool {
    a.as_bytes().ct_eq(b.as_bytes()).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    // RFC 4231 test case 2 (SHA-2) and RFC 2202 test case 2 (SHA-1).
    const KEY: &str = "Jefe";
    const DATA: &str = "what do ya want for nothing?";

    #[test]
    fn hmac_matches_published_vectors() {
        assert_eq!(
            hmac("sha1", KEY, DATA, Encoding::Hex).unwrap(),
            "effcdf6ae5eb2fa2d27416d5f184df9c259a7c79"
        );
        assert_eq!(
            hmac("sha256", KEY, DATA, Encoding::Hex).unwrap(),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
        assert_eq!(
            hmac("sha512", KEY, DATA, Encoding::Hex).unwrap(),
            "164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737"
        );
    }

    #[test]
    fn hmac_encodes_base64() {
        assert_eq!(
            hmac("sha256", KEY, DATA, Encoding::Base64).unwrap(),
            "W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM="
        );
    }

    #[test]
    fn hmac_rejects_an_unknown_algorithm() {
        let err = hmac("md5", KEY, DATA, Encoding::Hex).unwrap_err();
        assert!(err.contains("md5"), "{err}");
    }

    #[test]
    fn encoding_defaults_to_hex_and_rejects_unknown_names() {
        assert_eq!(Encoding::parse(None).unwrap(), Encoding::Hex);
        assert_eq!(Encoding::parse(Some("base64")).unwrap(), Encoding::Base64);
        assert!(Encoding::parse(Some("base32")).is_err());
    }

    // RFC 8032 section 7.1, test 2.
    const ED_PUBLIC_KEY: &str = "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c";
    const ED_MESSAGE: &str = "r";
    const ED_SIGNATURE: &str = "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00";

    #[test]
    fn ed25519_accepts_the_published_vector() {
        assert!(verify_ed25519(ED_PUBLIC_KEY, ED_SIGNATURE, ED_MESSAGE, Encoding::Hex).unwrap());
    }

    #[test]
    fn ed25519_rejects_a_tampered_signature_or_message() {
        let tampered = format!("{}01", &ED_SIGNATURE[..126]);
        assert!(!verify_ed25519(ED_PUBLIC_KEY, &tampered, ED_MESSAGE, Encoding::Hex).unwrap());
        assert!(!verify_ed25519(ED_PUBLIC_KEY, ED_SIGNATURE, "s", Encoding::Hex).unwrap());
    }

    #[test]
    fn ed25519_treats_a_malformed_signature_as_invalid() {
        assert!(!verify_ed25519(ED_PUBLIC_KEY, "not-hex", ED_MESSAGE, Encoding::Hex).unwrap());
        assert!(!verify_ed25519(ED_PUBLIC_KEY, "abcd", ED_MESSAGE, Encoding::Hex).unwrap());
    }

    #[test]
    fn ed25519_rejects_a_malformed_public_key() {
        assert!(verify_ed25519("abcd", ED_SIGNATURE, ED_MESSAGE, Encoding::Hex).is_err());
    }

    #[test]
    fn timing_safe_equal_compares_exactly() {
        assert!(timing_safe_equal("sha256=abc", "sha256=abc"));
        assert!(!timing_safe_equal("sha256=abc", "sha256=abd"));
        assert!(!timing_safe_equal("abc", "abcd"));
    }
}
