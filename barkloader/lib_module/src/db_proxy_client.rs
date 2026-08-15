//! A narrow, injectable seam over the db-proxy calls the module install
//! path makes, replacing direct calls into the 40-free-function
//! `db_proxy` module with a small trait `run_install` (and friends) can
//! depend on. `HttpDbProxyClient` delegates to the existing `db_proxy`
//! functions unchanged; `FakeDbProxyClient` (test-only) lets install-saga
//! tests fault-inject at any step without a live db-proxy.
//!
//! Scoped to the ~20 functions `module_install.rs` actually calls — not
//! the full `db_proxy` surface (routes still call `db_proxy::` directly;
//! widening this seam to cover that is a separate, larger change).

use anyhow::Result;
use async_trait::async_trait;

use super::db_proxy::{
    self, ActionInputJson, AssetInputJson, BackgroundTaskInputJson, CreateModuleFunctionJson,
    ResolvedActionRef, SettingInputJson, TriggerInputJson, WidgetInputJson,
};

#[async_trait]
pub trait ModuleDbProxy: Send + Sync {
    /// The db-proxy base URL this client talks to. Exists because two
    /// calls in the install path — `ManifestWorkflow::register` and
    /// `ManifestCommand::register` — go through their own clients
    /// (`woofx3_twirp::WorkflowServiceClient`, and `db_proxy::create_command`
    /// respectively) rather than through this trait's methods, and still
    /// need the raw URL. Widening the seam to cover those is a separate,
    /// larger change; this getter is the minimal way to avoid `run_install`
    /// needing a second, separate `db_proxy_url` parameter alongside this
    /// trait object.
    fn base_url(&self) -> &str;

    // module lifecycle
    async fn create_module(
        &self,
        display_name: &str,
        module_id: &str,
        version: &str,
        manifest_json: &str,
        archive_key: &str,
        functions: &[CreateModuleFunctionJson],
        module_key: &str,
        client_id: &str,
    ) -> Result<String>;
    async fn delete_module(&self, module_name: &str) -> Result<()>;
    async fn get_module_by_module_id(&self, module_id: &str) -> Result<Option<String>>;
    async fn get_module_by_name(&self, name: &str) -> Result<Option<String>>;

    // bulk registration (one call per kind, matching today's batching)
    async fn register_triggers(
        &self,
        module_key: &str,
        module_name: &str,
        version: &str,
        triggers: Vec<TriggerInputJson>,
        application_id: &str,
    ) -> Result<()>;
    async fn register_actions(
        &self,
        module_key: &str,
        module_name: &str,
        version: &str,
        actions: Vec<ActionInputJson>,
        application_id: &str,
    ) -> Result<()>;
    async fn register_widgets(
        &self,
        module_key: &str,
        module_name: &str,
        version: &str,
        widgets: Vec<WidgetInputJson>,
        application_id: &str,
    ) -> Result<()>;
    async fn register_background_tasks(
        &self,
        module_key: &str,
        module_name: &str,
        version: &str,
        tasks: Vec<BackgroundTaskInputJson>,
        application_id: &str,
    ) -> Result<()>;
    async fn register_module_settings(
        &self,
        module_id: &str,
        settings: Vec<SettingInputJson>,
    ) -> Result<()>;
    async fn register_assets(
        &self,
        module_key: &str,
        module_name: &str,
        version: &str,
        assets: Vec<AssetInputJson>,
    ) -> Result<()>;

    // cleanup / delete-by-module-id (used by cleanup_old_version and rollback)
    async fn delete_triggers_by_module_id(&self, module_id: &str) -> Result<()>;
    async fn delete_actions_by_module_id(&self, module_id: &str) -> Result<()>;
    async fn delete_widgets_by_module_id(&self, module_id: &str) -> Result<()>;
    async fn delete_background_tasks_by_module_id(&self, module_id: &str) -> Result<()>;
    async fn delete_workflows_by_module(&self, application_id: &str, module_name: &str) -> Result<()>;
    async fn delete_commands_by_module(&self, module_name: &str) -> Result<()>;

    // resource ledger
    async fn create_module_resource(
        &self,
        module_id: &str,
        resource_type: &str,
        resource_id: &str,
        manifest_id: &str,
        resource_name: &str,
        version: &str,
    ) -> Result<()>;
    async fn archive_resource_by_manifest_id(
        &self,
        module_id: &str,
        resource_type: &str,
        manifest_id: &str,
    ) -> Result<()>;
    async fn delete_resource_by_manifest_id(
        &self,
        module_id: &str,
        resource_type: &str,
        manifest_id: &str,
    ) -> Result<()>;

    // cross-module lookups
    async fn get_trigger_event_by_canonical_id(&self, canonical_id: &str) -> Result<String>;
    async fn get_action_ref_by_canonical_id(&self, canonical_id: &str) -> Result<ResolvedActionRef>;
}

/// Real adapter: delegates to the existing free functions in `db_proxy`,
/// unchanged. Keeps this PR to introducing the seam, not rewriting the
/// wire-level implementation.
pub struct HttpDbProxyClient {
    base_url: String,
}

impl HttpDbProxyClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
        }
    }
}

#[async_trait]
impl ModuleDbProxy for HttpDbProxyClient {
    fn base_url(&self) -> &str {
        &self.base_url
    }

    async fn create_module(
        &self,
        display_name: &str,
        module_id: &str,
        version: &str,
        manifest_json: &str,
        archive_key: &str,
        functions: &[CreateModuleFunctionJson],
        module_key: &str,
        client_id: &str,
    ) -> Result<String> {
        db_proxy::create_module(
            &self.base_url,
            display_name,
            module_id,
            version,
            manifest_json,
            archive_key,
            functions,
            module_key,
            client_id,
        )
        .await
    }

    async fn delete_module(&self, module_name: &str) -> Result<()> {
        db_proxy::delete_module(&self.base_url, module_name).await
    }

    async fn get_module_by_module_id(&self, module_id: &str) -> Result<Option<String>> {
        db_proxy::get_module_by_module_id(&self.base_url, module_id).await
    }

    async fn get_module_by_name(&self, name: &str) -> Result<Option<String>> {
        db_proxy::get_module_by_name(&self.base_url, name).await
    }

    async fn register_triggers(
        &self,
        module_key: &str,
        module_name: &str,
        version: &str,
        triggers: Vec<TriggerInputJson>,
        application_id: &str,
    ) -> Result<()> {
        db_proxy::register_triggers(&self.base_url, module_key, module_name, version, triggers, application_id)
            .await
    }

    async fn register_actions(
        &self,
        module_key: &str,
        module_name: &str,
        version: &str,
        actions: Vec<ActionInputJson>,
        application_id: &str,
    ) -> Result<()> {
        db_proxy::register_actions(&self.base_url, module_key, module_name, version, actions, application_id)
            .await
    }

    async fn register_widgets(
        &self,
        module_key: &str,
        module_name: &str,
        version: &str,
        widgets: Vec<WidgetInputJson>,
        application_id: &str,
    ) -> Result<()> {
        db_proxy::register_widgets(&self.base_url, module_key, module_name, version, widgets, application_id)
            .await
    }

    async fn register_background_tasks(
        &self,
        module_key: &str,
        module_name: &str,
        version: &str,
        tasks: Vec<BackgroundTaskInputJson>,
        application_id: &str,
    ) -> Result<()> {
        db_proxy::register_background_tasks(
            &self.base_url,
            module_key,
            module_name,
            version,
            tasks,
            application_id,
        )
        .await
    }

    async fn register_module_settings(
        &self,
        module_id: &str,
        settings: Vec<SettingInputJson>,
    ) -> Result<()> {
        db_proxy::register_module_settings(&self.base_url, module_id, settings).await
    }

    async fn register_assets(
        &self,
        module_key: &str,
        module_name: &str,
        version: &str,
        assets: Vec<AssetInputJson>,
    ) -> Result<()> {
        db_proxy::register_assets(&self.base_url, module_key, module_name, version, assets).await
    }

    async fn delete_triggers_by_module_id(&self, module_id: &str) -> Result<()> {
        db_proxy::delete_triggers_by_module_id(&self.base_url, module_id).await
    }

    async fn delete_actions_by_module_id(&self, module_id: &str) -> Result<()> {
        db_proxy::delete_actions_by_module_id(&self.base_url, module_id).await
    }

    async fn delete_widgets_by_module_id(&self, module_id: &str) -> Result<()> {
        db_proxy::delete_widgets_by_module_id(&self.base_url, module_id).await
    }

    async fn delete_background_tasks_by_module_id(&self, module_id: &str) -> Result<()> {
        db_proxy::delete_background_tasks_by_module_id(&self.base_url, module_id).await
    }

    async fn delete_workflows_by_module(&self, application_id: &str, module_name: &str) -> Result<()> {
        db_proxy::delete_workflows_by_module(&self.base_url, application_id, module_name).await
    }

    async fn delete_commands_by_module(&self, module_name: &str) -> Result<()> {
        db_proxy::delete_commands_by_module(&self.base_url, module_name).await
    }

    async fn create_module_resource(
        &self,
        module_id: &str,
        resource_type: &str,
        resource_id: &str,
        manifest_id: &str,
        resource_name: &str,
        version: &str,
    ) -> Result<()> {
        db_proxy::create_module_resource(
            &self.base_url,
            module_id,
            resource_type,
            resource_id,
            manifest_id,
            resource_name,
            version,
        )
        .await
    }

    async fn archive_resource_by_manifest_id(
        &self,
        module_id: &str,
        resource_type: &str,
        manifest_id: &str,
    ) -> Result<()> {
        db_proxy::archive_resource_by_manifest_id(&self.base_url, module_id, resource_type, manifest_id).await
    }

    async fn delete_resource_by_manifest_id(
        &self,
        module_id: &str,
        resource_type: &str,
        manifest_id: &str,
    ) -> Result<()> {
        db_proxy::delete_resource_by_manifest_id(&self.base_url, module_id, resource_type, manifest_id).await
    }

    async fn get_trigger_event_by_canonical_id(&self, canonical_id: &str) -> Result<String> {
        db_proxy::get_trigger_event_by_canonical_id(&self.base_url, canonical_id).await
    }

    async fn get_action_ref_by_canonical_id(&self, canonical_id: &str) -> Result<ResolvedActionRef> {
        db_proxy::get_action_ref_by_canonical_id(&self.base_url, canonical_id).await
    }
}

#[cfg(test)]
pub use test_support::FakeDbProxyClient;

#[cfg(test)]
mod test_support {
    use super::*;
    use anyhow::anyhow;
    use std::collections::HashSet;
    use std::sync::Mutex;

    /// In-memory `ModuleDbProxy` for install-saga tests: records every
    /// call in order, and fails whichever calls are named in `fail_on` —
    /// letting a test fault-inject at any single step and assert what the
    /// executor did before and after (including rollback).
    #[derive(Default)]
    pub struct FakeDbProxyClient {
        calls: Mutex<Vec<String>>,
        fail_on: HashSet<&'static str>,
    }

    impl FakeDbProxyClient {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn failing_on(methods: impl IntoIterator<Item = &'static str>) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                fail_on: methods.into_iter().collect(),
            }
        }

        pub fn calls(&self) -> Vec<String> {
            self.calls.lock().expect("calls mutex poisoned").clone()
        }

        fn record(&self, method: &'static str) -> Result<()> {
            self.calls.lock().expect("calls mutex poisoned").push(method.to_string());
            if self.fail_on.contains(method) {
                return Err(anyhow!("FakeDbProxyClient: injected failure at {}", method));
            }
            Ok(())
        }
    }

    #[async_trait]
    impl ModuleDbProxy for FakeDbProxyClient {
        fn base_url(&self) -> &str {
            // Deliberately unroutable: `ManifestWorkflow::register` /
            // `ManifestCommand::register` aren't part of this seam (see
            // `ModuleDbProxy::base_url`'s doc comment), so a test whose
            // plan reaches a `RegisterWorkflow`/`RegisterCommand` step
            // will fail fast here with a clear connection error rather
            // than silently dialing a real host.
            "http://fake-db-proxy.invalid"
        }

        async fn create_module(
            &self,
            _display_name: &str,
            _module_id: &str,
            _version: &str,
            _manifest_json: &str,
            _archive_key: &str,
            _functions: &[CreateModuleFunctionJson],
            _module_key: &str,
            _client_id: &str,
        ) -> Result<String> {
            self.record("create_module")?;
            Ok("fake-db-record-id".to_string())
        }

        async fn delete_module(&self, _module_name: &str) -> Result<()> {
            self.record("delete_module")
        }

        async fn get_module_by_module_id(&self, _module_id: &str) -> Result<Option<String>> {
            self.record("get_module_by_module_id")?;
            Ok(None)
        }

        async fn get_module_by_name(&self, _name: &str) -> Result<Option<String>> {
            self.record("get_module_by_name")?;
            Ok(None)
        }

        async fn register_triggers(
            &self,
            _module_key: &str,
            _module_name: &str,
            _version: &str,
            _triggers: Vec<TriggerInputJson>,
            _application_id: &str,
        ) -> Result<()> {
            self.record("register_triggers")
        }

        async fn register_actions(
            &self,
            _module_key: &str,
            _module_name: &str,
            _version: &str,
            _actions: Vec<ActionInputJson>,
            _application_id: &str,
        ) -> Result<()> {
            self.record("register_actions")
        }

        async fn register_widgets(
            &self,
            _module_key: &str,
            _module_name: &str,
            _version: &str,
            _widgets: Vec<WidgetInputJson>,
            _application_id: &str,
        ) -> Result<()> {
            self.record("register_widgets")
        }

        async fn register_background_tasks(
            &self,
            _module_key: &str,
            _module_name: &str,
            _version: &str,
            _tasks: Vec<BackgroundTaskInputJson>,
            _application_id: &str,
        ) -> Result<()> {
            self.record("register_background_tasks")
        }

        async fn register_module_settings(
            &self,
            _module_id: &str,
            _settings: Vec<SettingInputJson>,
        ) -> Result<()> {
            self.record("register_module_settings")
        }

        async fn register_assets(
            &self,
            _module_key: &str,
            _module_name: &str,
            _version: &str,
            _assets: Vec<AssetInputJson>,
        ) -> Result<()> {
            self.record("register_assets")
        }

        async fn delete_triggers_by_module_id(&self, _module_id: &str) -> Result<()> {
            self.record("delete_triggers_by_module_id")
        }

        async fn delete_actions_by_module_id(&self, _module_id: &str) -> Result<()> {
            self.record("delete_actions_by_module_id")
        }

        async fn delete_widgets_by_module_id(&self, _module_id: &str) -> Result<()> {
            self.record("delete_widgets_by_module_id")
        }

        async fn delete_background_tasks_by_module_id(&self, _module_id: &str) -> Result<()> {
            self.record("delete_background_tasks_by_module_id")
        }

        async fn delete_workflows_by_module(&self, _application_id: &str, _module_name: &str) -> Result<()> {
            self.record("delete_workflows_by_module")
        }

        async fn delete_commands_by_module(&self, _module_name: &str) -> Result<()> {
            self.record("delete_commands_by_module")
        }

        async fn create_module_resource(
            &self,
            _module_id: &str,
            _resource_type: &str,
            _resource_id: &str,
            _manifest_id: &str,
            _resource_name: &str,
            _version: &str,
        ) -> Result<()> {
            self.record("create_module_resource")
        }

        async fn archive_resource_by_manifest_id(
            &self,
            _module_id: &str,
            _resource_type: &str,
            _manifest_id: &str,
        ) -> Result<()> {
            self.record("archive_resource_by_manifest_id")
        }

        async fn delete_resource_by_manifest_id(
            &self,
            _module_id: &str,
            _resource_type: &str,
            _manifest_id: &str,
        ) -> Result<()> {
            self.record("delete_resource_by_manifest_id")
        }

        async fn get_trigger_event_by_canonical_id(&self, _canonical_id: &str) -> Result<String> {
            self.record("get_trigger_event_by_canonical_id")?;
            Ok("fake.trigger.event".to_string())
        }

        async fn get_action_ref_by_canonical_id(&self, _canonical_id: &str) -> Result<ResolvedActionRef> {
            self.record("get_action_ref_by_canonical_id")?;
            Ok(ResolvedActionRef {
                action_type: "function".to_string(),
                function_call: Some("fake:function:fake".to_string()),
            })
        }
    }

    #[tokio::test]
    async fn records_calls_in_order() {
        let client = FakeDbProxyClient::new();
        client
            .create_module("", "mod", "1.0.0", "{}", "archives/mod.zip", &[], "mod:1.0.0:abc", "")
            .await
            .expect("create_module");
        client.register_triggers("mod", "Mod", "1.0.0", vec![], "").await.expect("register_triggers");

        assert_eq!(client.calls(), vec!["create_module", "register_triggers"]);
    }

    #[tokio::test]
    async fn fails_only_the_configured_call() {
        let client = FakeDbProxyClient::failing_on(["register_actions"]);
        client.register_triggers("mod", "Mod", "1.0.0", vec![], "").await.expect("register_triggers should succeed");
        let err = client
            .register_actions("mod", "Mod", "1.0.0", vec![], "")
            .await
            .expect_err("register_actions should fail");
        assert!(err.to_string().contains("register_actions"));
        assert_eq!(client.calls(), vec!["register_triggers", "register_actions"]);
    }
}
