//! Settings a module's own code may not write, because their values decide
//! what the engine itself reaches: an origin `ctx.http` is granted, or where
//! the engine connects on the streamer's network. Only the streamer (or, for
//! a local endpoint, the companion that found the device) sets them.

use std::collections::HashMap;
use std::fmt;

/// Why module code may not write a setting. Its `Display` completes a
/// sentence that starts with the setting's key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtectedReason {
    /// A `url` setting: its value's origin is granted to `ctx.http`
    /// (`crate::net`).
    Url,
    /// The host or port setting of a `local[]` endpoint.
    LocalEndpointAddress { endpoint_id: String },
    /// The password setting of a `local[]` endpoint.
    LocalEndpointSecret { endpoint_id: String },
}

impl fmt::Display for ProtectedReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProtectedReason::Url => write!(f, "is a url setting, which only the streamer sets"),
            ProtectedReason::LocalEndpointAddress { endpoint_id } => write!(
                f,
                "decides where the engine connects for endpoint {endpoint_id}; only the streamer or the companion may set it"
            ),
            ProtectedReason::LocalEndpointSecret { endpoint_id } => write!(
                f,
                "is the password for endpoint {endpoint_id}; only the streamer or the companion may set it"
            ),
        }
    }
}

/// Setting key to the reason module code may not write it.
pub type ProtectedSettings = HashMap<String, ProtectedReason>;

/// How the engine talks to a local endpoint. Mirrors the manifest's closed
/// `local[].protocol` list (`lib_module::local_endpoint::LocalProtocol`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalEndpointProtocol {
    Websocket,
    Http,
}

/// A `local[]` endpoint a registered module declares: something on the
/// streamer's network the engine reaches on the module's behalf. Its address
/// and password settings are in the module's `ProtectedSettings`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegisteredLocalEndpoint {
    pub id: String,
    pub protocol: LocalEndpointProtocol,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_protected_reason_display_names_the_endpoint() {
        let cases = [
            (
                ProtectedReason::Url,
                "is a url setting, which only the streamer sets",
            ),
            (
                ProtectedReason::LocalEndpointAddress {
                    endpoint_id: "obs".into(),
                },
                "decides where the engine connects for endpoint obs; only the streamer or the companion may set it",
            ),
            (
                ProtectedReason::LocalEndpointSecret {
                    endpoint_id: "obs".into(),
                },
                "is the password for endpoint obs; only the streamer or the companion may set it",
            ),
        ];
        for (reason, expected) in cases {
            assert_eq!(reason.to_string(), expected);
        }
    }
}
