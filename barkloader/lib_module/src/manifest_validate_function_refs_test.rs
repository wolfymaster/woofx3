//! Which functions an upload may invoke, through the bundled
//! `woofx3:action:function` action or a `type: "function"` action of its own.

use super::super::db_proxy::ModuleRecord;
use super::super::db_proxy_client::FakeDbProxyClient;
use super::*;

/// A module record for the bundled system module, which declares no
/// permissions, so the action-owner permission check always passes and only
/// the function-target rule decides.
fn installed_system_module() -> FakeDbProxyClient {
    let manifest = serde_json::json!({
        "id": SYSTEM_MODULE_ID, "name": SYSTEM_MODULE_ID, "version": "1.0.0",
    });
    let record: ModuleRecord = serde_json::from_value(serde_json::json!({
        "id": "row-woofx3",
        "module_id": SYSTEM_MODULE_ID,
        "module_key": "woofx3:1.0.0:abc1234",
        "name": SYSTEM_MODULE_ID,
        "version": "1.0.0",
        "state": "active",
        "manifest": manifest.to_string(),
    }))
    .expect("module record");
    FakeDbProxyClient::new().with_installed([record])
}

#[derive(Clone, Copy)]
enum Site {
    Workflow,
    Command,
}

/// A manifest with one function of its own, `greet`, and one step using the
/// bundled function action with `parameters`, placed per `site`.
fn calls_function(module_id: &str, site: Site, parameters: serde_json::Value) -> ModuleManifest {
    let step = serde_json::json!({
        "id": "s1",
        "action": "woofx3:action:function",
        "parameters": parameters,
    });
    let mut manifest = serde_json::json!({
        "id": module_id,
        "name": "Caller",
        "version": "1.0.0",
        "functions": [{ "id": "greet", "name": "Greet", "runtime": "js", "path": "f.js" }],
    });
    match site {
        Site::Workflow => {
            manifest["triggers"] = serde_json::json!([
                { "id": "t1", "name": "T1", "type": "eventbus", "event": "store.order.created" }
            ]);
            manifest["workflows"] = serde_json::json!([
                { "id": "w1", "name": "W1", "trigger": "t1", "steps": [step] }
            ]);
        }
        Site::Command => {
            manifest["commands"] = serde_json::json!([
                { "id": "c1", "name": "C1", "pattern": "!greet", "type": "prefix", "actions": [step] }
            ]);
        }
    }
    serde_json::from_value(manifest).expect("manifest parse")
}

/// A manifest with one function of its own, `greet`, and one action of its own
/// with `type: "function"` invoking `function`, used by a workflow step.
fn declares_function_action(module_id: &str, function: &str) -> ModuleManifest {
    serde_json::from_value(serde_json::json!({
        "id": module_id,
        "name": "Caller",
        "version": "1.0.0",
        "functions": [{ "id": "greet", "name": "Greet", "runtime": "js", "path": "f.js" }],
        "actions": [{ "id": "x", "name": "X", "type": "function", "function": function }],
        "triggers": [
            { "id": "t1", "name": "T1", "type": "eventbus", "event": "store.order.created" }
        ],
        "workflows": [
            { "id": "w1", "name": "W1", "trigger": "t1", "steps": [{ "id": "s1", "action": "x" }] }
        ],
    }))
    .expect("manifest parse")
}

enum Expect {
    Installs,
    Refused(&'static str),
}

#[tokio::test]
async fn test_function_action_targets_are_checked_at_install() {
    let cases = [
        (
            "an upload invoking its own function",
            InstallProvenance::User,
            calls_function(
                "caller",
                Site::Workflow,
                serde_json::json!({ "function": "caller:function:greet", "name": "x" }),
            ),
            Expect::Installs,
        ),
        (
            "a workflow step invoking another module's function",
            InstallProvenance::User,
            calls_function(
                "caller",
                Site::Workflow,
                serde_json::json!({ "function": "woofx3_twitch:function:timeout" }),
            ),
            Expect::Refused(
                "workflow 'w1' step #0 invokes 'woofx3_twitch:function:timeout', which belongs to another module",
            ),
        ),
        (
            "a command action invoking another module's function",
            InstallProvenance::User,
            calls_function(
                "caller",
                Site::Command,
                serde_json::json!({ "function": "woofx3_twitch:function:timeout" }),
            ),
            Expect::Refused(
                "command 'c1' action #0 invokes 'woofx3_twitch:function:timeout', which belongs to another module",
            ),
        ),
        (
            "a target computed from a template",
            InstallProvenance::User,
            calls_function(
                "caller",
                Site::Workflow,
                serde_json::json!({ "function": "${trigger.data.target}" }),
            ),
            Expect::Refused("computes the function to invoke from \"${trigger.data.target}\""),
        ),
        (
            "an own-module id the manifest does not declare",
            InstallProvenance::User,
            calls_function(
                "caller",
                Site::Workflow,
                serde_json::json!({ "function": "caller:function:missing" }),
            ),
            Expect::Refused("which this manifest does not declare"),
        ),
        (
            "a bare local id, which the engine cannot invoke",
            InstallProvenance::User,
            calls_function(
                "caller",
                Site::Workflow,
                serde_json::json!({ "function": "greet" }),
            ),
            Expect::Refused("\"greet\" is not a canonical function id"),
        ),
        (
            "a canonical id of another kind",
            InstallProvenance::User,
            calls_function(
                "caller",
                Site::Command,
                serde_json::json!({ "function": "caller:action:greet" }),
            ),
            Expect::Refused("\"caller:action:greet\" is not a canonical function id"),
        ),
        (
            "no function parameter",
            InstallProvenance::User,
            calls_function("caller", Site::Workflow, serde_json::json!({ "name": "x" })),
            Expect::Refused("has no `function` parameter"),
        ),
        (
            "a function parameter that is not a string",
            InstallProvenance::User,
            calls_function(
                "caller",
                Site::Command,
                serde_json::json!({ "function": 7 }),
            ),
            Expect::Refused("must be a canonical function id string, got 7"),
        ),
        (
            "a function id with surrounding whitespace, which the engine passes on verbatim",
            InstallProvenance::User,
            calls_function(
                "caller",
                Site::Workflow,
                serde_json::json!({ "function": " caller:function:greet " }),
            ),
            Expect::Refused("has surrounding whitespace"),
        ),
        (
            "an own action invoking its own function by local id",
            InstallProvenance::User,
            declares_function_action("caller", "greet"),
            Expect::Installs,
        ),
        (
            "an own action invoking another module's function",
            InstallProvenance::User,
            declares_function_action("caller", "woofx3_twitch:function:timeout"),
            Expect::Refused(
                "action 'x' invokes 'woofx3_twitch:function:timeout', which belongs to another module",
            ),
        ),
        (
            "a system module action invoking another module's function",
            InstallProvenance::System,
            declares_function_action(SYSTEM_MODULE_ID, "woofx3_twitch:function:timeout"),
            Expect::Installs,
        ),
        (
            "a system module invoking another module's function",
            InstallProvenance::System,
            calls_function(
                SYSTEM_MODULE_ID,
                Site::Workflow,
                serde_json::json!({ "function": "woofx3_twitch:function:timeout" }),
            ),
            Expect::Installs,
        ),
        (
            "a system module computing its target",
            InstallProvenance::System,
            calls_function(
                SYSTEM_MODULE_ID,
                Site::Command,
                serde_json::json!({ "function": "${trigger.data.target}" }),
            ),
            Expect::Installs,
        ),
    ];

    for (name, provenance, manifest, expect) in cases {
        let resolved = validate_with_provenance(&manifest, provenance)
            .unwrap_or_else(|e| panic!("{name}: static validation passes: {e}"));
        let result = build_install_plan(&manifest, &resolved, &installed_system_module()).await;
        match (expect, result) {
            (Expect::Installs, Ok(_)) => {}
            (Expect::Installs, Err(e)) => {
                panic!("{name}: expected install, got: {e}");
            }
            (Expect::Refused(fragment), Err(e)) => {
                let message = e.to_string();
                assert!(message.contains(fragment), "{name}: {message}");
            }
            (Expect::Refused(fragment), Ok(_)) => {
                panic!("{name}: expected refusal containing {fragment:?}, but the plan built");
            }
        }
    }
}

#[test]
fn test_function_action_targets_finds_steps_in_workflows_and_commands() {
    let mut manifest = calls_function(
        "caller",
        Site::Workflow,
        serde_json::json!({ "function": "caller:function:greet" }),
    );
    manifest.commands = calls_function(
        "caller",
        Site::Command,
        serde_json::json!({ "function": "${trigger.data.target}" }),
    )
    .commands;
    let resolved = validate(&manifest).expect("validate ok");

    let targets = function_action_targets(&manifest, &resolved);

    let greet = CanonicalId::new("caller", ResourceKind::Function, "greet").expect("canonical id");
    assert_eq!(
        targets,
        vec![
            (
                InvocationSite::Workflow {
                    workflow: "w1".to_string(),
                    index: 0
                },
                FunctionTarget::Static(greet)
            ),
            (
                InvocationSite::Command {
                    command: "c1".to_string(),
                    index: 0
                },
                FunctionTarget::Expression("${trigger.data.target}".to_string())
            ),
        ]
    );
}

#[test]
fn test_function_action_targets_finds_declared_function_actions() {
    let manifest = declares_function_action("caller", "woofx3_twitch:function:timeout");
    let resolved = validate(&manifest).expect("validate ok");

    let timeout =
        CanonicalId::new("woofx3_twitch", ResourceKind::Function, "timeout").expect("canonical id");
    assert_eq!(
        function_action_targets(&manifest, &resolved),
        vec![(
            InvocationSite::Action {
                action: "x".to_string()
            },
            FunctionTarget::Static(timeout)
        )]
    );
}

/// A step whose own module's action happens to be called `function`, or that
/// passes a `function` parameter to some other action, is not a call through
/// the bundled function action; only the declared action's target is found.
#[test]
fn test_function_action_targets_ignores_other_actions() {
    let manifest: ModuleManifest = serde_json::from_value(serde_json::json!({
        "id": "caller", "name": "Caller", "version": "1.0.0",
        "functions": [{ "id": "greet", "name": "Greet", "runtime": "js", "path": "f.js" }],
        "actions": [{ "id": "function", "name": "Mine", "type": "function", "function": "greet" }],
        "commands": [{ "id": "c1", "name": "C1", "pattern": "!c", "type": "prefix", "actions": [
            { "action": "function", "parameters": { "function": "woofx3_twitch:function:timeout" } },
            { "action": "woofx3:action:chat.reply", "parameters": { "function": "woofx3_twitch:function:timeout" } }
        ] }]
    }))
    .expect("manifest parse");
    let resolved = validate(&manifest).expect("validate ok");

    let greet = CanonicalId::new("caller", ResourceKind::Function, "greet").expect("canonical id");
    assert_eq!(
        function_action_targets(&manifest, &resolved),
        vec![(
            InvocationSite::Action {
                action: "function".to_string()
            },
            FunctionTarget::Static(greet)
        )]
    );
}

/// Bundled modules are exempt, but none of them needs the exemption today:
/// every function-action step they ship invokes a function of their own.
#[test]
fn test_bundled_manifests_invoke_only_their_own_functions() {
    let modules_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../modules");
    let mut checked = 0;
    for entry in std::fs::read_dir(&modules_dir).expect("read modules dir") {
        let path = entry
            .expect("modules dir entry")
            .path()
            .join("manifest.json");
        if !path.is_file() {
            continue;
        }
        let raw = std::fs::read_to_string(&path).expect("read bundled manifest");
        let manifest: ModuleManifest = serde_json::from_str(&raw)
            .unwrap_or_else(|e| panic!("{}: parses: {e}", path.display()));
        let mut resolved = validate_with_provenance(&manifest, InstallProvenance::System)
            .unwrap_or_else(|e| panic!("{}: validates: {e}", path.display()));
        resolved.provenance = InstallProvenance::User;
        refuse_cross_module_function_calls(&manifest, &resolved)
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        checked += 1;
    }
    assert!(
        checked > 0,
        "no bundled manifest found under {}",
        modules_dir.display()
    );
}
