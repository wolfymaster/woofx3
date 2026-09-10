//! Module install/delete pipeline, manifest parsing, and db-proxy helpers
//! for barkloader.

pub mod canonical_id;
pub mod cron_schedule;
pub mod db_proxy;
pub mod db_proxy_client;
pub mod manifest_validate;
pub mod module_delete;
mod module_file;
mod module_install;
pub mod module_manifest;
mod module_plan;
pub mod registry_loader;
mod module_service;

pub use manifest_validate::InstallProvenance;
pub use module_file::ModuleFileKind;
pub use module_service::{ModuleService, ModuleServiceConfig};
pub use registry_loader::BackgroundTaskRegistrar;
