use crate::error::Error;
use crate::host::InvocationContext;
use serde_json::Value;

pub mod echo;
pub mod lua;
pub mod quickjs;

pub trait RuntimeAdapter: Send {
    fn execute(
        &self,
        code: &str,
        entry_point: &str,
        invocation: &InvocationContext,
    ) -> Result<Value, Error>;
}
