//! The rule every engine secret is held to. Must match `ValidateSecret` in
//! `shared/common/golang/config/secret.go` and `validateSecret` in
//! `shared/common/typescript/runtime/secret.ts`.

use thiserror::Error;

use crate::camel_to_screaming_snake;

/// The shortest secret accepted, in bytes: the 256 bits an HMAC-SHA256 key
/// needs.
pub const MIN_SECRET_BYTES: usize = 32;

/// Values templates and examples have shipped in place of a secret, compared
/// case-insensitively. Each is public, so a service keyed with one is keyed
/// with a value anyone can read.
const PLACEHOLDER_SECRETS: &[&str] = &[
    "change_me",
    "changeme",
    "change-me",
    "secret",
    "password",
    "placeholder",
    "todo",
    "xxx",
    "test",
];

/// Why `validate_secret` refused a value. Each variant carries the config key
/// and its `WOOFX3_*` variable, never the value.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum SecretError {
    #[error("{name} ({env_var}) is not set: set it to a random value of at least {MIN_SECRET_BYTES} bytes")]
    Empty { name: String, env_var: String },
    #[error("{name} ({env_var}) is a well-known example value: set it to a random value of at least {MIN_SECRET_BYTES} bytes")]
    Placeholder { name: String, env_var: String },
    #[error("{name} ({env_var}) is shorter than {MIN_SECRET_BYTES} bytes: set it to a random value of at least {MIN_SECRET_BYTES} bytes")]
    TooShort { name: String, env_var: String },
}

/// Checks the secret held by the config key `name` (for example
/// `barkloaderKey`). The value is trimmed, then refused when it is empty, a
/// known placeholder, or shorter than `MIN_SECRET_BYTES`.
pub fn validate_secret(name: &str, value: &str) -> Result<(), SecretError> {
    let trimmed = value.trim();
    let name = name.to_string();
    let env_var = format!("WOOFX3_{}", camel_to_screaming_snake(&name));
    if trimmed.is_empty() {
        return Err(SecretError::Empty { name, env_var });
    }
    if PLACEHOLDER_SECRETS
        .iter()
        .any(|placeholder| trimmed.eq_ignore_ascii_case(placeholder))
    {
        return Err(SecretError::Placeholder { name, env_var });
    }
    if trimmed.len() < MIN_SECRET_BYTES {
        return Err(SecretError::TooShort { name, env_var });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum Want {
        Empty,
        Placeholder,
        TooShort,
        Accepted,
    }

    fn outcome(result: &Result<(), SecretError>) -> Want {
        match result {
            Ok(()) => Want::Accepted,
            Err(SecretError::Empty { .. }) => Want::Empty,
            Err(SecretError::Placeholder { .. }) => Want::Placeholder,
            Err(SecretError::TooShort { .. }) => Want::TooShort,
        }
    }

    #[test]
    fn test_validate_secret_table() {
        let short = "a".repeat(31);
        let short_padded = format!(" {} ", "a".repeat(31));
        let exact = "a".repeat(32);
        let hex = "0123456789abcdef".repeat(4);
        let multibyte = "é".repeat(16);
        let cases: Vec<(&str, &str, Want)> = vec![
            ("empty", "", Want::Empty),
            ("whitespace only", " \t\n", Want::Empty),
            ("CHANGE_ME", "CHANGE_ME", Want::Placeholder),
            ("changeme", "changeme", Want::Placeholder),
            ("change-me", "Change-Me", Want::Placeholder),
            ("padded placeholder", "  secret  ", Want::Placeholder),
            ("password", "PASSWORD", Want::Placeholder),
            ("placeholder", "placeholder", Want::Placeholder),
            ("todo", "TODO", Want::Placeholder),
            ("xxx", "xxx", Want::Placeholder),
            ("test", "test", Want::Placeholder),
            ("31 bytes", &short, Want::TooShort),
            ("31 bytes once trimmed", &short_padded, Want::TooShort),
            ("32 bytes", &exact, Want::Accepted),
            ("64 hex", &hex, Want::Accepted),
            ("multibyte counts bytes", &multibyte, Want::Accepted),
        ];
        for (label, value, want) in cases {
            let result = validate_secret("barkloaderKey", value);
            assert_eq!(outcome(&result), want, "{label}");
            if let Err(error) = result {
                let message = error.to_string();
                assert!(
                    message.contains("barkloaderKey (WOOFX3_BARKLOADER_KEY)"),
                    "{label}: {message}"
                );
                let trimmed = value.trim();
                assert!(
                    trimmed.is_empty() || !message.contains(trimmed),
                    "{label}: {message} echoes the value"
                );
            }
        }
    }
}
