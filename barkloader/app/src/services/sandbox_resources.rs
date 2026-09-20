//! Production `ResourceClient` impl for sandbox runtimes. Bridges the
//! synchronous trait surface that JS/Lua functions see (`ctx.resources.*`)
//! to the async Twirp client functions in `lib_module::db_proxy`.
//!
//! Like `GrpcStorageClient`, all calls block on the current Tokio runtime
//! handle — barkloader runs under actix-web, which provides a multi-thread
//! runtime, so this is safe even though the function executor itself runs
//! synchronously.

use lib_module::db_proxy::{self, RequestContext as DbRequestContext, ResourceInstanceJson};
use lib_sandbox::host::{ResourceClient, ResourceInstance};
use serde_json::Value;
use std::sync::Arc;
use tokio::runtime::Handle;

pub struct HttpResourceClient {
    db_proxy_url: String,
    request_context: Option<Arc<DbRequestContext>>,
}

impl HttpResourceClient {
    pub fn new(db_proxy_url: String) -> Self {
        Self {
            db_proxy_url,
            request_context: None,
        }
    }

    /// Bind a default `RequestContext` (client_id / application_id /
    /// module_key) that travels with every call. Today the sandbox
    /// invocations don't have a per-call context distinct from the engine
    /// instance's own, so a single bound value covers it.
    pub fn with_request_context(mut self, ctx: DbRequestContext) -> Self {
        self.request_context = Some(Arc::new(ctx));
        self
    }
}

fn from_json(j: ResourceInstanceJson) -> ResourceInstance {
    // The engine only ever stores an object here; an unreadable one reads as
    // no settings rather than failing the function that asked.
    let settings = serde_json::from_str(&j.settings_json)
        .ok()
        .filter(Value::is_object)
        .unwrap_or_else(|| Value::Object(Default::default()));
    ResourceInstance {
        canonical_id: j.canonical_id,
        module_name: j.module_name,
        kind: j.kind,
        instance_id: j.instance_id,
        display_name: j.display_name,
        settings,
    }
}

impl ResourceClient for HttpResourceClient {
    fn create(
        &self,
        owning_module_name: &str,
        kind: &str,
        instance_id: &str,
        display_name: &str,
        settings: &Value,
    ) -> Result<ResourceInstance, String> {
        let url = self.db_proxy_url.clone();
        let settings_json = serde_json::to_string(settings).map_err(|e| e.to_string())?;
        let module_name = owning_module_name.to_string();
        let kind = kind.to_string();
        let instance_id = instance_id.to_string();
        let display_name = display_name.to_string();
        let req_ctx = self.request_context.clone();
        Handle::current()
            .block_on(async move {
                db_proxy::create_resource_instance(
                    &url,
                    "",
                    &module_name,
                    &kind,
                    &instance_id,
                    &display_name,
                    &settings_json,
                    req_ctx.as_deref(),
                )
                .await
            })
            .map(from_json)
            .map_err(|e| e.to_string())
    }

    fn delete(&self, canonical_id: &str) -> Result<(), String> {
        let url = self.db_proxy_url.clone();
        let cid = canonical_id.to_string();
        let req_ctx = self.request_context.clone();
        Handle::current()
            .block_on(async move {
                db_proxy::delete_resource_instance(&url, &cid, req_ctx.as_deref()).await
            })
            .map_err(|e| e.to_string())
    }

    fn get(&self, canonical_id: &str) -> Result<Option<ResourceInstance>, String> {
        let url = self.db_proxy_url.clone();
        let canonical_id = canonical_id.to_string();
        Handle::current()
            .block_on(async move { db_proxy::get_resource_instance(&url, &canonical_id).await })
            .map(|found| found.map(from_json))
            .map_err(|e| e.to_string())
    }

    fn list_by_kind(&self, kind: &str) -> Result<Vec<ResourceInstance>, String> {
        let url = self.db_proxy_url.clone();
        let kind = kind.to_string();
        Handle::current()
            .block_on(async move { db_proxy::list_resource_instances_by_kind(&url, &kind).await })
            .map(|items| items.into_iter().map(from_json).collect())
            .map_err(|e| e.to_string())
    }
}
