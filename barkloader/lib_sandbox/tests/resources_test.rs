//! `ctx.resources` scoped to the calling module: a module reads its own
//! instances and the ones the streamer linked to it, and writes only its own.
//! Every case runs in both runtimes through the public `Sandbox::invoke` path.

use lib_sandbox::host::noop::noop_host_context;
use lib_sandbox::host::{HostContext, ResourceClient, ResourceInstance, SettingsClient};
use lib_sandbox::models::function::Function;
use lib_sandbox::models::request::InvokeRequest;
use lib_sandbox::{
    ModuleMetadata, ModuleRegistry, ModuleState, RegisteredModule, Sandbox, SandboxActionRunner,
    SandboxLimits,
};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

/// Owned by `alpha`, the module that provides `counter`.
const ALPHA_COUNTER: &str = "alpha:counter:main";
/// Owned by `beta`, the module whose code the tests run.
const BETA_COUNTER: &str = "beta:counter:mine";
/// `beta`'s `resource_ref` setting.
const LINK_SETTING: &str = "counter";

const PROBE_JS: &str = r#"
function probe(ctx) {
  var p = ctx.event.parameters;
  if (p.op === "get") {
    return { got: ctx.resources.get(p.target).canonical_id };
  }
  if (p.op === "delete") {
    ctx.resources.delete(p.target);
    return { deleted: p.target };
  }
  if (p.op === "list") {
    return { ids: ctx.resources.list(p.kind).map(function (i) { return i.canonical_id; }) };
  }
  if (p.op === "setSetting") {
    ctx.module.setSetting(p.key, p.value);
    return { set: p.key };
  }
  if (p.op === "run") {
    return ctx.resources.run(p.target, "bump", {});
  }
  throw new Error("unknown op " + p.op);
}
"#;

const PROBE_LUA: &str = r#"
function probeLua(ctx)
  local p = ctx.event.parameters
  if p.op == "get" then
    return { got = ctx.resources.get(p.target).canonical_id }
  end
  if p.op == "delete" then
    ctx.resources.delete(p.target)
    return { deleted = p.target }
  end
  if p.op == "list" then
    local ids = {}
    for _, instance in ipairs(ctx.resources.list(p.kind)) do
      ids[#ids + 1] = instance.canonical_id
    end
    return { ids = ids }
  end
  if p.op == "setSetting" then
    ctx.module.setSetting(p.key, p.value)
    return { set = p.key }
  end
  if p.op == "run" then
    return ctx.resources.run(p.target, "bump", {})
  end
  error("unknown op " .. p.op)
end
"#;

/// `alpha`'s `counter.bump` action: reports the instance and who it ran as.
const BUMP_JS: &str = r#"
function bump(ctx) {
  return { target: ctx.event.parameters.target, ranAs: ctx.module.id };
}
"#;

#[derive(Clone, Copy, Debug)]
enum Runtime {
    Js,
    Lua,
}

const RUNTIMES: [Runtime; 2] = [Runtime::Js, Runtime::Lua];

impl Runtime {
    fn probe(self) -> &'static str {
        match self {
            Runtime::Js => "beta:function:probe",
            Runtime::Lua => "beta:function:probeLua",
        }
    }
}

/// Module settings as db-proxy keeps them: what the streamer set, plus every
/// write module code makes.
#[derive(Default)]
struct Settings(Mutex<HashMap<String, HashMap<String, Value>>>);

impl SettingsClient for Settings {
    fn list_by_module(&self, module_id: &str) -> Result<HashMap<String, Value>, String> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .get(module_id)
            .cloned()
            .unwrap_or_default())
    }
    fn set(&self, module_id: &str, key: &str, value: &str) -> Result<(), String> {
        self.0
            .lock()
            .unwrap()
            .entry(module_id.to_string())
            .or_default()
            .insert(key.to_string(), Value::String(value.to_string()));
        Ok(())
    }
}

/// Every module's instances, recording each delete that reaches it.
struct Instances {
    all: Vec<ResourceInstance>,
    deleted: Mutex<Vec<String>>,
}

impl ResourceClient for Instances {
    fn create(
        &self,
        _: &str,
        _: &str,
        _: &str,
        _: &str,
        _: &Value,
    ) -> Result<ResourceInstance, String> {
        Err("not in these tests".into())
    }
    fn delete(&self, canonical_id: &str) -> Result<(), String> {
        self.deleted.lock().unwrap().push(canonical_id.to_string());
        Ok(())
    }
    fn get(&self, canonical_id: &str) -> Result<Option<ResourceInstance>, String> {
        Ok(self
            .all
            .iter()
            .find(|i| i.canonical_id == canonical_id)
            .cloned())
    }
    fn list_by_kind(&self, kind: &str) -> Result<Vec<ResourceInstance>, String> {
        Ok(self
            .all
            .iter()
            .filter(|i| i.kind == kind)
            .cloned()
            .collect())
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

fn module(
    name: &str,
    functions: &[(&str, &str, &str)],
    actions: &[(&str, &str)],
    resource_link_settings: &[&str],
) -> RegisteredModule {
    RegisteredModule {
        metadata: ModuleMetadata {
            name: name.to_string(),
            version: "1.0.0".to_string(),
            installed_at: 0,
            updated_at: 0,
        },
        functions: functions
            .iter()
            .map(|(id, file_name, code)| {
                (
                    id.to_string(),
                    Function::new(
                        id.to_string(),
                        file_name.to_string(),
                        code.to_string(),
                        false,
                    ),
                )
            })
            .collect(),
        state: ModuleState::Active,
        event_types: Default::default(),
        permissions: Default::default(),
        protected_settings: Default::default(),
        local_endpoints: Default::default(),
        resource_link_settings: resource_link_settings
            .iter()
            .map(|s| s.to_string())
            .collect::<HashSet<_>>(),
        oauth: Default::default(),
        actions: actions
            .iter()
            .map(|(a, f)| (a.to_string(), f.to_string()))
            .collect(),
    }
}

struct World {
    registry: Arc<ModuleRegistry>,
    host: HostContext,
    settings: Arc<Settings>,
    instances: Arc<Instances>,
}

impl World {
    /// `alpha` provides `counter` with a `bump` action; `beta` declares the
    /// `counter` link setting, which the streamer has set to `streamer_link`.
    fn new(streamer_link: Option<&str>) -> Self {
        let registry = Arc::new(ModuleRegistry::new());
        registry
            .register_module(
                "alpha".into(),
                module(
                    "alpha",
                    &[
                        ("bump", "bump.js", BUMP_JS),
                        ("probe", "probe.js", PROBE_JS),
                    ],
                    &[("counter.bump", "bump")],
                    &[],
                ),
            )
            .unwrap();
        registry
            .register_module(
                "beta".into(),
                module(
                    "beta",
                    &[
                        ("probe", "probe.js", PROBE_JS),
                        ("probeLua", "probe.lua", PROBE_LUA),
                    ],
                    &[],
                    &[LINK_SETTING],
                ),
            )
            .unwrap();

        let settings = Arc::new(Settings::default());
        if let Some(link) = streamer_link {
            settings
                .set("beta", LINK_SETTING, link)
                .expect("streamer sets the link");
        }
        let instances = Arc::new(Instances {
            all: vec![instance(ALPHA_COUNTER), instance(BETA_COUNTER)],
            deleted: Mutex::new(Vec::new()),
        });
        let runner =
            SandboxActionRunner::new(registry.clone(), SandboxLimits::default()).expect("limits");
        let mut host = noop_host_context();
        host.settings = settings.clone();
        host.resources = instances.clone();
        host.actions = runner.clone();
        runner.bind(host.clone());
        Self {
            registry,
            host,
            settings,
            instances,
        }
    }

    fn call(&self, function: &str, parameters: Value) -> Result<Value, String> {
        Sandbox::new(
            self.registry.clone(),
            self.host.clone(),
            SandboxLimits::default(),
        )
        .unwrap()
        .invoke(InvokeRequest {
            function: function.to_string(),
            event: json!({ "parameters": parameters }),
            user: None,
            params: Value::Null,
            workflow_chain: None,
            timeout_ms: None,
        })
        .map_err(|e| e.to_string())
    }

    fn deleted(&self) -> Vec<String> {
        self.instances.deleted.lock().unwrap().clone()
    }
}

#[test]
fn test_get_refuses_another_modules_unlinked_instance() {
    for runtime in RUNTIMES {
        let world = World::new(None);
        let err = world
            .call(
                runtime.probe(),
                json!({ "op": "get", "target": ALPHA_COUNTER }),
            )
            .expect_err("not beta's and not linked");
        assert!(
            err.contains("may read only an instance it owns"),
            "{runtime:?}: {err}"
        );
        let own = world
            .call(
                runtime.probe(),
                json!({ "op": "get", "target": BETA_COUNTER }),
            )
            .expect("its own instance");
        assert_eq!(own, json!({ "got": BETA_COUNTER }), "{runtime:?}");
    }
}

#[test]
fn test_delete_refuses_another_modules_instance_even_when_linked() {
    for runtime in RUNTIMES {
        let world = World::new(Some(ALPHA_COUNTER));
        let err = world
            .call(
                runtime.probe(),
                json!({ "op": "delete", "target": ALPHA_COUNTER }),
            )
            .expect_err("a link is not ownership");
        assert!(
            err.contains("only the module that owns an instance may delete it"),
            "{runtime:?}: {err}"
        );
        assert!(world.deleted().is_empty(), "{runtime:?}");

        world
            .call(
                runtime.probe(),
                json!({ "op": "delete", "target": BETA_COUNTER }),
            )
            .expect("its own instance");
        assert_eq!(world.deleted(), [BETA_COUNTER], "{runtime:?}");
    }
}

#[test]
fn test_bare_kind_list_returns_only_the_callers_instances() {
    for runtime in RUNTIMES {
        let world = World::new(Some(ALPHA_COUNTER));
        let listed = world
            .call(runtime.probe(), json!({ "op": "list", "kind": "counter" }))
            .expect("list");
        assert_eq!(listed, json!({ "ids": [BETA_COUNTER] }), "{runtime:?}");
    }
    let owner = World::new(None)
        .call(
            "alpha:function:probe",
            json!({ "op": "list", "kind": "counter" }),
        )
        .expect("list");
    assert_eq!(owner, json!({ "ids": [ALPHA_COUNTER] }));
}

#[test]
fn test_qualified_kind_list_returns_only_linked_instances_of_another_module() {
    let unlinked = World::new(None)
        .call(
            Runtime::Js.probe(),
            json!({ "op": "list", "kind": "alpha:counter" }),
        )
        .expect("list");
    assert_eq!(unlinked, json!({ "ids": [] }));

    let linked = World::new(Some(ALPHA_COUNTER))
        .call(
            Runtime::Js.probe(),
            json!({ "op": "list", "kind": "alpha:counter" }),
        )
        .expect("list");
    assert_eq!(linked, json!({ "ids": [ALPHA_COUNTER] }));
}

#[test]
fn test_set_setting_refuses_a_resource_link_setting() {
    for runtime in RUNTIMES {
        let world = World::new(None);
        let err = world
            .call(
                runtime.probe(),
                json!({ "op": "setSetting", "key": LINK_SETTING, "value": ALPHA_COUNTER }),
            )
            .expect_err("only the streamer sets a link");
        assert!(
            err.contains("links a resource instance"),
            "{runtime:?}: {err}"
        );
        assert!(
            !world
                .settings
                .list_by_module("beta")
                .unwrap()
                .contains_key(LINK_SETTING),
            "{runtime:?}: nothing was written"
        );
    }
}

#[test]
fn test_an_undeclared_setting_holding_an_instance_id_is_no_link() {
    for runtime in RUNTIMES {
        let world = World::new(None);
        world
            .call(
                runtime.probe(),
                json!({ "op": "setSetting", "key": "note", "value": ALPHA_COUNTER }),
            )
            .expect("an ordinary setting stays writable");

        let get = world
            .call(
                runtime.probe(),
                json!({ "op": "get", "target": ALPHA_COUNTER }),
            )
            .expect_err("forged link");
        assert!(
            get.contains("may read only an instance it owns"),
            "{runtime:?}: {get}"
        );
        let run = world
            .call(
                runtime.probe(),
                json!({ "op": "run", "target": ALPHA_COUNTER }),
            )
            .expect_err("forged link");
        assert!(
            run.contains("may act only on a resource it owns or one its settings link to"),
            "{runtime:?}: {run}"
        );
    }
}

#[test]
fn test_a_streamer_set_link_allows_get_and_run() {
    for runtime in RUNTIMES {
        let world = World::new(Some(ALPHA_COUNTER));
        let got = world
            .call(
                runtime.probe(),
                json!({ "op": "get", "target": ALPHA_COUNTER }),
            )
            .expect("linked");
        assert_eq!(got, json!({ "got": ALPHA_COUNTER }), "{runtime:?}");
        let ran = world
            .call(
                runtime.probe(),
                json!({ "op": "run", "target": ALPHA_COUNTER }),
            )
            .expect("linked");
        assert_eq!(
            ran,
            json!({ "target": ALPHA_COUNTER, "ranAs": "alpha" }),
            "{runtime:?}"
        );
    }
}
