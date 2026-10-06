use crate::error::Error;
use crate::models::function::Function;
use std::collections::{HashMap, HashSet};
use std::sync::RwLock;

#[derive(Debug, Clone)]
pub struct ModuleMetadata {
    pub name: String,
    pub version: String,
    pub installed_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone)]
pub enum ModuleState {
    Active,
    Disabled,
}

#[derive(Debug, Clone)]
pub struct RegisteredModule {
    pub metadata: ModuleMetadata,
    pub functions: HashMap<String, Function>,
    pub state: ModuleState,
    /// The `event` of every eventbus trigger the module declares: the only
    /// event types its functions may ask the engine to publish.
    pub event_types: HashSet<String>,
    /// The manifest's `permissions`: the privileged host functions this
    /// module's code may call. See `crate::permissions`.
    pub permissions: HashSet<String>,
    /// The ids of the module's `url` settings, whose values' origins
    /// `ctx.http` may reach. See `crate::net`.
    pub url_settings: HashSet<String>,
    /// The OAuth providers the module's code calls through `ctx.oauth`.
    pub oauth: Vec<crate::oauth::OAuthIntegration>,
    /// Manifest-local action id to the manifest-local id of the function it
    /// runs, for every `type: "function"` action: how `ctx.resources.run`
    /// finds the code behind a resource kind's actions.
    pub actions: HashMap<String, String>,
}

pub struct ModuleRegistry {
    modules: RwLock<HashMap<String, RegisteredModule>>,
}

impl ModuleRegistry {
    pub fn new() -> Self {
        Self {
            modules: RwLock::new(HashMap::new()),
        }
    }

    /// Resolve a function by its canonical id
    /// (`{moduleId}:function:{manifest_id}`). The middle segment must
    /// be the literal `function` keyword — this matches the canonical
    /// id format documented in `docs/barkloader/modules.md`. Modules
    /// are keyed in the in-memory registry by `moduleId`; functions
    /// within a module are keyed by their manifest_id.
    pub fn get_function(&self, path: &str) -> Result<Function, Error> {
        let parts: Vec<&str> = path.split(':').collect();
        if parts.len() != 3 || parts[1] != "function" || parts[0].is_empty() || parts[2].is_empty()
        {
            return Err(Error::InvalidFunctionPath(path.to_string()));
        }

        let module_name = parts[0];
        let function_name = parts[2];

        let modules = self.modules.read().unwrap();
        let module = modules
            .get(module_name)
            .ok_or_else(|| Error::ModuleNotFound(module_name.to_string()))?;

        if matches!(module.state, ModuleState::Disabled) {
            return Err(Error::ModuleDisabled(module_name.to_string()));
        }

        module
            .functions
            .get(function_name)
            .cloned()
            .ok_or_else(|| Error::FunctionNotFound(function_name.to_string()))
    }

    pub fn register_module(&self, name: String, module: RegisteredModule) -> Result<(), Error> {
        let mut modules = self.modules.write().unwrap();
        modules.insert(name, module);
        Ok(())
    }

    pub fn unregister_module(&self, name: &str) -> Result<(), Error> {
        let mut modules = self.modules.write().unwrap();
        modules
            .remove(name)
            .ok_or_else(|| Error::ModuleNotFound(name.to_string()))?;
        Ok(())
    }

    pub fn update_module(&self, name: String, module: RegisteredModule) -> Result<(), Error> {
        let mut modules = self.modules.write().unwrap();
        if !modules.contains_key(&name) {
            return Err(Error::ModuleNotFound(name));
        }
        modules.insert(name, module);
        Ok(())
    }

    pub fn set_module_state(&self, name: &str, state: ModuleState) -> Result<(), Error> {
        let mut modules = self.modules.write().unwrap();
        let module = modules
            .get_mut(name)
            .ok_or_else(|| Error::ModuleNotFound(name.to_string()))?;
        module.state = state;
        Ok(())
    }

    pub fn list_modules(&self) -> Vec<ModuleMetadata> {
        let modules = self.modules.read().unwrap();
        modules.values().map(|m| m.metadata.clone()).collect()
    }

    pub fn list_registered_modules(&self) -> Vec<RegisteredModule> {
        let modules = self.modules.read().unwrap();
        modules.values().cloned().collect()
    }

    pub fn has_module(&self, name: &str) -> bool {
        let modules = self.modules.read().unwrap();
        modules.contains_key(name)
    }

    pub fn get_module_metadata(&self, name: &str) -> Option<ModuleMetadata> {
        let modules = self.modules.read().unwrap();
        modules.get(name).map(|m| m.metadata.clone())
    }

    /// The event types the module's functions may publish; none for a module
    /// that is not registered.
    pub fn event_types(&self, name: &str) -> HashSet<String> {
        let modules = self.modules.read().unwrap();
        modules
            .get(name)
            .map(|m| m.event_types.clone())
            .unwrap_or_default()
    }

    /// The permissions the module declares; none for a module that is not
    /// registered.
    pub fn permissions(&self, name: &str) -> HashSet<String> {
        let modules = self.modules.read().unwrap();
        modules
            .get(name)
            .map(|m| m.permissions.clone())
            .unwrap_or_default()
    }

    /// The module's OAuth integration `id`, if it declares one.
    pub fn oauth_integration(
        &self,
        name: &str,
        id: &str,
    ) -> Option<crate::oauth::OAuthIntegration> {
        let modules = self.modules.read().unwrap();
        modules.get(name).and_then(|m| {
            m.oauth
                .iter()
                .find(|integration| integration.id == id)
                .cloned()
        })
    }

    /// The ids of the module's `url` settings; none for a module that is not
    /// registered.
    /// The function a module's action runs, as a manifest-local function id;
    /// `None` for an unknown module or action, or one that is not a function.
    pub fn action_function(&self, module: &str, action: &str) -> Option<String> {
        let modules = self.modules.read().unwrap();
        modules.get(module)?.actions.get(action).cloned()
    }

    pub fn url_settings(&self, name: &str) -> HashSet<String> {
        let modules = self.modules.read().unwrap();
        modules
            .get(name)
            .map(|m| m.url_settings.clone())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_module(name: &str) -> RegisteredModule {
        let mut functions = HashMap::new();
        functions.insert(
            "hello".to_string(),
            Function {
                name: "hello".to_string(),
                file_name: "hello.js".to_string(),
                code: "function main(ctx) { return {}; }".to_string(),
                is_trusted: false,
                entry_point: None,
            },
        );

        RegisteredModule {
            actions: Default::default(),
            metadata: ModuleMetadata {
                name: name.to_string(),
                version: "1.0.0".to_string(),
                installed_at: 0,
                updated_at: 0,
            },
            functions,
            state: ModuleState::Active,
            event_types: Default::default(),
            permissions: Default::default(),
            url_settings: Default::default(),
            oauth: Default::default(),
        }
    }

    #[test]
    fn test_register_and_get_function() {
        let registry = ModuleRegistry::new();
        registry
            .register_module("example".to_string(), test_module("example"))
            .unwrap();

        let function = registry.get_function("example:function:hello").unwrap();
        assert_eq!(function.name, "hello");
    }

    #[test]
    fn test_unregister_module() {
        let registry = ModuleRegistry::new();
        registry
            .register_module("example".to_string(), test_module("example"))
            .unwrap();
        assert!(registry.has_module("example"));

        registry.unregister_module("example").unwrap();
        assert!(!registry.has_module("example"));
    }

    #[test]
    fn test_disabled_module_rejected() {
        let registry = ModuleRegistry::new();
        registry
            .register_module("example".to_string(), test_module("example"))
            .unwrap();
        registry
            .set_module_state("example", ModuleState::Disabled)
            .unwrap();

        let result = registry.get_function("example:function:hello");
        assert!(matches!(result, Err(Error::ModuleDisabled(_))));
    }

    #[test]
    fn test_list_modules() {
        let registry = ModuleRegistry::new();
        registry
            .register_module("a".to_string(), test_module("a"))
            .unwrap();
        registry
            .register_module("b".to_string(), test_module("b"))
            .unwrap();

        let list = registry.list_modules();
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn test_update_module() {
        let registry = ModuleRegistry::new();
        registry
            .register_module("example".to_string(), test_module("example"))
            .unwrap();

        let mut updated = test_module("example");
        updated.metadata.version = "2.0.0".to_string();
        registry
            .update_module("example".to_string(), updated)
            .unwrap();

        let list = registry.list_modules();
        let meta = list.iter().find(|m| m.name == "example").unwrap();
        assert_eq!(meta.version, "2.0.0");
    }

    #[test]
    fn test_update_nonexistent_module() {
        let registry = ModuleRegistry::new();
        let result = registry.update_module("nonexistent".to_string(), test_module("nonexistent"));
        assert!(matches!(result, Err(Error::ModuleNotFound(_))));
    }

    #[test]
    fn test_invalid_function_path() {
        let registry = ModuleRegistry::new();
        let result = registry.get_function("invalid_path");
        assert!(matches!(result, Err(Error::InvalidFunctionPath(_))));
    }
}
