use super::module_manifest::ModuleManifest;

/// Retained for API compatibility with `create_plan` / `execute_plan`.
/// Install work is performed by [`super::module_install::run_install`].
#[derive(Clone)]
pub struct ModulePlan {
    _manifest: Option<ModuleManifest>,
}

impl ModulePlan {
    pub fn new(maybe_manifest: Option<ModuleManifest>) -> Self {
        Self {
            _manifest: maybe_manifest,
        }
    }
}
