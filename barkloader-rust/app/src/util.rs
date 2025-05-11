use std::{env, path::{Path, PathBuf}};

// get path from env var or default
pub fn get_path_from_env(env_var: &str, default: &str) -> PathBuf {
    // Get the path string from environment or use default
    let path_str = env::var(env_var).unwrap_or_else(|_| default.to_string());
    
    // Convert to PathBuf
    let path = Path::new(&path_str);
    
    if path.is_absolute() {
        // If it's an absolute path, use it directly
        path.to_path_buf()
    } else {
        // If it's a relative path, make it relative to current directory
        let current_dir = env::current_dir().expect("Failed to get current directory");
        current_dir.join(path)
    }
}

// get env var or default
pub fn get_env_or_default(env_var: &str, default: &str) -> String {
    env::var(env_var).unwrap_or_else(|_| default.to_string())
}
