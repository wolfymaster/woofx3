use anyhow::{Context, Result, anyhow};
use std::{env, fs, path::Path};
use woofx3_runtime::Config;

/// Resolve `env_var`, or `default` when nothing sets it. See
/// `get_env_or_default_with_key`.
pub fn get_env_or_default(env_var: &str, default: &str) -> String {
    get_env_or_default_with_key(env_var, None, default)
}

/// Resolve a setting from the environment first, then `.woofx3.json`.
///
/// In order, the first non-blank value wins:
/// 1. `env_var` exactly as named (e.g. `BARKLOADER_PORT`);
/// 2. `config_key`, when given, through `Config::get` (its `WOOFX3_*`
///    variable, then the file);
/// 3. `env_var` with any `WOOFX3_` prefix stripped and converted to
///    camelCase (`WOOFX3_BARKLOADER_KEY` -> `barkloaderKey`), the same way.
///
/// A blank value is treated as unset rather than as an override, so a `""`
/// left in a config file cannot mask a variable the deployment set.
pub fn get_env_or_default_with_key(
    env_var: &str,
    config_key: Option<&str>,
    default: &str,
) -> String {
    if let Some(value) = env::var(env_var).ok().filter(|v| !v.trim().is_empty()) {
        return value;
    }

    if let Ok(config) = Config::load() {
        if let Some(value) = config_key.and_then(|key| config.get_non_empty(key)) {
            return value;
        }

        let base = env_var.strip_prefix("WOOFX3_").unwrap_or(env_var);
        let converted = screaming_snake_to_camel(base);
        if !converted.is_empty() {
            if let Some(value) = config.get_non_empty(&converted) {
                return value;
            }
        }
    }

    default.to_string()
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

/// Resolve a camelCase config key: its `WOOFX3_<SCREAMING_SNAKE>` variable
/// first, then `.woofx3.json`, else `default`. Blank values count as unset.
pub fn get_config_value(key: &str, default: &str) -> String {
    Config::load()
        .ok()
        .and_then(|config| config.get_non_empty(key))
        .unwrap_or_else(|| default.to_string())
}

/// Fail unless every camelCase key resolves to a non-blank value, from the
/// environment or `.woofx3.json`.
pub fn validate_required_config_keys(keys: &[&str]) -> Result<()> {
    let config = Config::load().map_err(|e| anyhow!("failed to load .woofx3.json: {}", e))?;
    let missing: Vec<String> = keys
        .iter()
        .filter(|key| config.get_non_empty(key).is_none())
        .map(|key| (*key).to_string())
        .collect();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(anyhow!(
            "missing required config (set WOOFX3_<KEY> or the key in .woofx3.json): {}",
            missing.join(", ")
        ))
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    // Each test owns distinct variable names: the environment is process-wide
    // and tests run in parallel.
    fn set(name: &str, value: &str) {
        // SAFETY: test-only, and no other test reads or writes these names.
        unsafe {
            env::set_var(name, value);
        }
    }

    #[test]
    fn a_prefixed_variable_supplies_a_config_key() {
        set("WOOFX3_UTIL_TEST_PROXY_URL", "http://127.0.0.1:5555");

        assert_eq!(
            get_config_value("utilTestProxyUrl", ""),
            "http://127.0.0.1:5555"
        );
    }

    #[test]
    fn a_blank_variable_falls_back_to_the_default() {
        set("WOOFX3_UTIL_TEST_BLANK", "  ");

        assert_eq!(get_config_value("utilTestBlank", "fallback"), "fallback");
    }

    #[test]
    fn a_variable_named_outright_is_read_first() {
        set("UTIL_TEST_RAW_PORT", "9999");
        set("WOOFX3_UTIL_TEST_RAW_PORT", "1111");

        assert_eq!(get_env_or_default("UTIL_TEST_RAW_PORT", "0"), "9999");
    }

    #[test]
    fn required_keys_are_satisfied_by_the_environment_alone() {
        set("WOOFX3_UTIL_TEST_REQUIRED", "present");

        assert!(validate_required_config_keys(&["utilTestRequired"]).is_ok());
        let missing = validate_required_config_keys(&["utilTestNeverSet"])
            .expect_err("an unset key is missing");
        assert!(missing.to_string().contains("utilTestNeverSet"));
    }
}
