//! HMAC-SHA256 signing shared by the engine's stateless signed tokens
//! (`upload_token`, `media_proxy`). Each token format keeps its own payload
//! and key; this is only the primitive they agree on.

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// The lowercase hex HMAC-SHA256 of `message` under `key`.
pub fn hmac_sha256_hex(key: &[u8], message: &[u8]) -> String {
    hmac_sha256(key, message)
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

/// The raw HMAC-SHA256 of `message` under `key`, for deriving a
/// purpose-specific key from a shared secret.
pub fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts keys of any length");
    mac.update(message);
    mac.finalize().into_bytes().into()
}

/// Length-independent comparison. `Mac::verify_slice` would do this too,
/// but it needs the raw signature bytes; comparing the hex form keeps the
/// token format the only thing a token module has to agree on.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_signature_matches_a_known_vector() {
        // RFC 4231 test case 2.
        assert_eq!(
            hmac_sha256_hex(b"Jefe", b"what do ya want for nothing?"),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
    }

    #[test]
    fn compares_by_content_and_length() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
        assert!(constant_time_eq(b"", b""));
    }
}
