//! A narrow, injectable seam over the db-proxy calls the module install,
//! delete, and HTTP-facing route paths make, replacing direct calls into
//! the free-function `db_proxy` module with a small trait those callers
//! depend on instead. `HttpDbProxyClient` delegates to the existing
//! `db_proxy` functions unchanged; `FakeDbProxyClient` (test-only) lets
//! install/delete tests fault-inject at any step without a live db-proxy.
//!
//! Scoped to the calls `module_install.rs`, `module_delete.rs`, and the
//! `barkloader` app's `routes/functions.rs` / `routes/widgets.rs` actually
//! make — not the full `db_proxy` surface. A handful of internal-service
//! callers (`main.rs`, `sandbox_resources.rs`, `module_settings_client.rs`,
//! `http_storage_client.rs`, `registry_loader.rs`) still call `db_proxy::`
//! directly; widening this seam to cover those too is a separate, lower-
//! urgency change (they aren't HTTP-facing, so a wire-format bug there
//! doesn't reach a caller directly).

use anyhow::{Result, anyhow};
use async_trait::async_trait;

use super::manifest_validate::InstallProvenance;

use super::db_proxy::{
    self, ActionInputJson, AssetInputJson, BackgroundTaskInputJson, CreateModuleFunctionJson,
    ModuleRecord, RequestContext, ResolvedActionRef, ResourceInstanceJson, ResourceUsage,
    SettingInputJson, TriggerInputJson, WidgetInputJson,
};

#[async_trait]
pub trait ModuleDbProxy: Send + Sync {
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
        provenance: InstallProvenance,
    ) -> Result<String>;
    async fn delete_module(&self, module_name: &str) -> Result<()>;
    async fn get_module_by_module_id(&self, module_id: &str) -> Result<Option<String>>;
    async fn get_module_by_name(&self, name: &str) -> Result<Option<String>>;

    // bulk registration (one call per kind, matching today's batching)
    async fn register_triggers(
        &self,
        module_id: &str,
        module_key: &str,
        module_name: &str,
        version: &str,
        triggers: Vec<TriggerInputJson>,
        application_id: &str,
    ) -> Result<()>;
    async fn register_actions(
        &self,
        module_id: &str,
        module_key: &str,
        module_name: &str,
        version: &str,
        actions: Vec<ActionInputJson>,
        application_id: &str,
    ) -> Result<()>;
    async fn register_widgets(
        &self,
        module_id: &str,
        module_key: &str,
        module_name: &str,
        version: &str,
        widgets: Vec<WidgetInputJson>,
        application_id: &str,
    ) -> Result<()>;
    async fn register_background_tasks(
        &self,
        module_id: &str,
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
        module_id: &str,
        module_key: &str,
        module_name: &str,
        version: &str,
        assets: Vec<AssetInputJson>,
    ) -> Result<()>;

    // cleanup / delete-by-module-id (used by cleanup_old_version and rollback)
    async fn delete_triggers_by_module_id(&self, module_id: &str, module_key: &str) -> Result<()>;
    async fn delete_actions_by_module_id(&self, module_id: &str, module_key: &str) -> Result<()>;
    async fn delete_widgets_by_module_id(&self, module_id: &str, module_key: &str) -> Result<()>;
    async fn delete_background_tasks_by_module_id(
        &self,
        module_id: &str,
        module_key: &str,
    ) -> Result<()>;
    async fn delete_workflows_by_module(
        &self,
        application_id: &str,
        module_name: &str,
    ) -> Result<()>;
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
    async fn get_action_ref_by_canonical_id(&self, canonical_id: &str)
    -> Result<ResolvedActionRef>;

    // module deletion (module_delete.rs)
    async fn delete_module_resources(&self, module_id: &str) -> Result<()>;
    async fn check_module_resource_usage(
        &self,
        module_id: &str,
        application_id: &str,
    ) -> Result<Vec<ResourceUsage>>;
    async fn list_resource_instances_by_module(
        &self,
        module_id: &str,
    ) -> Result<Vec<ResourceInstanceJson>>;
    async fn complete_module_delete(
        &self,
        module_id: &str,
        module_name: &str,
        status: &str,
        error_msg: &str,
        in_use: &[ResourceUsage],
        request_context: Option<&RequestContext>,
    ) -> Result<()>;

    // bundled workflow / command registration (module_manifest.rs's
    // ManifestWorkflow::register / ManifestCommand::register). Callers
    // build the wire-shaped request the same way they build every other
    // *InputJson here; this method owns the actual client call plus
    // status-code check, matching every other method's contract of
    // "returns Err for both transport and application failures."
    async fn register_workflow(
        &self,
        request: woofx3::db::workflow::CreateWorkflowRequest,
    ) -> Result<()>;
    async fn register_command(
        &self,
        application_id: &str,
        command: &str,
        command_type: &str,
        type_value: &str,
        module_name: &str,
    ) -> Result<()>;

    // install-status notification + read queries the HTTP routes need
    // (routes/functions.rs, routes/widgets.rs)
    async fn complete_module_install(
        &self,
        module_id: &str,
        module_name: &str,
        version: &str,
        status: &str,
        error_msg: &str,
        request_context: Option<&RequestContext>,
    ) -> Result<()>;
    async fn fetch_module_by_name(&self, name: &str) -> Result<Option<ModuleRecord>>;
    async fn get_widget_entry(&self, module_id: &str, manifest_id: &str) -> Result<Option<String>>;
    async fn resolve_module_version_dir(&self, module_id: &str) -> Result<Option<String>>;
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
        provenance: InstallProvenance,
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
            provenance,
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
        module_id: &str,
        module_key: &str,
        module_name: &str,
        version: &str,
        triggers: Vec<TriggerInputJson>,
        application_id: &str,
    ) -> Result<()> {
        db_proxy::register_triggers(
            &self.base_url,
            module_id,
            module_key,
            module_name,
            version,
            triggers,
            application_id,
        )
        .await
    }

    async fn register_actions(
        &self,
        module_id: &str,
        module_key: &str,
        module_name: &str,
        version: &str,
        actions: Vec<ActionInputJson>,
        application_id: &str,
    ) -> Result<()> {
        db_proxy::register_actions(
            &self.base_url,
            module_id,
            module_key,
            module_name,
            version,
            actions,
            application_id,
        )
        .await
    }

    async fn register_widgets(
        &self,
        module_id: &str,
        module_key: &str,
        module_name: &str,
        version: &str,
        widgets: Vec<WidgetInputJson>,
        application_id: &str,
    ) -> Result<()> {
        db_proxy::register_widgets(
            &self.base_url,
            module_id,
            module_key,
            module_name,
            version,
            widgets,
            application_id,
        )
        .await
    }

    async fn register_background_tasks(
        &self,
        module_id: &str,
        module_key: &str,
        module_name: &str,
        version: &str,
        tasks: Vec<BackgroundTaskInputJson>,
        application_id: &str,
    ) -> Result<()> {
        db_proxy::register_background_tasks(
            &self.base_url,
            module_id,
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
        module_id: &str,
        module_key: &str,
        module_name: &str,
        version: &str,
        assets: Vec<AssetInputJson>,
    ) -> Result<()> {
        db_proxy::register_assets(
            &self.base_url,
            module_id,
            module_key,
            module_name,
            version,
            assets,
        )
        .await
    }

    async fn delete_triggers_by_module_id(&self, module_id: &str, module_key: &str) -> Result<()> {
        db_proxy::delete_triggers_by_module_id(&self.base_url, module_id, module_key).await
    }

    async fn delete_actions_by_module_id(&self, module_id: &str, module_key: &str) -> Result<()> {
        db_proxy::delete_actions_by_module_id(&self.base_url, module_id, module_key).await
    }

    async fn delete_widgets_by_module_id(&self, module_id: &str, module_key: &str) -> Result<()> {
        db_proxy::delete_widgets_by_module_id(&self.base_url, module_id, module_key).await
    }

    async fn delete_background_tasks_by_module_id(
        &self,
        module_id: &str,
        module_key: &str,
    ) -> Result<()> {
        db_proxy::delete_background_tasks_by_module_id(&self.base_url, module_id, module_key).await
    }

    async fn delete_workflows_by_module(
        &self,
        application_id: &str,
        module_name: &str,
    ) -> Result<()> {
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
        db_proxy::archive_resource_by_manifest_id(
            &self.base_url,
            module_id,
            resource_type,
            manifest_id,
        )
        .await
    }

    async fn delete_resource_by_manifest_id(
        &self,
        module_id: &str,
        resource_type: &str,
        manifest_id: &str,
    ) -> Result<()> {
        db_proxy::delete_resource_by_manifest_id(
            &self.base_url,
            module_id,
            resource_type,
            manifest_id,
        )
        .await
    }

    async fn get_trigger_event_by_canonical_id(&self, canonical_id: &str) -> Result<String> {
        db_proxy::get_trigger_event_by_canonical_id(&self.base_url, canonical_id).await
    }

    async fn get_action_ref_by_canonical_id(
        &self,
        canonical_id: &str,
    ) -> Result<ResolvedActionRef> {
        db_proxy::get_action_ref_by_canonical_id(&self.base_url, canonical_id).await
    }

    async fn delete_module_resources(&self, module_id: &str) -> Result<()> {
        db_proxy::delete_module_resources(&self.base_url, module_id).await
    }

    async fn check_module_resource_usage(
        &self,
        module_id: &str,
        application_id: &str,
    ) -> Result<Vec<ResourceUsage>> {
        db_proxy::check_module_resource_usage(&self.base_url, module_id, application_id).await
    }

    async fn list_resource_instances_by_module(
        &self,
        module_id: &str,
    ) -> Result<Vec<ResourceInstanceJson>> {
        db_proxy::list_resource_instances_by_module(&self.base_url, module_id).await
    }

    async fn complete_module_delete(
        &self,
        module_id: &str,
        module_name: &str,
        status: &str,
        error_msg: &str,
        in_use: &[ResourceUsage],
        request_context: Option<&RequestContext>,
    ) -> Result<()> {
        db_proxy::complete_module_delete(
            &self.base_url,
            module_id,
            module_name,
            status,
            error_msg,
            in_use,
            request_context,
        )
        .await
    }

    async fn register_workflow(
        &self,
        request: woofx3::db::workflow::CreateWorkflowRequest,
    ) -> Result<()> {
        let client = woofx3_twirp::WorkflowServiceClient::new(&self.base_url);
        let response = client
            .create_workflow(request)
            .await
            .map_err(|e| anyhow!("CreateWorkflow request failed: {}", e))?;
        if let Some(status) = response.status {
            if status.code != 0 {
                return Err(anyhow!("CreateWorkflow failed: {}", status.message));
            }
        }
        Ok(())
    }

    async fn register_command(
        &self,
        application_id: &str,
        command: &str,
        command_type: &str,
        type_value: &str,
        module_name: &str,
    ) -> Result<()> {
        db_proxy::create_command(
            &self.base_url,
            application_id,
            command,
            command_type,
            type_value,
            module_name,
        )
        .await
    }

    async fn complete_module_install(
        &self,
        module_id: &str,
        module_name: &str,
        version: &str,
        status: &str,
        error_msg: &str,
        request_context: Option<&RequestContext>,
    ) -> Result<()> {
        db_proxy::complete_module_install(
            &self.base_url,
            module_id,
            module_name,
            version,
            status,
            error_msg,
            request_context,
        )
        .await
    }

    async fn fetch_module_by_name(&self, name: &str) -> Result<Option<ModuleRecord>> {
        db_proxy::fetch_module_by_name(&self.base_url, name).await
    }

    async fn get_widget_entry(&self, module_id: &str, manifest_id: &str) -> Result<Option<String>> {
        db_proxy::get_widget_entry(&self.base_url, module_id, manifest_id).await
    }

    async fn resolve_module_version_dir(&self, module_id: &str) -> Result<Option<String>> {
        db_proxy::resolve_module_version_dir(&self.base_url, module_id).await
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
        /// Provenance the last `create_module` was called with, so tests can
        /// assert what the module row would be stamped with.
        provenance: Mutex<Option<InstallProvenance>>,
    }

    impl FakeDbProxyClient {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn failing_on(methods: impl IntoIterator<Item = &'static str>) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                fail_on: methods.into_iter().collect(),
                provenance: Mutex::new(None),
            }
        }

        pub fn calls(&self) -> Vec<String> {
            self.calls.lock().expect("calls mutex poisoned").clone()
        }

        pub fn create_module_provenance(&self) -> Option<InstallProvenance> {
            *self.provenance.lock().expect("provenance mutex poisoned")
        }

        fn record(&self, method: &'static str) -> Result<()> {
            self.calls
                .lock()
                .expect("calls mutex poisoned")
                .push(method.to_string());
            if self.fail_on.contains(method) {
                return Err(anyhow!("FakeDbProxyClient: injected failure at {}", method));
            }
            Ok(())
        }
    }

    #[async_trait]
    impl ModuleDbProxy for FakeDbProxyClient {
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
            provenance: InstallProvenance,
        ) -> Result<String> {
            self.record("create_module")?;
            self.provenance
                .lock()
                .expect("provenance mutex poisoned")
                .replace(provenance);
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
            _module_id: &str,
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
            _module_id: &str,
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
            _module_id: &str,
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
            _module_id: &str,
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
            _module_id: &str,
            _module_key: &str,
            _module_name: &str,
            _version: &str,
            _assets: Vec<AssetInputJson>,
        ) -> Result<()> {
            self.record("register_assets")
        }

        async fn delete_triggers_by_module_id(
            &self,
            _module_id: &str,
            _module_key: &str,
        ) -> Result<()> {
            self.record("delete_triggers_by_module_id")
        }

        async fn delete_actions_by_module_id(
            &self,
            _module_id: &str,
            _module_key: &str,
        ) -> Result<()> {
            self.record("delete_actions_by_module_id")
        }

        async fn delete_widgets_by_module_id(
            &self,
            _module_id: &str,
            _module_key: &str,
        ) -> Result<()> {
            self.record("delete_widgets_by_module_id")
        }

        async fn delete_background_tasks_by_module_id(
            &self,
            _module_id: &str,
            _module_key: &str,
        ) -> Result<()> {
            self.record("delete_background_tasks_by_module_id")
        }

        async fn delete_workflows_by_module(
            &self,
            _application_id: &str,
            _module_name: &str,
        ) -> Result<()> {
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

        async fn get_action_ref_by_canonical_id(
            &self,
            _canonical_id: &str,
        ) -> Result<ResolvedActionRef> {
            self.record("get_action_ref_by_canonical_id")?;
            Ok(ResolvedActionRef {
                action_type: "function".to_string(),
                function_call: Some("fake:function:fake".to_string()),
            })
        }

        async fn delete_module_resources(&self, _module_id: &str) -> Result<()> {
            self.record("delete_module_resources")
        }

        async fn check_module_resource_usage(
            &self,
            _module_id: &str,
            _application_id: &str,
        ) -> Result<Vec<ResourceUsage>> {
            self.record("check_module_resource_usage")?;
            Ok(Vec::new())
        }

        async fn list_resource_instances_by_module(
            &self,
            _module_id: &str,
        ) -> Result<Vec<ResourceInstanceJson>> {
            self.record("list_resource_instances_by_module")?;
            Ok(Vec::new())
        }

        async fn complete_module_delete(
            &self,
            _module_id: &str,
            _module_name: &str,
            _status: &str,
            _error_msg: &str,
            _in_use: &[ResourceUsage],
            _request_context: Option<&RequestContext>,
        ) -> Result<()> {
            self.record("complete_module_delete")
        }

        async fn register_workflow(
            &self,
            _request: woofx3::db::workflow::CreateWorkflowRequest,
        ) -> Result<()> {
            self.record("register_workflow")
        }

        async fn register_command(
            &self,
            _application_id: &str,
            _command: &str,
            _command_type: &str,
            _type_value: &str,
            _module_name: &str,
        ) -> Result<()> {
            self.record("register_command")
        }

        async fn complete_module_install(
            &self,
            _module_id: &str,
            _module_name: &str,
            _version: &str,
            _status: &str,
            _error_msg: &str,
            _request_context: Option<&RequestContext>,
        ) -> Result<()> {
            self.record("complete_module_install")
        }

        async fn fetch_module_by_name(&self, _name: &str) -> Result<Option<ModuleRecord>> {
            self.record("fetch_module_by_name")?;
            Ok(None)
        }

        async fn get_widget_entry(
            &self,
            _module_id: &str,
            _manifest_id: &str,
        ) -> Result<Option<String>> {
            self.record("get_widget_entry")?;
            Ok(None)
        }

        async fn resolve_module_version_dir(&self, _module_id: &str) -> Result<Option<String>> {
            self.record("resolve_module_version_dir")?;
            Ok(None)
        }
    }

    #[tokio::test]
    async fn records_calls_in_order() {
        let client = FakeDbProxyClient::new();
        client
            .create_module(
                "",
                "mod",
                "1.0.0",
                "{}",
                "archives/mod.zip",
                &[],
                "mod:1.0.0:abc",
                "",
                InstallProvenance::User,
            )
            .await
            .expect("create_module");
        client
            .register_triggers("mod", "mod:1.0.0:abc", "Mod", "1.0.0", vec![], "")
            .await
            .expect("register_triggers");

        assert_eq!(client.calls(), vec!["create_module", "register_triggers"]);
    }

    #[tokio::test]
    async fn fails_only_the_configured_call() {
        let client = FakeDbProxyClient::failing_on(["register_actions"]);
        client
            .register_triggers("mod", "mod:1.0.0:abc", "Mod", "1.0.0", vec![], "")
            .await
            .expect("register_triggers should succeed");
        let err = client
            .register_actions("mod", "mod:1.0.0:abc", "Mod", "1.0.0", vec![], "")
            .await
            .expect_err("register_actions should fail");
        assert!(err.to_string().contains("register_actions"));
        assert_eq!(
            client.calls(),
            vec!["register_triggers", "register_actions"]
        );
    }
}
