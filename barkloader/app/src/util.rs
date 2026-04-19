use anyhow::{anyhow, Context, Result};
use std::{
    env, fs,
    path::{Path, PathBuf},
};
use woofx3_runtime::Config;

// get path from env var or default
pub fn get_path_from_env(env_var: &str, default: &str) -> PathBuf {
    // Get the path string from environment or use default
    let path_str = get_env_or_default(env_var, default);

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

// get env var or default - first checks WOOFX3 config (.woofx3.json), then falls back to env
pub fn get_env_or_default(env_var: &str, default: &str) -> String {
    get_env_or_default_with_key(env_var, None, default)
}

// Same as get_env_or_default but allows specifying an explicit .woofx3.json config key
// when the env var name does not follow the WOOFX3_<camelCase> convention.
pub fn get_env_or_default_with_key(env_var: &str, config_key: Option<&str>, default: &str) -> String {
    if let Ok(config) = Config::load() {
        // If an explicit config key was provided, try it first
        if let Some(key) = config_key {
            if let Some(value) = config.get(key) {
                if !value.is_empty() {
                    return value;
                }
            }
        }

        // Convert env var to config key: strip optional WOOFX3_ prefix, then
        // SCREAMING_SNAKE -> camelCase (e.g. DB_PROXY_ADDR -> dbProxyAddr,
        // WOOFX3_BARKLOADER_KEY -> barkloaderKey)
        let base = env_var.strip_prefix("WOOFX3_").unwrap_or(env_var);
        let converted = screaming_snake_to_camel(base);
        if !converted.is_empty() {
            if let Some(value) = config.get(&converted) {
                if !value.is_empty() {
                    return value;
                }
            }
        }
    }

    // Fall back to environment variable
    env::var(env_var).unwrap_or_else(|_| default.to_string())
}

fn screaming_snake_to_camel(s: &str) -> String {
    let mut result = String::new();
    let mut capitalize_next = false;
    for (i, c) in s.chars().enumerate() {
        if c == '_' {
            capitalize_next = true;
            continue;
        }
        if i == 0 || !capitalize_next {
            result.push(c.to_ascii_lowercase());
        } else {
            result.push(c.to_ascii_uppercase());
        }
        capitalize_next = false;
    }
    result
}

// Validate required config at startup - returns Err with list of missing keys if any are missing
pub fn validate_required_config(required: &[&str]) -> Result<Vec<String>> {
    let mut missing = Vec::new();

    for key in required {
        let value = get_env_or_default(key, "");
        if value.is_empty() {
            missing.push(key.to_string());
        }
    }

    if missing.is_empty() {
        Ok(missing)
    } else {
        Err(anyhow!("missing required config: {}", missing.join(", ")))
    }
}

pub fn safe_remove_dir_all<P: AsRef<Path>>(path: P, allowed_parent: P) -> Result<()> {
    let path = path.as_ref();
    let allowed_parent = allowed_parent.as_ref();

    // Canonicalize paths to resolve symlinks and get absolute paths
    let canonical_path = path
        .canonicalize()
        .with_context(|| format!("Failed to canonicalize path: {}", path.display()))?;

    let canonical_parent = allowed_parent.canonicalize().with_context(|| {
        format!(
            "Failed to canonicalize parent: {}",
            allowed_parent.display()
        )
    })?;

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
        "/",
        "/home",
        "/usr",
        "/var",
        "/etc",
        "/bin",
        "/sbin",
        "C:\\",
        "C:\\Windows",
        "C:\\Program Files",
        "C:\\Users",
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
    if file_count > 10000 {
        // Configurable limit
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
