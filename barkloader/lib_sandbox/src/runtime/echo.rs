use crate::error::Error;
use crate::host::InvocationContext;
use crate::runtime::RuntimeAdapter;
use serde_json::{json, Value};

pub struct EchoAdapter {}

impl EchoAdapter {
    pub fn new() -> Self {
        Self {}
    }
}

impl RuntimeAdapter for EchoAdapter {
    fn execute(
        &self,
        code: &str,
        entry_point: &str,
        invocation: &InvocationContext,
    ) -> Result<Value, Error> {
        Ok(json!({
            "code": code,
            "entry_point": entry_point,
            "event": invocation.event,
            "user": invocation.user,
        }))
    }
}
