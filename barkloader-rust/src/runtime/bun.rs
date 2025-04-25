use crate::error::Error;
use crate::runtime::RuntimeAdapter;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;
use tempfile::TempDir;
use tokio::time::timeout;

pub struct BunAdapter {
    bun_path: PathBuf,
    timeout_ms: u64,
    temp_dir: TempDir,
}

impl BunAdapter {
    pub fn new() -> Result<Self, Error> {
        let bun_path = which::which("bun").map_err(|_| Error::BunNotFound)?;
        let temp_dir = TempDir::new()?;
        
        Ok(Self {
            bun_path,
            timeout_ms: 5000, // 5 second timeout
            temp_dir,
        })
    }
}

impl RuntimeAdapter for BunAdapter {
    fn execute(&self, code: &str, args: Value) -> Result<Value, Error> {
        // Create temporary script file
        let script_path = self.temp_dir.path().join("script.js");
        fs::write(&script_path, code)?;
        
        // Create temporary args file
        let args_path = self.temp_dir.path().join("args.json");
        fs::write(&args_path, args.to_string())?;
        
        // Create wrapper script that loads args and executes the function
        let wrapper_path = self.temp_dir.path().join("wrapper.js");
        let wrapper_code = format!(
            r#"
            import {{ readFileSync }} from 'fs';
            const args = JSON.parse(readFileSync('{}', 'utf-8'));
            const fn = require('{}');
            const result = fn(args);
            console.log(JSON.stringify(result));
            "#,
            args_path.display(),
            script_path.display()
        );
        fs::write(&wrapper_path, wrapper_code)?;
        
        // Execute Bun with the wrapper script
        let output = Command::new(&self.bun_path)
            .arg(&wrapper_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()?;
        
        if !output.status.success() {
            let error_msg = String::from_utf8_lossy(&output.stderr);
            return Err(Error::RuntimeError(error_msg.to_string()));
        }
        
        // Parse the output
        let output_str = String::from_utf8_lossy(&output.stdout);
        let result: Value = serde_json::from_str(&output_str)?;
        
        Ok(result)
    }
    
    fn create_sandbox(&self) -> Result<(), Error> {
        // For Bun, we rely on process isolation for sandboxing
        // Additional sandbox measures could be implemented here
        Ok(())
    }
}