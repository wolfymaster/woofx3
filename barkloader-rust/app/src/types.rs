use std::path::{Path, PathBuf};
use anyhow::Result;

use lib_repository::{RepositoryImpl};
use lib_sandbox::SandboxFactory;

use crate::util;

 #[allow(dead_code)]
#[derive(Clone)]
pub struct AppContext {
    pub repository: RepositoryImpl,
    pub sandbox: SandboxFactory,
}

pub struct SafeTempDir {
    path: PathBuf,
    allowed_parent: PathBuf,
}

impl SafeTempDir {
    pub fn new<P: AsRef<Path>>(path: P, allowed_parent: P) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        let allowed_parent = allowed_parent.as_ref().to_path_buf();
        
        Ok(SafeTempDir {
            path,
            allowed_parent,
        })
    }
}

impl Drop for SafeTempDir {
    fn drop(&mut self) {
        if let Err(e) = util::safe_remove_dir_all(&self.path, &self.allowed_parent) {
            eprintln!("Failed to cleanup temporary directory: {}", e);
        }
    }
}
