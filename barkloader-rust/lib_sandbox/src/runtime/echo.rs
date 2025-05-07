use crate::{error::Error, runtime::RuntimeAdapter};
use serde_json::{json, Value};

pub struct EchoAdapter {}

impl EchoAdapter {
    pub fn new() -> Self {
        Self {}
    }
}

impl RuntimeAdapter for EchoAdapter {
    fn execute(&self, code: &str, args: Value) -> Result<Value, Error> {
        Ok(json!({"code": code, "args": args}))
    }
    
    fn create_sandbox(&self) -> Result<(), Error> {
        Ok(())
    }
}

