//! A module's local endpoints: things on the streamer's own network the
//! module needs to reach (OBS, lights, VTube Studio). A module states facts
//! only, namely which of its settings hold the address and how the device can
//! be found. The platform decides the route (direct or through the companion).
//! Must match `LocalEndpoint` in woofx3-ui convex/lib/localEndpoints.ts.

use serde::{Deserialize, Serialize};

/// Closed on purpose: an endpoint whose protocol the platform cannot carry
/// must fail the install rather than install and never connect.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalProtocol {
    Websocket,
    Http,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalDiscover {
    /// A DNS-SD service type such as `_elg._tcp`, browsed by the companion.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mdns: Option<String>,
    /// A discoverer built into the companion. Not checked against a list:
    /// which ones exist depends on the companion's version, not the engine's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub known: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalEndpoint {
    pub id: String,
    pub name: String,
    pub protocol: LocalProtocol,
    pub host_setting: String,
    pub port_setting: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password_setting: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub discover: Option<LocalDiscover>,
}
