use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct InvokeRequest {
    pub function: String,
    pub event: Value,
    #[serde(default)]
    pub user: Option<Value>,
}
