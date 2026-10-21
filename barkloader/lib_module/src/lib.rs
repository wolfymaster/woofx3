//! Module install/delete pipeline, manifest parsing, and db-proxy helpers
//! for barkloader.

pub mod canonical_id;
pub mod cron_schedule;
pub mod db_proxy;
pub mod db_proxy_client;
pub mod local_endpoint;
pub mod manifest_validate;
pub mod module_delete;
mod module_file;
mod module_install;
pub mod module_manifest;
mod module_plan;
mod module_service;
pub mod registry_loader;
mod reserved_subjects;
pub mod resource_kind_ref;
pub mod theme;

pub use db_proxy::MarketplaceOrigin;
pub use manifest_validate::{InstallProvenance, SystemOnlyActions};
pub use module_file::ModuleFileKind;
pub use module_service::{ModuleService, ModuleServiceConfig, manifest_file_rank};
pub use registry_loader::{ModuleSchedule, ScheduleRegistrar};
