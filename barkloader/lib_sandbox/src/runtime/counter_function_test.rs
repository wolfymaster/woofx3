//! Runs the bundled woofx3 module's counter functions in the real QuickJS
//! runtime, against an in-memory store that honours compare-and-set.
//!
//! Lives here rather than beside the module's JS because the module directory
//! is zipped into the binary whole, and because what these tests prove is the
//! pairing of that JS with this crate's `ctx.storage` and `ctx.resources`
//! bindings — which only exist in here.

use crate::host::noop::noop_host_context;
use crate::host::{
    CompareAndSetOutcome, InvocationContext, ResourceClient, ResourceInstance, StorageClient, StorageSetOptions,
};
use crate::runtime::RuntimeAdapter;
use crate::runtime::quickjs::QuickJSAdapter;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

const COUNTER_JS: &str = include_str!("../../../../modules/woofx3/functions/counter.js");
const TARGET: &str = "woofx3:counter:deaths";

/// One value per (namespace, key), plus a record of each write's options. When
/// `lose_next_race` is set, the next compare-and-set is refused as though
/// another writer had just stored `raced_value`.
#[derive(Default)]
struct MemoryStorage {
    values: Mutex<HashMap<(String, String), Value>>,
    write_options: Mutex<Vec<StorageSetOptions>>,
    lose_next_race: Mutex<Option<Value>>,
}

impl StorageClient for MemoryStorage {
    fn get(&self, namespace: &str, key: &str) -> Result<Option<Value>, String> {
        Ok(self.values.lock().unwrap().get(&(namespace.into(), key.into())).cloned())
    }

    fn set(&self, namespace: &str, key: &str, value: Value, options: StorageSetOptions) -> Result<(), String> {
        self.write_options.lock().unwrap().push(options);
        self.values.lock().unwrap().insert((namespace.into(), key.into()), value);
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
            return Ok(CompareAndSetOutcome { swapped: false, current: Some(raced) });
        }
        if values.get(&address) != expected {
            return Ok(CompareAndSetOutcome { swapped: false, current: values.get(&address).cloned() });
        }
        self.write_options.lock().unwrap().push(options);
        values.insert(address, value.clone());
        Ok(CompareAndSetOutcome { swapped: true, current: Some(value) })
    }
}

/// Knows exactly one instance.
struct OneInstance(ResourceInstance);

impl ResourceClient for OneInstance {
    fn create(&self, _: &str, _: &str, _: &str, _: &str, _: &Value) -> Result<ResourceInstance, String> {
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

fn instance(kind: &str, settings: Value) -> ResourceInstance {
    ResourceInstance {
        canonical_id: TARGET.to_string(),
        module_name: "woofx3".to_string(),
        kind: kind.to_string(),
        instance_id: "deaths".to_string(),
        display_name: "Deaths".to_string(),
        settings,
    }
}

struct Harness {
    storage: Arc<MemoryStorage>,
    resources: Arc<OneInstance>,
}

impl Harness {
    fn new(kind: &str, settings: Value) -> Self {
        Self {
            storage: Arc::new(MemoryStorage::default()),
            resources: Arc::new(OneInstance(instance(kind, settings))),
        }
    }

    fn run(&self, entry_point: &str, parameters: Value) -> Result<Value, String> {
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
        QuickJSAdapter::new()
            .unwrap()
            .execute(COUNTER_JS, entry_point, &invocation)
            .map_err(|err| err.to_string())
    }

    fn stored(&self) -> Option<Value> {
        self.storage.get("woofx3", &format!("state:{TARGET}")).unwrap()
    }
}

#[test]
fn a_counter_with_no_value_starts_from_its_initial_value() {
    let harness = Harness::new("counter", json!({ "initialValue": 10, "step": 5 }));
    let result = harness.run("counterIncrement", json!({ "target": TARGET })).unwrap();
    assert_eq!(result, json!({ "target": TARGET, "previous": 10, "next": 15 }));
    assert_eq!(harness.stored(), Some(json!(15)));
}

#[test]
fn increment_and_decrement_move_by_the_counter_step() {
    let harness = Harness::new("counter", json!({ "step": 2 }));
    harness.run("counterIncrement", json!({ "target": TARGET })).unwrap();
    harness.run("counterIncrement", json!({ "target": TARGET })).unwrap();
    let result = harness.run("counterDecrement", json!({ "target": TARGET })).unwrap();
    assert_eq!(result["previous"], 4);
    assert_eq!(result["next"], 2);
}

#[test]
fn set_and_reset() {
    let harness = Harness::new("counter", json!({ "initialValue": 3 }));
    assert_eq!(harness.run("counterSet", json!({ "target": TARGET, "value": 42 })).unwrap()["next"], 42);
    let reset = harness.run("counterReset", json!({ "target": TARGET })).unwrap();
    assert_eq!(reset["previous"], 42);
    assert_eq!(reset["next"], 3);
}

#[test]
fn set_refuses_a_value_that_is_not_a_number() {
    let harness = Harness::new("counter", json!({}));
    let err = harness.run("counterSet", json!({ "target": TARGET, "value": "lots" })).unwrap_err();
    assert!(err.contains("not a number"), "{err}");
    assert_eq!(harness.stored(), None);
}

// The lifetime setting is what decides whether the engine clears the value
// when the stream session ends.
#[test]
fn a_session_counter_is_written_to_be_cleared_when_the_session_ends() {
    for (lifetime, cleared) in [("session", true), ("forever", false)] {
        let harness = Harness::new("counter", json!({ "lifetime": lifetime }));
        harness.run("counterIncrement", json!({ "target": TARGET })).unwrap();
        let options = harness.storage.write_options.lock().unwrap();
        assert_eq!(options[0].clear_on_session_end, cleared, "lifetime {lifetime}");
    }
}

// The reason every write is a compare-and-set: a concurrent change is retried
// from, not overwritten.
#[test]
fn an_increment_that_loses_a_race_retries_from_the_winning_value() {
    let harness = Harness::new("counter", json!({}));
    *harness.storage.lose_next_race.lock().unwrap() = Some(json!(7));
    let result = harness.run("counterIncrement", json!({ "target": TARGET })).unwrap();
    assert_eq!(result["previous"], 7);
    assert_eq!(result["next"], 8);
    assert_eq!(harness.stored(), Some(json!(8)));
}

#[test]
fn refuses_a_target_that_is_not_a_counter() {
    let harness = Harness::new("timer", json!({}));
    let err = harness.run("counterIncrement", json!({ "target": TARGET })).unwrap_err();
    assert!(err.contains("not a counter"), "{err}");
}

#[test]
fn refuses_a_counter_that_does_not_exist_or_was_not_chosen() {
    let harness = Harness::new("counter", json!({}));
    let missing = harness
        .run("counterIncrement", json!({ "target": "woofx3:counter:gone" }))
        .unwrap_err();
    assert!(missing.contains("does not exist"), "{missing}");
    let unchosen = harness.run("counterIncrement", json!({})).unwrap_err();
    assert!(unchosen.contains("no counter chosen"), "{unchosen}");
}
