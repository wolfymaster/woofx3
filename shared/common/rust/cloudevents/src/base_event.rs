use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use crate::session;
use crate::time::now_iso8601;

/// Must match `Event()` in `shared/common/typescript/cloudevents/BaseEvent.ts`.
/// Both publish onto the same bus, so a consumer sees one envelope shape
/// regardless of which language produced it.
pub const SPEC_VERSION: &str = "1.0.0";

/// A CloudEvents envelope. Field names and casing are the wire contract;
/// `type` and `sessionId` are renamed because the first is a Rust keyword and
/// the second is camelCase on the wire.
#[derive(Debug, Clone, Serialize)]
pub struct BaseEvent<T> {
    pub specversion: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub source: String,
    pub id: String,
    pub time: String,
    /// Extension attribute naming the platform an event came from ("twitch",
    /// ...). Provenance, not payload: `event_type` says what happened,
    /// `platform` says where.
    ///
    /// Distinct from a `platform` key inside `data`, which some events use to
    /// name a *destination*. Absent on events with no originating platform.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    /// Extension attribute naming the stream session the event happened
    /// during, defaulted from [`session::current_session_id`].
    ///
    /// Not a stable key: a session can be split or merged afterwards, so a
    /// reader aggregating events resolves this to a canonical session rather
    /// than grouping on it directly. Absent when the publishing process does
    /// not know a session. See docs/services/stream-sessions.md.
    #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub data: T,
}

impl<T> BaseEvent<T> {
    /// Build an envelope, defaulting `specversion`, `id`, `time` and the
    /// session. Publishers call this instead of writing a `json!` literal so
    /// every event carries the same attributes.
    pub fn new(event_type: impl Into<String>, source: impl Into<String>, data: T) -> Self {
        Self {
            specversion: SPEC_VERSION.to_string(),
            event_type: event_type.into(),
            source: source.into(),
            id: Uuid::new_v4().to_string(),
            time: now_iso8601(),
            platform: None,
            session_id: session::current_session_id(),
            data,
        }
    }

    pub fn with_platform(mut self, platform: impl Into<String>) -> Self {
        self.platform = Some(platform.into());
        self
    }

    /// Override the generated timestamp. For events that also carry an
    /// occurrence time inside `data`, so the two cannot disagree.
    pub fn with_time(mut self, time: impl Into<String>) -> Self {
        self.time = time.into();
        self
    }

    pub fn with_session_id(mut self, session_id: impl Into<String>) -> Self {
        self.session_id = Some(session_id.into());
        self
    }
}

impl<T: Serialize> BaseEvent<T> {
    /// Encode for a transport that takes `serde_json::Value`, which is the
    /// shape every `NatsPublisher` implementation accepts.
    pub fn to_value(&self) -> Result<Value, serde_json::Error> {
        serde_json::to_value(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::{clear_current_session_id, set_current_session_id, TEST_GUARD};
    use serde_json::json;

    fn sample(data: Value) -> BaseEvent<Value> {
        BaseEvent::new("module.storage.changed", "barkloader", data)
    }

    #[test]
    fn stamps_the_current_session() {
        let _guard = TEST_GUARD.lock().unwrap_or_else(|p| p.into_inner());
        set_current_session_id("session-1");

        let event = sample(json!({}));

        assert_eq!(event.session_id.as_deref(), Some("session-1"));
        assert_eq!(event.to_value().unwrap()["sessionId"], "session-1");
    }

    #[test]
    fn omits_the_attribute_when_no_session_is_known() {
        let _guard = TEST_GUARD.lock().unwrap_or_else(|p| p.into_inner());
        clear_current_session_id();

        let encoded = sample(json!({})).to_value().unwrap();

        // Absent rather than null: a consumer checking for the attribute must
        // not see one it then has to special-case.
        assert!(encoded.get("sessionId").is_none());
    }

    #[test]
    fn an_explicit_session_wins_over_the_ambient_one() {
        let _guard = TEST_GUARD.lock().unwrap_or_else(|p| p.into_inner());
        set_current_session_id("ambient");

        let event = sample(json!({})).with_session_id("explicit");

        assert_eq!(event.session_id.as_deref(), Some("explicit"));
    }

    #[test]
    fn omits_platform_unless_it_is_set() {
        let _guard = TEST_GUARD.lock().unwrap_or_else(|p| p.into_inner());
        clear_current_session_id();

        let encoded = sample(json!({})).to_value().unwrap();
        assert!(encoded.get("platform").is_none());

        let encoded = sample(json!({}))
            .with_platform("twitch")
            .to_value()
            .unwrap();
        assert_eq!(encoded["platform"], "twitch");
    }

    #[test]
    fn encodes_the_envelope_consumers_parse() {
        let _guard = TEST_GUARD.lock().unwrap_or_else(|p| p.into_inner());
        clear_current_session_id();

        let encoded = sample(json!({ "key": "count" })).to_value().unwrap();

        assert_eq!(encoded["specversion"], "1.0.0");
        assert_eq!(encoded["type"], "module.storage.changed");
        assert_eq!(encoded["source"], "barkloader");
        assert_eq!(encoded["data"]["key"], "count");
        assert!(encoded["id"].as_str().is_some_and(|id| !id.is_empty()));
        assert!(encoded["time"].as_str().is_some_and(|t| t.ends_with('Z')));
    }

    #[test]
    fn each_event_gets_its_own_id() {
        let _guard = TEST_GUARD.lock().unwrap_or_else(|p| p.into_inner());

        assert_ne!(sample(json!({})).id, sample(json!({})).id);
    }

    #[test]
    fn with_time_overrides_the_generated_timestamp() {
        let _guard = TEST_GUARD.lock().unwrap_or_else(|p| p.into_inner());

        let event = sample(json!({})).with_time("2026-01-01T00:00:00.000Z");

        assert_eq!(event.time, "2026-01-01T00:00:00.000Z");
    }
}
