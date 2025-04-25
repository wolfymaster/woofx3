use crate::error::Error;
use crate::models::function::Function;
use crate::models::module::Module;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

pub struct ModuleManager {
    modules_dir: PathBuf,
    loaded_modules: HashMap<String, Module>,
}

impl ModuleManager {
    pub fn new(modules_dir: PathBuf) -> Result<Self, Error> {
        let mut manager = Self {
            modules_dir,
            loaded_modules: HashMap::new(),
        };
        
        manager.scan_modules()?;
        Ok(manager)
    }
    
    fn scan_modules(&mut self) -> Result<(), Error> {
        if !self.modules_dir.exists() {
            return Err(Error::ModulesDirNotFound);
        }

        for entry in fs::read_dir(&self.modules_dir)? {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_dir() {
                let module_name = path.file_name()
                    .and_then(|name| name.to_str())
                    .ok_or(Error::InvalidModuleName)?
                    .to_string();
                
                let module = Module::from_directory(&path, &module_name)?;
                self.loaded_modules.insert(module_name, module);
            }
        }
        
        Ok(())
    }
    
    pub fn get_function(&self, function_path: &str) -> Result<(Module, Function), Error> {
        let parts: Vec<&str> = function_path.split('/').collect();
        if parts.len() != 2 {
            return Err(Error::InvalidFunctionPath(function_path.to_string()));
        }
        
        let module_name = parts[0];
        let function_name = parts[1];
        
        let module = self.loaded_modules.get(module_name)
            .ok_or_else(|| Error::ModuleNotFound(module_name.to_string()))?;
        
        let function = module.get_function(function_name)?;
        
        Ok((module.clone(), function))
    }
}