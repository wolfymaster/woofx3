//! Production `SettingsClient` impl — fetches module settings from db-proxy
//! and coerces stored TEXT values to their declared type.

use lib_sandbox::host::{CompareAndSetOutcome, SettingsClient, setting_values_equal};
use serde_json::Value;
use std::collections::HashMap;
use tokio::runtime::Handle;

use lib_module::db_proxy::{
    compare_and_set_module_setting, get_module_secret_values, get_module_settings,
    set_module_setting,
};

/// A setting holding a list of rows, stored as a JSON array.
const LIST_SETTING_TYPE: &str = "list";
const SECRET_SETTING_TYPE: &str = "secret";

pub struct HttpSettingsClient {
    db_proxy_url: String,
}

impl HttpSettingsClient {
    pub fn new(db_proxy_url: String) -> Self {
        Self { db_proxy_url }
    }
}

impl SettingsClient for HttpSettingsClient {
    fn list_by_module(&self, module_id: &str) -> Result<HashMap<String, Value>, String> {
        let url = self.db_proxy_url.clone();
        let module_id = module_id.to_string();
        let (rows, secrets) = Handle::current().block_on(async move {
            let rows = get_module_settings(&url, &module_id)
                .await
                .map_err(|e| e.to_string())?;
            let secrets = get_module_secret_values(&url, &module_id)
                .await
                .map_err(|e| e.to_string())?;
            Ok::<_, String>((rows, secrets))
        })?;

        let mut map = HashMap::new();
        for row in rows {
            let typed_value = coerce_value(&row.value, &row.value_type);
            map.insert(row.key, typed_value);
        }
        // A secret row lists with an empty value; the opened value replaces it.
        for (key, value) in secrets {
            map.insert(key, Value::String(value));
        }
        Ok(map)
    }

    fn set(&self, module_id: &str, key: &str, value: &str) -> Result<(), String> {
        let url = self.db_proxy_url.clone();
        let module_id = module_id.to_string();
        let key = key.to_string();
        let value = value.to_string();
        Handle::current()
            .block_on(async move { set_module_setting(&url, &module_id, &key, &value).await })
            .map_err(|e| e.to_string())
    }

    fn compare_and_set(
        &self,
        module_id: &str,
        key: &str,
        expected: &Value,
        value: &Value,
    ) -> Result<CompareAndSetOutcome, String> {
        self.compare_and_set_blocking(module_id, key, expected, value)
    }
}

impl HttpSettingsClient {
    // Compares what the module read with the stored value as the module would
    // read it, then has db-proxy write only while the stored text is still the
    // text that comparison read: equal by meaning, and atomic by bytes.
    fn compare_and_set_blocking(
        &self,
        module_id: &str,
        key: &str,
        expected: &Value,
        value: &Value,
    ) -> Result<CompareAndSetOutcome, String> {
        let url = self.db_proxy_url.clone();
        let rows = Handle::current()
            .block_on(get_module_settings(&url, module_id))
            .map_err(|e| e.to_string())?;
        let Some(row) = rows.into_iter().find(|row| row.key == key) else {
            return Ok(CompareAndSetOutcome {
                swapped: false,
                current: None,
            });
        };
        if row.value_type == SECRET_SETTING_TYPE {
            return Err(format!(
                "ctx.module.compareAndSetSetting: {key:?} is a secret setting"
            ));
        }
        let current = coerce_value(&row.value, &row.value_type);
        if !setting_values_equal(&current, expected) {
            return Ok(CompareAndSetOutcome {
                swapped: false,
                current: Some(current),
            });
        }
        let text = setting_text(key, value, &row.value_type)?;
        let response = Handle::current()
            .block_on(compare_and_set_module_setting(
                &url, module_id, key, &row.value, &text,
            ))
            .map_err(|e| e.to_string())?;
        Ok(CompareAndSetOutcome {
            swapped: response.swapped,
            current: response
                .current
                .map(|row| coerce_value(&row.value, &row.value_type)),
        })
    }
}

/// The text stored for `value`: a string as is, anything else as JSON. A list
/// setting takes only an array (or its JSON text), so what a function writes
/// is something the dashboard's list editor and every later read understand.
fn setting_text(key: &str, value: &Value, value_type: &str) -> Result<String, String> {
    if value_type == LIST_SETTING_TYPE {
        let array = match value {
            Value::String(text) => serde_json::from_str::<Value>(text).ok(),
            other => Some(other.clone()),
        };
        return match array {
            Some(array @ Value::Array(_)) => Ok(array.to_string()),
            _ => Err(format!(
                "ctx.module.compareAndSetSetting: {key:?} is a list setting and takes an array"
            )),
        };
    }
    Ok(match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    })
}

fn coerce_value(raw: &str, value_type: &str) -> Value {
    match value_type {
        "number" => raw
            .parse::<f64>()
            .map(|n| {
                Value::Number(
                    serde_json::Number::from_f64(n).unwrap_or(serde_json::Number::from(0)),
                )
            })
            .unwrap_or(Value::Number(serde_json::Number::from(0))),
        "boolean" => Value::Bool(raw == "true" || raw == "1"),
        // Stored as a JSON array; anything else, such as the empty default,
        // reads as no rows.
        LIST_SETTING_TYPE => match serde_json::from_str::<Value>(raw) {
            Ok(array @ Value::Array(_)) => array,
            _ => Value::Array(Vec::new()),
        },
        _ => Value::String(raw.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_list_setting_reads_as_its_rows() {
        assert_eq!(
            coerce_value(r#"[{"label":"Pizza"}]"#, "list"),
            json!([{ "label": "Pizza" }])
        );
    }

    #[test]
    fn an_empty_or_broken_list_setting_reads_as_no_rows() {
        for raw in ["", "nope", "{}", "\"text\""] {
            assert_eq!(coerce_value(raw, "list"), json!([]), "raw {raw:?}");
        }
    }

    #[test]
    fn a_list_setting_is_written_as_json_text() {
        assert_eq!(
            setting_text("items", &json!([{ "label": "Pizza" }]), "list").unwrap(),
            r#"[{"label":"Pizza"}]"#
        );
        assert_eq!(
            setting_text("items", &json!(r#"[{"label":"Pizza"}]"#), "list").unwrap(),
            r#"[{"label":"Pizza"}]"#
        );
    }

    #[test]
    fn a_list_setting_refuses_anything_but_an_array() {
        assert!(setting_text("items", &json!("Pizza"), "list").is_err());
        assert!(setting_text("items", &json!({ "label": "Pizza" }), "list").is_err());
    }

    #[test]
    fn other_settings_store_strings_as_is_and_the_rest_as_json() {
        assert_eq!(
            setting_text("name", &json!("Pizza"), "text").unwrap(),
            "Pizza"
        );
        assert_eq!(setting_text("count", &json!(3), "number").unwrap(), "3");
    }
}
