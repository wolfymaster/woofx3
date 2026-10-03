//! `ctx.resources.run`: a module driving a resource another module provides,
//! by running the provider's `{kind}.{verb}` action as the provider.

use lib_sandbox::host::noop::noop_host_context;
use lib_sandbox::host::{HostContext, ResourceClient, ResourceInstance, SettingsClient};
use lib_sandbox::models::function::Function;
use lib_sandbox::models::request::InvokeRequest;
use lib_sandbox::{
    ModuleMetadata, ModuleRegistry, ModuleState, RegisteredModule, Sandbox, SandboxActionRunner,
};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Arc;

const COUNTER: &str = "provider:counter:main";

/// The provider's action: reports what it was asked and as whom it ran.
const BUMP_JS: &str = r#"
function bump(ctx) {
  var p = ctx.event.parameters;
  return { target: p.target, by: p.by, ranAs: ctx.module.id };
}
"#;

/// The consumer: runs whatever it is told on the target it is told.
const DRIVE_JS: &str = r#"
function drive(ctx) {
  var p = ctx.event.parameters;
  return ctx.resources.run(p.target, p.verb, { by: 2 });
}
"#;

/// Calls itself back through a resource it owns, forever.
const LOOP_JS: &str = r#"
function spin(ctx) {
  return ctx.resources.run(ctx.event.parameters.target, "spin", {});
}
"#;

fn module(name: &str, functions: &[(&str, &str)], actions: &[(&str, &str)], permissions: &[&str]) -> RegisteredModule {
    RegisteredModule {
        metadata: ModuleMetadata {
            name: name.to_string(),
            version: "1.0.0".to_string(),
            installed_at: 0,
            updated_at: 0,
        },
        functions: functions
            .iter()
            .map(|(id, code)| {
                (
                    id.to_string(),
                    Function::new(id.to_string(), format!("{id}.js"), code.to_string(), false),
                )
            })
            .collect(),
        state: ModuleState::Active,
        event_types: Default::default(),
        permissions: permissions.iter().map(|p| p.to_string()).collect(),
        url_settings: Default::default(),
        oauth: Default::default(),
        actions: actions
            .iter()
            .map(|(a, f)| (a.to_string(), f.to_string()))
            .collect(),
    }
}

struct Settings(HashMap<String, HashMap<String, Value>>);

impl SettingsClient for Settings {
    fn list_by_module(&self, module_id: &str) -> Result<HashMap<String, Value>, String> {
        Ok(self.0.get(module_id).cloned().unwrap_or_default())
    }
    fn set(&self, _: &str, _: &str, _: &str) -> Result<(), String> {
        Ok(())
    }
}

struct Instances(Vec<ResourceInstance>);

impl ResourceClient for Instances {
    fn create(&self, _: &str, _: &str, _: &str, _: &str, _: &Value) -> Result<ResourceInstance, String> {
        Err("not in these tests".into())
    }
    fn delete(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
    fn get(&self, canonical_id: &str) -> Result<Option<ResourceInstance>, String> {
        Ok(self.0.iter().find(|i| i.canonical_id == canonical_id).cloned())
    }
    fn list_by_kind(&self, _: &str) -> Result<Vec<ResourceInstance>, String> {
        Ok(self.0.clone())
    }
}

fn instance(canonical_id: &str) -> ResourceInstance {
    let parts: Vec<&str> = canonical_id.split(':').collect();
    ResourceInstance {
        canonical_id: canonical_id.to_string(),
        module_name: parts[0].to_string(),
        kind: parts[1].to_string(),
        instance_id: parts[2].to_string(),
        display_name: parts[2].to_string(),
        settings: json!({}),
    }
}

struct World {
    registry: Arc<ModuleRegistry>,
    host: HostContext,
}

/// `consumer` links `COUNTER` in its `timer` setting unless `linked` is false;
/// `provider` declares `counter.bump` and needs `provider_permissions`.
fn world(linked: bool, provider_permissions: &[&str], consumer_permissions: &[&str]) -> World {
    let registry = Arc::new(ModuleRegistry::new());
    registry
        .register_module(
            "provider".into(),
            module(
                "provider",
                &[("bump", BUMP_JS), ("spin", LOOP_JS)],
                &[("counter.bump", "bump"), ("counter.spin", "spin")],
                provider_permissions,
            ),
        )
        .unwrap();
    registry
        .register_module(
            "consumer".into(),
            module("consumer", &[("drive", DRIVE_JS)], &[], consumer_permissions),
        )
        .unwrap();

    let mut settings = HashMap::new();
    if linked {
        settings.insert(
            "consumer".to_string(),
            HashMap::from([("timer".to_string(), json!(COUNTER))]),
        );
    }
    let runner = SandboxActionRunner::new(registry.clone());
    let mut host = noop_host_context();
    host.settings = Arc::new(Settings(settings));
    host.resources = Arc::new(Instances(vec![instance(COUNTER), instance("elsewhere:counter:other")]));
    host.actions = runner.clone();
    runner.bind(host.clone());
    World { registry, host }
}

fn call(world: &World, function: &str, target: &str, verb: &str) -> Result<Value, String> {
    Sandbox::new(world.registry.clone(), world.host.clone())
        .unwrap()
        .invoke(InvokeRequest {
            function: function.to_string(),
            event: json!({ "parameters": { "target": target, "verb": verb } }),
            user: None,
            params: Value::Null,
            workflow_chain: None,
            timeout_ms: None,
        })
        .map_err(|e| e.to_string())
}

#[test]
fn runs_the_providers_action_as_the_provider_on_a_linked_resource() {
    let w = world(true, &[], &[]);
    let result = call(&w, "consumer:function:drive", COUNTER, "bump").expect("run");
    assert_eq!(result, json!({ "target": COUNTER, "by": 2, "ranAs": "provider" }));
}

#[test]
fn refuses_a_resource_the_module_neither_owns_nor_links() {
    let w = world(false, &[], &[]);
    let err = call(&w, "consumer:function:drive", COUNTER, "bump").expect_err("not linked");
    assert!(err.contains("may act only on a resource it owns or one its settings link to"), "{err}");
}

#[test]
fn refuses_an_action_the_provider_does_not_declare() {
    let w = world(true, &[], &[]);
    let err = call(&w, "consumer:function:drive", COUNTER, "explode").expect_err("no such action");
    assert!(err.contains("provider has no `counter.explode` action"), "{err}");
}

#[test]
fn refuses_when_the_caller_lacks_the_providers_permissions() {
    let w = world(true, &["twitch.moderation"], &[]);
    let err = call(&w, "consumer:function:drive", COUNTER, "bump").expect_err("missing grant");
    assert!(err.contains("needs twitch.moderation"), "{err}");

    let granted = world(true, &["twitch.moderation"], &["twitch.moderation"]);
    call(&granted, "consumer:function:drive", COUNTER, "bump").expect("holds the grant");
}

#[test]
fn stops_a_loop_of_nested_runs() {
    let w = world(false, &[], &[]);
    let err = call(&w, "provider:function:spin", COUNTER, "spin").expect_err("loop");
    assert!(err.contains("nested more than"), "{err}");
}

#[test]
fn refuses_a_target_that_is_not_an_instance_id() {
    let w = world(true, &[], &[]);
    let err = call(&w, "consumer:function:drive", "nonsense", "bump").expect_err("bad id");
    assert!(err.contains("is not a resource instance id"), "{err}");
}
