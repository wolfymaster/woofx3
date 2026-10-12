//! Test doubles that record what reaches a host client.

use super::{
    CompareAndSetOutcome, ResourceClient, ResourceInstance, ScheduleClient, setting_values_equal,
};
use serde_json::{Map, Value};
use std::sync::Mutex;

/// Records every schedule call, so a test can tell a call the binding refused
/// from one it passed on. Set `refusal` to make `at` fail the way the real
/// scheduler does for a request it will not take.
#[derive(Default)]
pub struct RecordingSchedule {
    pub calls: Mutex<Vec<String>>,
    pub params: Mutex<Vec<Value>>,
    pub refusal: Mutex<Option<String>>,
}

impl ScheduleClient for RecordingSchedule {
    fn at(
        &self,
        module_id: &str,
        deadline_id: &str,
        key: &str,
        when_ms: i64,
        params: Value,
    ) -> Result<(), String> {
        if let Some(refusal) = self.refusal.lock().unwrap().clone() {
            return Err(refusal);
        }
        self.calls
            .lock()
            .unwrap()
            .push(format!("at {module_id}/{deadline_id}/{key}@{when_ms}"));
        self.params.lock().unwrap().push(params);
        Ok(())
    }

    fn cancel(&self, module_id: &str, deadline_id: &str, key: &str) -> Result<(), String> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("cancel {module_id}/{deadline_id}/{key}"));
        Ok(())
    }

    fn cancel_key(&self, key: &str) {
        self.calls.lock().unwrap().push(format!("cancel_key {key}"));
    }
}

/// One resource instance whose settings a test can read back, written the way
/// the engine writes them: one key at a time, only while it holds what the
/// caller expects, compared by meaning, with an absent key matching null, and
/// only for the module that owns the instance.
pub struct InstanceSettings {
    pub canonical_id: String,
    pub settings: Mutex<Map<String, Value>>,
    /// Every key written, in order.
    pub writes: Mutex<Vec<String>>,
}

impl InstanceSettings {
    pub fn new(canonical_id: &str, settings: Value) -> Self {
        let Value::Object(settings) = settings else {
            panic!("instance settings must be an object");
        };
        Self {
            canonical_id: canonical_id.to_string(),
            settings: Mutex::new(settings),
            writes: Mutex::new(Vec::new()),
        }
    }

    fn owner(&self) -> &str {
        self.canonical_id.split(':').next().unwrap_or_default()
    }
}

impl ResourceClient for InstanceSettings {
    fn create(
        &self,
        _: &str,
        _: &str,
        _: &str,
        _: &str,
        _: &Value,
    ) -> Result<ResourceInstance, String> {
        Err("not used".into())
    }
    fn delete(&self, _: &str) -> Result<(), String> {
        Err("not used".into())
    }
    fn get(&self, canonical_id: &str) -> Result<Option<ResourceInstance>, String> {
        if canonical_id != self.canonical_id {
            return Ok(None);
        }
        let mut parts = canonical_id.splitn(3, ':');
        Ok(Some(ResourceInstance {
            canonical_id: canonical_id.to_string(),
            module_name: parts.next().unwrap_or_default().to_string(),
            kind: parts.next().unwrap_or_default().to_string(),
            instance_id: parts.next().unwrap_or_default().to_string(),
            display_name: String::new(),
            settings: Value::Object(self.settings.lock().unwrap().clone()),
        }))
    }
    fn list_by_kind(&self, _: &str) -> Result<Vec<ResourceInstance>, String> {
        Err("not used".into())
    }
    fn compare_and_set_setting(
        &self,
        owning_module_name: &str,
        canonical_id: &str,
        key: &str,
        expected: &Value,
        value: &Value,
    ) -> Result<CompareAndSetOutcome, String> {
        if canonical_id != self.canonical_id {
            return Err(format!("instance {canonical_id:?} not found"));
        }
        if owning_module_name != self.owner() {
            return Err(format!(
                "module {owning_module_name:?} does not own {canonical_id:?}"
            ));
        }
        let mut settings = self.settings.lock().unwrap();
        let matches = match settings.get(key) {
            None => expected.is_null(),
            Some(current) => setting_values_equal(current, expected),
        };
        if !matches {
            return Ok(CompareAndSetOutcome {
                swapped: false,
                current: settings.get(key).cloned(),
            });
        }
        settings.insert(key.to_string(), value.clone());
        self.writes.lock().unwrap().push(key.to_string());
        Ok(CompareAndSetOutcome {
            swapped: true,
            current: Some(value.clone()),
        })
    }
}
