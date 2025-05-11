use crate::error::Error;
use crate::runtime::RuntimeAdapter;
use quick_js::{Context, JsValue};
use serde_json::Value;
use std::collections::HashMap;

pub struct QuickJSAdapter {
    context: Context,
}

impl QuickJSAdapter {
    pub fn new() -> Result<Self, Error> {
        let context = Context::new()?;
        let adapter = Self { context };
        adapter.create_sandbox()?;
        Ok(adapter)
    }

    fn json_value_to_js_hashmap(&self, value: Value) -> Result<HashMap<String, JsValue>, Box<dyn std::error::Error>> {
        // if args is null, set it to an empty object
        if value.is_null() {
            return Ok(HashMap::new());
        }
                
        match value {
            Value::Object(map) => {
                let mut result = HashMap::new();
                for (key, value) in map {
                    result.insert(key, self.convert_to_js_value(value)?);
                }
                Ok(result)
            },
            _ => Err("JSON value is not an object".into())
        }
    }

    fn convert_to_js_value(&self, value: Value) -> Result<JsValue, Box<dyn std::error::Error>> {
        match value {
            Value::Null => Ok(JsValue::Null),
            Value::Bool(b) => Ok(JsValue::Bool(b)),
            Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    Ok(JsValue::Int(i as i32))
                } else {
                    Ok(JsValue::Float(n.as_f64().unwrap_or(0.0)))
                }
            },
            Value::String(s) => Ok(JsValue::String(s.into())),
            Value::Array(arr) => {
                let js_values = arr
                    .into_iter()
                    .map(|v| self.convert_to_js_value(v))
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(JsValue::Array(js_values))
            },
            Value::Object(obj) => {
                let mut map = HashMap::new();
                for (k, v) in obj {
                    map.insert(k, self.convert_to_js_value(v)?);
                }
                Ok(JsValue::Object(map))
            },
        }
    }

    fn js_to_json(&self, value: JsValue) -> Result<Value, Error> {
        match value {
            JsValue::Null => Ok(Value::Null),
            JsValue::Undefined => Ok(Value::Null),
            JsValue::Bool(b) => Ok(Value::Bool(b)),
            JsValue::Int(n) => Ok(Value::Number(n.into())),
            JsValue::String(s) => Ok(Value::String(s)),
            JsValue::Object(o) => {
                let mut map = serde_json::Map::new();
                for (k, v) in o {
                    map.insert(k, self.js_to_json(v)?);
                }
                Ok(Value::Object(map))
            }
            JsValue::Array(a) => {
                let mut arr = Vec::new();
                for v in a {
                    arr.push(self.js_to_json(v)?);
                }
                Ok(Value::Array(arr))
            }
            _ => Err(Error::QuickJSAdapterError(
                quick_js::ContextError::Execution(quick_js::ExecutionError::Internal(
                    "Unsupported type".to_string(),
                )),
            )),
        }
    }
}

impl RuntimeAdapter for QuickJSAdapter {
    fn execute(&self, code: &str, args: Value) -> Result<Value, Error> {
        let js_args = self.json_value_to_js_hashmap(args).unwrap();       
        self.context.eval(code)?;
        let result = self
            .context
            .call_function("main", [js_args])?;
        self.js_to_json(result)
    }

    fn create_sandbox(&self) -> Result<(), Error> {
        Ok(())
    }
}
