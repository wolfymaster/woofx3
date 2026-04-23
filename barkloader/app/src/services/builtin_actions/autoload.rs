// Compile-time built-in actions (the REGISTRY slice) must appear in the
// shared actions table so the workflow engine can resolve them by id the
// same way it resolves module-provided actions. We register them at
// barkloader startup under the SYSTEM:builtin (created_by_type,
// created_by_ref) pair. The db-proxy upserts on
// (created_by_type, created_by_ref, name), so repeated startups are
// idempotent — the row is created on first boot and refreshed on each
// subsequent boot.

use super::REGISTRY;
use crate::services::module_service::db_proxy::{register_actions_with, ActionInputJson};
use anyhow::Context;
use log::info;

const CREATED_BY_TYPE: &str = "SYSTEM";
const CREATED_BY_REF: &str = "builtin";

/// Register all compile-time built-in actions with the DB proxy. Safe to
/// call on every startup — the upsert on
/// (created_by_type, created_by_ref, name) means this is idempotent.
pub async fn register_builtin_actions(db_proxy_url: &str) -> anyhow::Result<()> {
    if REGISTRY.is_empty() {
        return Ok(());
    }

    let actions: Vec<ActionInputJson> = REGISTRY
        .iter()
        .map(|a| ActionInputJson {
            name: a.name.to_string(),
            description: a.description.to_string(),
            call: format!("builtin:{}", a.name),
            params_schema: a.params_schema.to_string(),
        })
        .collect();

    info!(
        "Registering {} builtin action(s) with db-proxy at {}",
        actions.len(),
        db_proxy_url
    );

    register_actions_with(
        db_proxy_url,
        // module_key/module_name/version are unused for SYSTEM registrations
        // because the override disables the MODULE fallback in the db-proxy.
        "",
        "barkloader-builtin",
        env!("CARGO_PKG_VERSION"),
        actions,
        CREATED_BY_TYPE,
        CREATED_BY_REF,
    )
    .await
    .context("register builtin actions")?;

    Ok(())
}
