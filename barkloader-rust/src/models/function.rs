use crate::error::Error;
use std::path::{Path, PathBuf};
use std::fs;

#[derive(Debug, Clone)]
pub struct Function {
    pub name: String,
    pub path: PathBuf,
    pub code: String,
    pub is_trusted: bool,
}

impl Function {
    pub fn from_file(path: &Path, name: &str, is_trusted: bool) -> Result<Self, Error> {
        if !path.exists() {
            return Err(Error::FunctionNotFound(name.to_string()));
        }
        
        let code = fs::read_to_string(path)?;
        
        Ok(Self {
            name: name.to_string(),
            path: path.to_path_buf(),
            code,
            is_trusted,
        })
    }
    
    pub fn get_extension(&self) -> Option<String> {
        self.path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_string())
    }
}