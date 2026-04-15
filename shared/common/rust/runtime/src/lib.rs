use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

const PROJECT_ROOT_MARKERS: &[&str] = &[".woofx3.json", ".woofx3.config"];
const ENV_PREFIX: &str = "WOOFX3_";

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("failed to find config file")]
    ConfigNotFound,
    #[error("failed to read config file: {0}")]
    IoError(#[from] std::io::Error),
    #[error("failed to parse config file: {0}")]
    ParseError(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Config {
    #[serde(flatten)]
    pub values: HashMap<String, serde_json::Value>,
}

impl Config {
    pub fn load() -> Result<Config, ConfigError> {
        let root = find_config_root(".");
        let config_path = PathBuf::from(&root).join(".woofx3.json");

        if !config_path.exists() {
            return Err(ConfigError::ConfigNotFound);
        }

        let content = fs::read_to_string(&config_path)?;
        let values: HashMap<String, serde_json::Value> = serde_json::from_str(&content)?;

        Ok(Config { values })
    }

    pub fn get(&self, key: &str) -> Option<String> {
        let env_key = format!("{}{}", ENV_PREFIX, camel_to_screaming_snake(key));
        self.values
            .get(key)
            .and_then(|v| match v {
                serde_json::Value::String(s) => Some(s.clone()),
                serde_json::Value::Number(n) => Some(n.to_string()),
                serde_json::Value::Bool(b) => Some(b.to_string()),
                _ => None,
            })
            .or_else(|| std::env::var(&env_key).ok())
    }

    pub fn get_required(&self, key: &str) -> Result<String, ConfigError> {
        self.get(key)
            .filter(|v| !v.is_empty())
            .ok_or_else(|| ConfigError::ConfigNotFound)
    }
}

pub fn find_config_root(start_dir: &str) -> String {
    let dir = match std::fs::canonicalize(start_dir) {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(_) => start_dir.to_string(),
    };

    let root = if cfg!(windows) {
        let volume = PathBuf::from(&dir)
            .components()
            .next()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .unwrap_or_else(|| "C:\\".to_string());
        volume + "\\"
    } else {
        "/".to_string()
    };

    let mut current = dir.clone();
    while current != root {
        for marker in PROJECT_ROOT_MARKERS {
            let path = Path::new(&current).join(marker);
            if path.exists() {
                return current;
            }
        }
        let parent = Path::new(&current)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        if parent == current || parent.is_empty() {
            break;
        }
        current = parent;
    }

    start_dir.to_string()
}

fn camel_to_screaming_snake(s: &str) -> String {
    let mut result = String::new();
    for (i, c) in s.chars().enumerate() {
        if c >= 'A' && c <= 'Z' && i > 0 {
            result.push('_');
        }
        if c >= 'a' && c <= 'z' {
            result.push((c as u8 - 32) as char);
        } else if c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' {
            result.push(c);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_camel_to_screaming_snake() {
        assert_eq!(
            camel_to_screaming_snake("barkloaderToken"),
            "BARKLOADER_TOKEN"
        );
        assert_eq!(camel_to_screaming_snake("applicationId"), "APPLICATION_ID");
        assert_eq!(
            camel_to_screaming_snake("twitchChannelName"),
            "TWITCH_CHANNEL_NAME"
        );
    }
}
