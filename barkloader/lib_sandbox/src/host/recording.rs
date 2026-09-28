//! Test doubles that record what reaches a host client.

use super::ScheduleClient;
use serde_json::Value;
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
