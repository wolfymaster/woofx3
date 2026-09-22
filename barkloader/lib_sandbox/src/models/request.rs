use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct InvokeRequest {
    pub function: String,
    pub event: Value,
    #[serde(default)]
    pub user: Option<Value>,
    /// Action parameters resolved by the caller (e.g. workflow engine). Used
    /// by builtin dispatches; module functions still read their inputs from
    /// `event`.
    #[serde(default)]
    pub params: Value,
    /// The chain of workflow runs this call is part of, when a workflow step
    /// made it. Stamped on every event the function announces, so the
    /// workflow engine can see a loop that runs through a module function.
    #[serde(default, rename = "workflowChain")]
    pub workflow_chain: Option<String>,
}
