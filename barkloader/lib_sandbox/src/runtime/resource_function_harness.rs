//! Runs one of the bundled woofx3 module's resource-kind functions in the real
//! QuickJS runtime, against an in-memory store that honours compare-and-set
//! and a resource client that knows one instance. What a function returns goes
//! through the same `ctx.result` checks the engine applies, against the
//! triggers the real manifest declares, and the events it would publish are
//! kept for the test to read.
//!
//! Lives here rather than beside the module's JS because the module directory
//! is zipped into the binary whole, and because what these tests prove is the
//! pairing of that JS with this crate's `ctx.storage` and `ctx.resources`
//! bindings — which only exist in here.

use crate::function_result::{ModuleEvent, resolve_function_result};
use crate::host::noop::noop_host_context;
use crate::host::{
    CompareAndSetOutcome, InvocationContext, ResourceClient, ResourceInstance, StorageClient,
    StorageSetOptions,
};
use crate::runtime::RuntimeAdapter;
use crate::runtime::quickjs::QuickJSAdapter;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

/// One value per (namespace, key), plus a record of each write's options. When
/// `lose_next_race` is set, the next compare-and-set is refused as though
/// another writer had just stored the value it holds.
#[derive(Default)]
pub struct MemoryStorage {
    values: Mutex<HashMap<(String, String), Value>>,
    pub write_options: Mutex<Vec<StorageSetOptions>>,
    pub lose_next_race: Mutex<Option<Value>>,
}

impl StorageClient for MemoryStorage {
    fn get(&self, namespace: &str, key: &str) -> Result<Option<Value>, String> {
        Ok(self
            .values
            .lock()
            .unwrap()
            .get(&(namespace.into(), key.into()))
            .cloned())
    }

    fn set(
        &self,
        namespace: &str,
        key: &str,
        value: Value,
        options: StorageSetOptions,
    ) -> Result<(), String> {
        self.write_options.lock().unwrap().push(options);
        self.values
            .lock()
            .unwrap()
            .insert((namespace.into(), key.into()), value);
        Ok(())
    }

    fn compare_and_set(
        &self,
        namespace: &str,
        key: &str,
        expected: Option<&Value>,
        value: Value,
        options: StorageSetOptions,
    ) -> Result<CompareAndSetOutcome, String> {
        let address = (namespace.to_string(), key.to_string());
        let mut values = self.values.lock().unwrap();
        if let Some(raced) = self.lose_next_race.lock().unwrap().take() {
            values.insert(address, raced.clone());
            return Ok(CompareAndSetOutcome {
                swapped: false,
                current: Some(raced),
            });
        }
        if values.get(&address) != expected {
            return Ok(CompareAndSetOutcome {
                swapped: false,
                current: values.get(&address).cloned(),
            });
        }
        self.write_options.lock().unwrap().push(options);
        values.insert(address, value.clone());
        Ok(CompareAndSetOutcome {
            swapped: true,
            current: Some(value),
        })
    }
}

/// Knows exactly one instance.
struct OneInstance(ResourceInstance);

impl ResourceClient for OneInstance {
    fn create(
        &self,
        _: &str,
        _: &str,
        _: &str,
        _: &str,
        _: &Value,
    ) -> Result<ResourceInstance, String> {
        Err("not used".into())
    }
    fn delete(&self, _: &str) -> Result<(), String> {
        Err("not used".into())
    }
    fn get(&self, canonical_id: &str) -> Result<Option<ResourceInstance>, String> {
        Ok((canonical_id == self.0.canonical_id).then(|| self.0.clone()))
    }
    fn list_by_kind(&self, _: &str) -> Result<Vec<ResourceInstance>, String> {
        Ok(vec![self.0.clone()])
    }
}

/// One function file and the single resource instance it is run against.
pub struct Harness {
    source: &'static str,
    target: String,
    pub storage: Arc<MemoryStorage>,
    resources: Arc<OneInstance>,
    /// Every event the functions run so far asked to publish, in order.
    pub events: Mutex<Vec<ModuleEvent>>,
}

impl Harness {
    /// `target` is the instance's canonical id, `{module}:{kind}:{instance}`;
    /// `kind` is what the instance claims to be, which a test may set to
    /// something else to check the function refuses it.
    pub fn new(source: &'static str, target: &str, kind: &str, settings: Value) -> Self {
        let instance_id = target.rsplit(':').next().unwrap_or_default().to_string();
        Self {
            source,
            target: target.to_string(),
            storage: Arc::new(MemoryStorage::default()),
            resources: Arc::new(OneInstance(ResourceInstance {
                canonical_id: target.to_string(),
                module_name: "woofx3".to_string(),
                kind: kind.to_string(),
                display_name: instance_id.clone(),
                instance_id,
                settings,
            })),
            events: Mutex::new(Vec::new()),
        }
    }

    pub fn run(&self, entry_point: &str, parameters: Value) -> Result<Value, String> {
        let mut host = noop_host_context();
        host.storage = self.storage.clone();
        host.resources = self.resources.clone();
        let invocation = InvocationContext {
            event: json!({ "parameters": parameters }),
            user: Value::Null,
            host,
            module_id: "woofx3".to_string(),
            module_name: "woofx3".to_string(),
            module_version: "0.7.0".to_string(),
        };
        let returned = QuickJSAdapter::new()
            .unwrap()
            .execute(self.source, entry_point, &invocation)
            .map_err(|err| err.to_string())?;
        let (value, events) = resolve_function_result(returned, &manifest_event_types())?;
        self.events.lock().unwrap().extend(events);
        Ok(value)
    }

    /// The events published so far, as `(type, data)`, emptying the record.
    pub fn take_events(&self) -> Vec<(String, Value)> {
        self.events
            .lock()
            .unwrap()
            .drain(..)
            .map(|event| (event.event_type, event.data))
            .collect()
    }

    /// The target's value, at the key every resource kind keeps it under.
    pub fn stored(&self) -> Option<Value> {
        self.storage
            .get("woofx3", &format!("state:{}", self.target))
            .unwrap()
    }

    pub fn store(&self, value: Value) {
        self.storage
            .set(
                "woofx3",
                &format!("state:{}", self.target),
                value,
                StorageSetOptions::default(),
            )
            .unwrap();
        self.storage.write_options.lock().unwrap().clear();
    }
}

/// The `event` of every eventbus trigger the bundled woofx3 manifest declares.
fn manifest_event_types() -> HashSet<String> {
    let manifest: Value =
        serde_json::from_str(include_str!("../../../../modules/woofx3/manifest.json"))
            .expect("bundled woofx3 manifest parses");
    manifest["triggers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|trigger| trigger["type"] == "eventbus")
        .filter_map(|trigger| trigger["event"].as_str().map(String::from))
        .collect()
}
