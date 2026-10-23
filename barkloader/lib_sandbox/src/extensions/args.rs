//! Helpers extensions share for reading the arguments module code passes.

use serde_json::Value;

/// How a refusal names the value module code passed, for a message such as
/// "sceneName must be a non-empty string, got nothing".
pub(crate) fn describe(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => "nothing".to_string(),
        Some(Value::String(text)) if text.is_empty() => "an empty string".to_string(),
        Some(Value::String(text)) => format!("{text:?}"),
        Some(Value::Bool(flag)) => flag.to_string(),
        Some(Value::Number(number)) => number.to_string(),
        Some(Value::Array(_)) => "a list".to_string(),
        Some(Value::Object(_)) => "an object".to_string(),
    }
}
