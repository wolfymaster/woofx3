pub mod heartbeat;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

mod otel;

pub use otel::{
    OtelConfig, OTEL_ENABLED_KEY, OTEL_EXPORTER_ENDPOINT_KEY, OTEL_LOCAL_FILE_ENABLED_KEY,
    OTEL_TRACING_ENABLED_KEY,
};

const PROJECT_ROOT_MARKERS: &[&str] = &[".woofx3.json", ".woofx3.config"];
const ENV_PREFIX: &str = "WOOFX3_";

/// Names an explicit config file. It must exist: a deployment that names its
/// config file and gets an empty config instead would start with defaults it
/// never asked for. Must match `ConfigFileEnv` in
/// `shared/common/golang/runtime/env.go` and `CONFIG_FILE_ENV` in
/// `shared/common/typescript/runtime/config.ts`.
pub const CONFIG_FILE_ENV: &str = "WOOFX3_CONFIG";

/// Names the config root directory, whose `.woofx3.json` is read unless
/// `WOOFX3_CONFIG` is set.
pub const ROOT_DIR_ENV: &str = "WOOFX3_ROOT";

/// Where `Config::load` reads `.woofx3.json` from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigSource {
    /// A file named by `WOOFX3_CONFIG`; it must exist.
    File(PathBuf),
    /// `.woofx3.json` in the directory named by `WOOFX3_ROOT`; it may be absent.
    Root(PathBuf),
    /// The nearest directory at or above the working directory holding a
    /// config file.
    Search,
}

impl ConfigSource {
    /// Pick the source from the values of `WOOFX3_CONFIG` and `WOOFX3_ROOT`,
    /// first match wins. Blank counts as unset.
    pub fn select(config_file: Option<&str>, root_dir: Option<&str>) -> ConfigSource {
        if let Some(path) = config_file.filter(|v| !v.is_empty()) {
            return ConfigSource::File(PathBuf::from(path));
        }
        if let Some(dir) = root_dir.filter(|v| !v.is_empty()) {
            return ConfigSource::Root(PathBuf::from(dir));
        }
        ConfigSource::Search
    }

    /// The source the process environment selects.
    pub fn from_env() -> ConfigSource {
        let config_file = std::env::var(CONFIG_FILE_ENV).ok();
        let root_dir = std::env::var(ROOT_DIR_ENV).ok();
        ConfigSource::select(config_file.as_deref(), root_dir.as_deref())
    }
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("failed to find config file")]
    ConfigNotFound,
    #[error("failed to read config file: {0}")]
    IoError(#[from] std::io::Error),
    #[error("failed to parse config file: {0}")]
    ParseError(#[from] serde_json::Error),
    #[error("config key `{key}` is not a boolean: `{value}`")]
    InvalidBool { key: String, value: String },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Config {
    #[serde(flatten)]
    pub values: HashMap<String, serde_json::Value>,
}

impl Config {
    /// Load the config the environment points at: the file `WOOFX3_CONFIG`
    /// names, else `.woofx3.json` in `WOOFX3_ROOT`, else the nearest
    /// `.woofx3.json` at or above the working directory (see `load_from`).
    pub fn load() -> Result<Config, ConfigError> {
        Self::load_source(&ConfigSource::from_env())
    }

    /// Load the config from `source`. Only a `ConfigSource::File` must exist;
    /// otherwise an absent file is an empty config, as in `load_from`.
    pub fn load_source(source: &ConfigSource) -> Result<Config, ConfigError> {
        match source {
            ConfigSource::File(path) => Self::read_file(path),
            ConfigSource::Root(dir) => Self::read_optional_file(&dir.join(".woofx3.json")),
            ConfigSource::Search => Self::load_from("."),
        }
    }

    /// Load `.woofx3.json` from the nearest directory at or above `start_dir`.
    ///
    /// An absent file is an empty config, not an error: a deployment may be
    /// configured entirely through `WOOFX3_*` variables, and `get` consults
    /// the environment first either way. A file that exists but cannot be
    /// read or parsed is still an error.
    pub fn load_from(start_dir: &str) -> Result<Config, ConfigError> {
        let root = find_config_root(start_dir);
        Self::read_optional_file(&PathBuf::from(&root).join(".woofx3.json"))
    }

    fn read_optional_file(config_path: &Path) -> Result<Config, ConfigError> {
        if !config_path.exists() {
            return Ok(Config::default());
        }
        Self::read_file(config_path)
    }

    fn read_file(config_path: &Path) -> Result<Config, ConfigError> {
        let content = fs::read_to_string(config_path)?;
        let values: HashMap<String, serde_json::Value> = serde_json::from_str(&content)?;
        Ok(Config { values })
    }

    /// Resolve `key` (camelCase) from `WOOFX3_<SCREAMING_SNAKE>` first, then
    /// the file.
    ///
    /// A blank value never masks a non-blank one from the other source: a
    /// `""` left in a baked config file, or an unset variable passed through
    /// by a compose file, means "not set here". Only when both are blank or
    /// absent does a blank value come back.
    pub fn get(&self, key: &str) -> Option<String> {
        let env_key = format!("{}{}", ENV_PREFIX, camel_to_screaming_snake(key));
        let from_env = std::env::var(&env_key).ok();
        let from_file = self.values.get(key).and_then(|v| match v {
            serde_json::Value::String(s) => Some(s.clone()),
            serde_json::Value::Number(n) => Some(n.to_string()),
            serde_json::Value::Bool(b) => Some(b.to_string()),
            _ => None,
        });

        let is_set =
            |value: &Option<String>| value.as_deref().is_some_and(|v| !v.trim().is_empty());
        if is_set(&from_env) {
            return from_env;
        }
        if is_set(&from_file) {
            return from_file;
        }
        from_env.or(from_file)
    }

    pub fn get_required(&self, key: &str) -> Result<String, ConfigError> {
        self.get(key)
            .filter(|v| !v.is_empty())
            .ok_or(ConfigError::ConfigNotFound)
    }

    /// Resolve a key as a boolean. An absent or blank value yields `None` so the
    /// caller can apply its own default; anything else that is not a recognised
    /// boolean literal is a configuration error rather than a silent fallback.
    pub fn get_bool(&self, key: &str) -> Result<Option<bool>, ConfigError> {
        let raw = match self.get(key) {
            Some(raw) => raw,
            None => {
                return Ok(None);
            }
        };

        let normalized = raw.trim().to_ascii_lowercase();
        if normalized.is_empty() {
            return Ok(None);
        }

        match normalized.as_str() {
            "1" | "true" | "yes" | "on" => Ok(Some(true)),
            "0" | "false" | "no" | "off" => Ok(Some(false)),
            _ => Err(ConfigError::InvalidBool {
                key: key.to_string(),
                value: raw,
            }),
        }
    }

    /// Resolve a key as a non-empty trimmed string, treating blank as absent.
    pub fn get_non_empty(&self, key: &str) -> Option<String> {
        self.get(key)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    }

    /// Resolve the shared OpenTelemetry settings used by every woofx3 service.
    pub fn otel(&self) -> Result<OtelConfig, ConfigError> {
        OtelConfig::from_config(self)
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
        if c.is_ascii_uppercase() && i > 0 {
            result.push('_');
        }
        if c.is_ascii_lowercase() {
            result.push((c as u8 - 32) as char);
        } else if c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_' {
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
        assert_eq!(
            camel_to_screaming_snake("databaseProxyUrl"),
            "DATABASE_PROXY_URL"
        );
        assert_eq!(
            camel_to_screaming_snake("twitchChannelName"),
            "TWITCH_CHANNEL_NAME"
        );
    }

    /// A config holding `key: value` as if read from `.woofx3.json`.
    fn file_config(key: &str, value: serde_json::Value) -> Config {
        let mut values = HashMap::new();
        values.insert(key.to_string(), value);
        Config { values }
    }

    // Each test owns a distinct variable: the environment is process-wide and
    // tests run in parallel.

    #[test]
    fn environment_overrides_the_file() {
        std::env::set_var("WOOFX3_PRECEDENCE_ENV_WINS", "from-env");
        let config = file_config("precedenceEnvWins", "from-file".into());

        assert_eq!(config.get("precedenceEnvWins").as_deref(), Some("from-env"));
    }

    #[test]
    fn a_blank_file_value_does_not_mask_the_environment() {
        std::env::set_var("WOOFX3_PRECEDENCE_BLANK_FILE", "from-env");
        let config = file_config("precedenceBlankFile", "".into());

        assert_eq!(
            config.get("precedenceBlankFile").as_deref(),
            Some("from-env")
        );
    }

    #[test]
    fn a_blank_environment_value_does_not_mask_the_file() {
        std::env::set_var("WOOFX3_PRECEDENCE_BLANK_ENV", "");
        let config = file_config("precedenceBlankEnv", "from-file".into());

        assert_eq!(
            config.get("precedenceBlankEnv").as_deref(),
            Some("from-file")
        );
    }

    #[test]
    fn the_file_answers_when_the_environment_is_silent() {
        let config = file_config("precedenceFileOnly", 5050.into());

        assert_eq!(config.get("precedenceFileOnly").as_deref(), Some("5050"));
    }

    #[test]
    fn a_missing_file_leaves_the_environment_as_the_only_source() {
        let dir = std::env::temp_dir().join(format!("woofx3-no-config-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        std::env::set_var("WOOFX3_PRECEDENCE_NO_FILE", "from-env");

        let config = Config::load_from(dir.to_str().expect("utf-8 path"))
            .expect("an absent file is not an error");

        assert!(config.values.is_empty());
        assert_eq!(config.get("precedenceNoFile").as_deref(), Some("from-env"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_config_file_variable_wins_over_the_root() {
        assert_eq!(
            ConfigSource::select(Some("/srv/config/engine.json"), Some("/srv/root")),
            ConfigSource::File(PathBuf::from("/srv/config/engine.json"))
        );
    }

    #[test]
    fn the_root_variable_names_the_root() {
        assert_eq!(
            ConfigSource::select(None, Some("/srv/root")),
            ConfigSource::Root(PathBuf::from("/srv/root"))
        );
    }

    #[test]
    fn without_either_variable_the_config_is_searched_for() {
        assert_eq!(ConfigSource::select(None, None), ConfigSource::Search);
        assert_eq!(
            ConfigSource::select(Some(""), Some("")),
            ConfigSource::Search
        );
    }

    /// A fresh directory under the system temp dir, unique to `name`.
    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("woofx3-{}-{}", name, std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn a_named_config_file_is_read() {
        let dir = temp_dir("named-config");
        let path = dir.join("engine.json");
        std::fs::write(&path, r#"{"sourceNamedFile": "from-named-file"}"#).expect("write");

        let config = Config::load_source(&ConfigSource::File(path)).expect("load");

        assert_eq!(
            config.values.get("sourceNamedFile"),
            Some(&serde_json::Value::from("from-named-file"))
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_missing_named_config_file_is_an_error() {
        let dir = temp_dir("named-config-missing");

        let result = Config::load_source(&ConfigSource::File(dir.join("missing.json")));

        assert!(matches!(result, Err(ConfigError::IoError(_))));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_root_config_file_is_read() {
        let dir = temp_dir("root-config");
        std::fs::write(dir.join(".woofx3.json"), r#"{"sourceRoot": "from-root"}"#).expect("write");

        let config = Config::load_source(&ConfigSource::Root(dir.clone())).expect("load");

        assert_eq!(
            config.values.get("sourceRoot"),
            Some(&serde_json::Value::from("from-root"))
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_root_without_a_config_file_is_an_empty_config() {
        let dir = temp_dir("root-config-missing");

        let config = Config::load_source(&ConfigSource::Root(dir.clone()))
            .expect("an absent file under the root is not an error");

        assert!(config.values.is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }
}
