//! Settings a module's own code may not write, because their values decide
//! what the engine itself reaches: an origin `ctx.http` is granted, or where
//! the engine connects on the streamer's network. Only the streamer (or, for
//! a local endpoint, the companion that found the device) sets them.

use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, PoisonError, RwLock, RwLockReadGuard};

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

/// A module's protected settings as the registry holds them at this moment.
/// Every invocation holds a clone, and registering the module again swaps
/// the contents in place (`ModuleRegistry::register_module`), so a write is
/// checked against the protections in force when it is made, not when the
/// invocation started. Without that, code of a version being upgraded away
/// from could keep writing a key the new version protects, for as long as
/// an invocation that started before the upgrade lasts.
#[derive(Debug, Clone, Default)]
pub struct LiveProtectedSettings(Arc<RwLock<ProtectedSettings>>);

impl LiveProtectedSettings {
    pub fn new(settings: ProtectedSettings) -> Self {
        Self(Arc::new(RwLock::new(settings)))
    }

    /// A panic while the lock was held cannot leave the map half-updated
    /// (it is only ever replaced whole), so a poisoned lock is read through
    /// rather than turning every later setting write into a panic.
    fn read(&self) -> RwLockReadGuard<'_, ProtectedSettings> {
        self.0.read().unwrap_or_else(PoisonError::into_inner)
    }

    /// Why module code may not write `key` now; `None` when it may.
    pub fn get(&self, key: &str) -> Option<ProtectedReason> {
        self.read().get(key).cloned()
    }

    /// A copy of the protections in force now.
    pub fn snapshot(&self) -> ProtectedSettings {
        self.read().clone()
    }

    pub(crate) fn replace(&self, settings: ProtectedSettings) {
        *self.0.write().unwrap_or_else(PoisonError::into_inner) = settings;
    }
}

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

    #[test]
    fn test_live_protected_settings_clones_see_a_replace() {
        let live = LiveProtectedSettings::default();
        let held_by_invocation = live.clone();
        assert_eq!(held_by_invocation.get("obs_host"), None);

        live.replace(
            [(
                "obs_host".to_string(),
                ProtectedReason::LocalEndpointAddress {
                    endpoint_id: "obs".into(),
                },
            )]
            .into(),
        );

        assert_eq!(
            held_by_invocation.get("obs_host"),
            Some(ProtectedReason::LocalEndpointAddress {
                endpoint_id: "obs".into(),
            })
        );
    }
}
