use std::{env, fs, path::{Path, PathBuf}};
use anyhow::{Result, anyhow, Context};

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

pub fn safe_remove_dir_all<P: AsRef<Path>>(
    path: P, 
    allowed_parent: P
) -> Result<()> {
    let path = path.as_ref();
    let allowed_parent = allowed_parent.as_ref();
    
    // Canonicalize paths to resolve symlinks and get absolute paths
    let canonical_path = path.canonicalize()
        .with_context(|| format!("Failed to canonicalize path: {}", path.display()))?;
    
    let canonical_parent = allowed_parent.canonicalize()
        .with_context(|| format!("Failed to canonicalize parent: {}", allowed_parent.display()))?;
    
    // Ensure the path is within the allowed parent directory
    if !canonical_path.starts_with(&canonical_parent) {
        return Err(anyhow!(
            "Path '{}' is outside allowed parent directory '{}'", 
            canonical_path.display(),
            canonical_parent.display()
        ));
    }
    
    // Additional safety checks
    validate_path_safety(&canonical_path)?;
    
    // Safe to remove
    fs::remove_dir_all(&canonical_path)
        .with_context(|| format!("Failed to remove directory: {}", canonical_path.display()))?;
    
    Ok(())
}

fn validate_path_safety(path: &Path) -> Result<()> {
    // Don't allow removing root directories
    let dangerous_paths = [
        "/", "/home", "/usr", "/var", "/etc", "/bin", "/sbin",
        "C:\\", "C:\\Windows", "C:\\Program Files", "C:\\Users"
    ];
    
    let path_str = path.to_string_lossy();
    for dangerous in &dangerous_paths {
        if path_str == *dangerous || path.ends_with(dangerous) {
            return Err(anyhow!("Refusing to remove dangerous path: {}", path_str));
        }
    }
    
    // Ensure it's actually a directory
    if !path.is_dir() {
        return Err(anyhow!("Path is not a directory: {}", path_str));
    }
    
    // Don't remove if it contains too many files (configurable threshold)
    let file_count = count_files_recursive(path)?;
    if file_count > 10000 {  // Configurable limit
        return Err(anyhow!(
            "Directory contains too many files ({}), refusing to remove for safety", 
            file_count
        ));
    }
    
    Ok(())
}

fn count_files_recursive(path: &Path) -> Result<usize> {
    let mut count = 0;
    let mut stack = vec![path.to_path_buf()];
    let max_iterations = 50000; // Prevent infinite loops
    let mut iterations = 0;
    
    while let Some(current) = stack.pop() {
        iterations += 1;
        if iterations > max_iterations {
            return Err(anyhow!("Directory structure too deep or complex"));
        }
        
        if current.is_dir() {
            match fs::read_dir(&current) {
                Ok(entries) => {
                    for entry in entries {
                        match entry {
                            Ok(entry) => {
                                let path = entry.path();
                                if path.is_dir() {
                                    stack.push(path);
                                } else {
                                    count += 1;
                                }
                            }
                            Err(_) => continue, // Skip inaccessible entries
                        }
                    }
                }
                Err(_) => continue, // Skip inaccessible directories
            }
        } else {
            count += 1;
        }
    }
    
    Ok(count)
}
