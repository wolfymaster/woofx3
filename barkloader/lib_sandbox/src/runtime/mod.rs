use crate::error::Error;
use crate::host::InvocationContext;
use serde_json::Value;

pub mod crypto;
pub mod echo;
pub mod host_bindings;
pub mod lua;
pub mod quickjs;
pub mod storage_event;

#[cfg(test)]
mod counter_function_test;
#[cfg(test)]
mod goal_function_test;
#[cfg(test)]
mod queue_function_test;
#[cfg(test)]
mod resource_function_harness;
#[cfg(test)]
mod timer_function_test;

pub trait RuntimeAdapter: Send {
    fn execute(
        &self,
        code: &str,
        entry_point: &str,
        invocation: &InvocationContext,
    ) -> Result<Value, Error>;
}
