use crate::error::Error;
use serde_json::Value;

pub mod lua;
pub mod bun;

pub trait RuntimeAdapter: Send + Sync {
    fn execute(&self, code: &str, args: Value) -> Result<Value, Error>;
    fn create_sandbox(&self) -> Result<(), Error>;
}