use crate::error::Error;
use serde_json::Value;

pub mod echo;
pub mod lua;
pub mod quickjs;

pub trait RuntimeAdapter {
    fn execute(&self, code: &str, args: Value) -> Result<Value, Error>;
    fn create_sandbox(&self) -> Result<(), Error>;
}