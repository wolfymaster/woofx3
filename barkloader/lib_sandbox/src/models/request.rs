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
}
