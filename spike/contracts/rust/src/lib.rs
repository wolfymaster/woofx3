//! Validates woofx3 messages against the JSON Schema files in `../schemas`, embedded in the binary at compile time.

pub mod models_gen;

use std::collections::HashMap;

use include_dir::{Dir, include_dir};
use jsonschema::{Registry, Validator};
use serde_json::Value;

static SCHEMAS: Dir = include_dir!("$CARGO_MANIFEST_DIR/../schemas");

const SCHEMA_BASE: &str = "https://schemas.woofx3.tv/contracts/";

#[derive(Debug, thiserror::Error)]
pub enum ContractError {
    #[error("schema {path} is not valid JSON: {source}")]
    BadSchemaFile { path: String, source: serde_json::Error },
    #[error("loading schemas: {0}")]
    Registry(String),
    #[error("compiling {path}: {message}")]
    Compile { path: String, message: String },
    #[error("no schema {0}")]
    UnknownSchema(String),
    #[error("{0}")]
    Invalid(String),
}

/// How unknown fields are treated: producers refuse them, consumers tolerate them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Strictness {
    Strict,
    Lenient,
}

pub struct Validators {
    by_path: HashMap<String, Validator>,
}

impl Validators {
    pub fn new(mode: Strictness) -> Result<Self, ContractError> {
        let mut docs: Vec<(String, Value)> = Vec::new();
        collect(&SCHEMAS, &mut docs, mode)?;
        let mut builder = Registry::new();
        for (path, doc) in &docs {
            builder = builder
                .add(format!("{SCHEMA_BASE}{path}"), doc.clone())
                .map_err(|e| ContractError::Registry(e.to_string()))?;
        }
        let registry = builder.prepare().map_err(|e| ContractError::Registry(e.to_string()))?;
        let mut by_path = HashMap::new();
        for (path, doc) in &docs {
            let validator = jsonschema::options()
                .with_registry(&registry)
                .should_validate_formats(true)
                .build(doc)
                .map_err(|e| ContractError::Compile { path: path.clone(), message: e.to_string() })?;
            by_path.insert(path.clone(), validator);
        }
        Ok(Self { by_path })
    }

    /// Checks `value` against the schema at `path`, such as `platform-gateway/gateway-request.json`.
    pub fn validate(&self, path: &str, value: &Value) -> Result<(), ContractError> {
        let validator = self.by_path.get(path).ok_or_else(|| ContractError::UnknownSchema(path.to_string()))?;
        validator.validate(value).map_err(|e| ContractError::Invalid(format!("{} at {}", e, e.instance_path())))
    }
}

fn collect(dir: &Dir, out: &mut Vec<(String, Value)>, mode: Strictness) -> Result<(), ContractError> {
    for file in dir.files() {
        let path = file.path().to_string_lossy().to_string();
        if !path.ends_with(".json") {
            continue;
        }
        let mut doc: Value = serde_json::from_slice(file.contents())
            .map_err(|source| ContractError::BadSchemaFile { path: path.clone(), source })?;
        if mode == Strictness::Lenient {
            allow_extra_fields(&mut doc);
        }
        out.push((path, doc));
    }
    for sub in dir.dirs() {
        collect(sub, out, mode)?;
    }
    Ok(())
}

fn allow_extra_fields(node: &mut Value) {
    match node {
        Value::Object(map) => {
            if map.get("additionalProperties") == Some(&Value::Bool(false)) {
                map.remove("additionalProperties");
            }
            map.values_mut().for_each(allow_extra_fields);
        }
        Value::Array(items) => items.iter_mut().for_each(allow_extra_fields),
        _ => {}
    }
}
