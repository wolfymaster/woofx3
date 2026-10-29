//! Which resource instances a module's code may touch through `ctx.resources`.
//!
//! One policy for every call that names an instance (`get`, `delete`, `list`,
//! `run`, `compareAndSetSetting`), so the calls cannot drift apart:
//!
//! - A module **writes** (deletes, changes settings of) only the instances it
//!   owns: the first segment of the canonical id, `{owner}:{kind}:{instance}`,
//!   is the invoking module.
//! - A module **reads** (gets, lists, runs actions on) the instances it owns,
//!   and the ones the streamer linked to it: the value of one of its
//!   resource-link settings (`resource_ref` in the manifest). Module code
//!   cannot write those settings (`host_bindings::set_module_setting`), so a
//!   link is set either by the streamer or at install time by the module's
//!   manifest `create` on a `resource_ref` setting, which may reuse an
//!   existing instance.
//!
//! The caller is the module id the host bound to the invocation, never a value
//! module code supplies.

use crate::host::{ResourceInstance, SettingsClient};
use std::collections::HashSet;

/// The segments of a canonical instance id, `{owner}:{kind}:{instance}`.
pub struct InstanceId<'a> {
    pub owner: &'a str,
    pub kind: &'a str,
    pub instance: &'a str,
}

/// Splits a canonical instance id; `None` when it does not have three
/// non-empty segments.
pub fn parse_instance_id(canonical_id: &str) -> Option<InstanceId<'_>> {
    let mut parts = canonical_id.splitn(3, ':');
    let owner = parts.next().filter(|s| !s.is_empty())?;
    let kind = parts.next().filter(|s| !s.is_empty())?;
    let instance = parts.next().filter(|s| !s.is_empty())?;
    Some(InstanceId {
        owner,
        kind,
        instance,
    })
}

/// The owner segment of a canonical instance id.
pub fn instance_owner(canonical_id: &str) -> Option<&str> {
    parse_instance_id(canonical_id).map(|id| id.owner)
}

/// The access one invoking module has to resource instances.
pub struct ResourceAccess<'a> {
    caller: &'a str,
    link_settings: &'a HashSet<String>,
    settings: &'a dyn SettingsClient,
}

impl<'a> ResourceAccess<'a> {
    /// `caller` is the invoking module's id (empty for a builtin invocation,
    /// which owns nothing); `link_settings` the ids of its resource-link
    /// settings, whose current values `settings` answers.
    pub fn new(
        caller: &'a str,
        link_settings: &'a HashSet<String>,
        settings: &'a dyn SettingsClient,
    ) -> Self {
        Self {
            caller,
            link_settings,
            settings,
        }
    }

    /// Whether `caller` owns `canonical_id`, and so may delete it or write its
    /// settings. Needs no settings, so it takes no `ResourceAccess`.
    pub fn may_write(caller: &str, canonical_id: &str) -> bool {
        !caller.is_empty() && instance_owner(canonical_id) == Some(caller)
    }

    /// Whether the caller owns `canonical_id` or the streamer linked it to the
    /// caller. Reads the caller's settings only when it does not own the
    /// instance; a failed read is an error, never a refusal or a grant.
    pub fn may_read(&self, canonical_id: &str) -> Result<bool, String> {
        if Self::may_write(self.caller, canonical_id) {
            return Ok(true);
        }
        Ok(self.linked()?.contains(canonical_id))
    }

    /// Keeps the instances the caller may read, reading its settings at most
    /// once.
    pub fn retain_readable(&self, instances: &mut Vec<ResourceInstance>) -> Result<(), String> {
        if instances
            .iter()
            .all(|i| Self::may_write(self.caller, &i.canonical_id))
        {
            return Ok(());
        }
        let linked = self.linked()?;
        instances.retain(|i| {
            Self::may_write(self.caller, &i.canonical_id) || linked.contains(&i.canonical_id)
        });
        Ok(())
    }

    /// The canonical ids the streamer linked to the caller: the values of its
    /// resource-link settings. A value under any other key is not a link,
    /// whatever it holds.
    fn linked(&self) -> Result<HashSet<String>, String> {
        if self.caller.is_empty() || self.link_settings.is_empty() {
            return Ok(HashSet::new());
        }
        let values = self
            .settings
            .list_by_module(self.caller)
            .map_err(|e| format!("read the settings that link resources: {e}"))?;
        Ok(self
            .link_settings
            .iter()
            .filter_map(|key| values.get(key).and_then(|v| v.as_str()))
            .filter(|id| !id.is_empty())
            .map(str::to_string)
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// The caller's settings, counting how often they are read.
    struct Settings {
        values: HashMap<String, Value>,
        reads: AtomicU32,
        fail: bool,
    }

    impl Settings {
        fn new(values: Value, fail: bool) -> Self {
            let Value::Object(map) = values else {
                panic!("settings are an object");
            };
            Self {
                values: map.into_iter().collect(),
                reads: Default::default(),
                fail,
            }
        }

        fn reads(&self) -> u32 {
            self.reads.load(Ordering::SeqCst)
        }
    }

    impl SettingsClient for Settings {
        fn list_by_module(&self, module_id: &str) -> Result<HashMap<String, Value>, String> {
            assert_eq!(module_id, "consumer", "only the caller's settings are read");
            self.reads.fetch_add(1, Ordering::SeqCst);
            if self.fail {
                return Err("db-proxy is down".to_string());
            }
            Ok(self.values.clone())
        }
        fn set(&self, _: &str, _: &str, _: &str) -> Result<(), String> {
            Ok(())
        }
    }

    fn links(keys: &[&str]) -> HashSet<String> {
        keys.iter().map(|k| k.to_string()).collect()
    }

    fn instance(canonical_id: &str) -> ResourceInstance {
        ResourceInstance {
            canonical_id: canonical_id.to_string(),
            module_name: canonical_id.split(':').next().unwrap().to_string(),
            kind: "timer".to_string(),
            instance_id: "x".to_string(),
            display_name: "x".to_string(),
            settings: json!({}),
        }
    }

    #[test]
    fn test_instance_owner_needs_three_segments() {
        let cases = [
            ("woofx3:timer:break", Some("woofx3")),
            ("woofx3:timer:a:b", Some("woofx3")),
            ("woofx3:timer", None),
            ("woofx3", None),
            (":timer:break", None),
            ("woofx3::break", None),
            ("woofx3:timer:", None),
            ("", None),
        ];
        for (id, owner) in cases {
            assert_eq!(instance_owner(id), owner, "{id:?}");
        }
    }

    #[test]
    fn test_may_write_only_the_callers_own_instances() {
        let settings = Settings::new(json!({ "timer": "provider:timer:main" }), false);
        let keys = links(&["timer"]);
        let access = ResourceAccess::new("consumer", &keys, &settings);
        assert!(access.may_read("provider:timer:main").unwrap());
        assert!(
            !ResourceAccess::may_write("consumer", "provider:timer:main"),
            "a link is not ownership"
        );
        assert!(ResourceAccess::may_write("consumer", "consumer:timer:mine"));
        assert!(!ResourceAccess::may_write(
            "consumer",
            "consumerx:timer:mine"
        ));
        assert!(!ResourceAccess::may_write("consumer", "consumer"));
        assert!(!ResourceAccess::may_write("", ":timer:x"));
    }

    #[test]
    fn test_may_read_owned_or_linked_through_a_link_setting_only() {
        let settings = Settings::new(
            json!({
                "timer": "provider:timer:main",
                "note": "provider:timer:other",
            }),
            false,
        );
        let keys = links(&["timer"]);
        let access = ResourceAccess::new("consumer", &keys, &settings);
        assert!(access.may_read("consumer:timer:mine").unwrap());
        assert_eq!(
            settings.reads(),
            0,
            "an owned instance needs no settings read"
        );
        assert!(access.may_read("provider:timer:main").unwrap());
        assert!(
            !access.may_read("provider:timer:other").unwrap(),
            "a value under a key that is not a link setting is no link"
        );
    }

    #[test]
    fn test_may_read_fails_when_the_settings_cannot_be_read() {
        let settings = Settings::new(json!({}), true);
        let keys = links(&["timer"]);
        let access = ResourceAccess::new("consumer", &keys, &settings);
        let err = access.may_read("provider:timer:main").unwrap_err();
        assert!(err.contains("db-proxy is down"), "{err}");
    }

    #[test]
    fn test_retain_readable_reads_settings_once() {
        let settings = Settings::new(json!({ "timer": "provider:timer:main" }), false);
        let keys = links(&["timer"]);
        let access = ResourceAccess::new("consumer", &keys, &settings);
        let mut items = vec![
            instance("consumer:timer:mine"),
            instance("provider:timer:main"),
            instance("provider:timer:other"),
            instance("elsewhere:timer:x"),
        ];
        access.retain_readable(&mut items).unwrap();
        let ids: Vec<_> = items.iter().map(|i| i.canonical_id.as_str()).collect();
        assert_eq!(ids, ["consumer:timer:mine", "provider:timer:main"]);
        assert_eq!(settings.reads(), 1);
    }
}
