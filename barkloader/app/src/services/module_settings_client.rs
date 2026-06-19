//! Production `SettingsClient` impl — fetches module settings from db-proxy
//! and coerces stored TEXT values to their declared type.

use lib_sandbox::host::SettingsClient;
use serde_json::Value;
use std::collections::HashMap;
use tokio::runtime::Handle;

use crate::services::module_service::db_proxy::get_module_settings;

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
        let rows = Handle::current()
            .block_on(async move { get_module_settings(&url, &module_id).await })
            .map_err(|e| e.to_string())?;

        let mut map = HashMap::new();
        for row in rows {
            let typed_value = coerce_value(&row.value, &row.value_type);
            map.insert(row.key, typed_value);
        }
        Ok(map)
    }
}

fn coerce_value(raw: &str, value_type: &str) -> Value {
    match value_type {
        "number" => raw
            .parse::<f64>()
            .map(|n| Value::Number(serde_json::Number::from_f64(n).unwrap_or(serde_json::Number::from(0))))
            .unwrap_or(Value::Number(serde_json::Number::from(0))),
        "boolean" => Value::Bool(raw == "true" || raw == "1"),
        _ => Value::String(raw.to_string()),
    }
}
