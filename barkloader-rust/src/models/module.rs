use crate::error::Error;
use crate::models::function::Function;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Module {
    pub name: String,
    pub path: PathBuf,
    functions: HashMap<String, Function>,
}

impl Module {
    pub fn from_directory(path: &Path, name: &str) -> Result<Self, Error> {
        let mut module = Self {
            name: name.to_string(),
            path: path.to_path_buf(),
            functions: HashMap::new(),
        };
        
        module.load_functions()?;
        
        Ok(module)
    }
    
    fn load_functions(&mut self) -> Result<(), Error> {
        for entry in fs::read_dir(&self.path)? {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_file() {
                let function_name = path
                    .file_stem()
                    .and_then(|name| name.to_str())
                    .ok_or(Error::InvalidFunctionName)?
                    .to_string();
                
                // Default to untrusted for MVP
                let is_trusted = false;
                
                let function = Function::from_file(&path, &function_name, is_trusted)?;
                self.functions.insert(function_name, function);
            }
        }
        
        Ok(())
    }
    
    pub fn get_function(&self, name: &str) -> Result<Function, Error> {
        self.functions
            .get(name)
            .cloned()
            .ok_or_else(|| Error::FunctionNotFound(name.to_string()))
    }
    
    pub fn post_process(&self, result: Value) -> Result<Value, Error> {
        // For MVP, just pass through the result
        // In a more complex implementation, this would apply module-specific transformations
        Ok(result)
    }
}