//! Shared OpenTelemetry configuration contract.
//!
//! The same four keys are honoured by the TypeScript, Go, and Rust runtimes so a
//! single `.woofx3.json` (or `WOOFX3_*` environment) drives every service.

use std::collections::BTreeMap;

use crate::{Config, ConfigError, SecretString};

/// Master switch. Defaults to `true` when an exporter endpoint is configured.
pub const OTEL_ENABLED_KEY: &str = "otelEnabled";
/// OTLP collector base endpoint, for example `http://localhost:4318`.
pub const OTEL_EXPORTER_ENDPOINT_KEY: &str = "otelExporterEndpoint";
/// Independent override for tracing. Defaults to the value of `otelEnabled`.
pub const OTEL_TRACING_ENABLED_KEY: &str = "otelTracingEnabled";
/// Write trace data under `logs/` when tracing is on but no collector exists.
pub const OTEL_LOCAL_FILE_ENABLED_KEY: &str = "otelLocalFileEnabled";

/// Comma-separated `key=value` pairs merged into every OTel resource.
pub const OTEL_RESOURCE_ATTRIBUTES_KEY: &str = "otelResourceAttributes";
/// Comma-separated `key=value` headers sent on every OTLP request. Secret.
pub const OTEL_EXPORTER_HEADERS_KEY: &str = "otelExporterHeaders";
/// Release tag, reported as `service.version` on every resource.
pub const VERSION_KEY: &str = "version";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OtelConfig {
    pub enabled: bool,
    pub exporter_endpoint: Option<String>,
    pub tracing_enabled: bool,
    pub local_file_enabled: bool,
    pub service_version: Option<String>,
    pub resource_attributes: BTreeMap<String, String>,
    pub exporter_headers: BTreeMap<String, SecretString>,
}

/// Whether an error may quote the pair it rejects.
#[derive(Clone, Copy, PartialEq, Eq)]
enum PairText {
    Shown,
    Hidden,
}

/// Splits `key=value,key=value` on commas, then each pair on its first `=`.
/// Whitespace around pairs, keys and values is trimmed, empty segments are
/// skipped, and a later duplicate key wins. Keys and values are percent-decoded
/// after splitting, as in the standard syntax.
/// `PairText::Hidden` keeps a malformed pair's text out of the error because
/// header pairs hold secrets.
fn parse_pairs(
    key: &str,
    raw: &str,
    pair_text: PairText,
) -> Result<BTreeMap<String, String>, ConfigError> {
    let mut parsed = BTreeMap::new();
    let segments = raw.split(',').map(str::trim).filter(|s| !s.is_empty());
    for (index, segment) in segments.enumerate() {
        let entry = segment
            .split_once('=')
            .map(|(name, value)| (name.trim(), value.trim()))
            .filter(|(name, _)| !name.is_empty())
            .and_then(|(name, value)| Some((percent_decode(name)?, percent_decode(value)?)));
        let Some((name, value)) = entry else {
            let pair = if pair_text == PairText::Hidden {
                format!("#{}", index + 1)
            } else {
                format!("`{segment}`")
            };
            return Err(ConfigError::InvalidPair {
                key: key.to_string(),
                pair,
            });
        };
        parsed.insert(name, value);
    }
    Ok(parsed)
}

/// Decodes `%XX` escapes; `None` on a truncated or non-hex escape, or when the
/// result is not UTF-8. `+` stays `+`: this is not form encoding.
fn percent_decode(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = raw.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

impl OtelConfig {
    pub fn from_config(config: &Config) -> Result<OtelConfig, ConfigError> {
        let exporter_endpoint = config.get_non_empty(OTEL_EXPORTER_ENDPOINT_KEY);
        let enabled = config
            .get_bool(OTEL_ENABLED_KEY)?
            .unwrap_or(exporter_endpoint.is_some());
        let tracing_enabled = config
            .get_bool(OTEL_TRACING_ENABLED_KEY)?
            .unwrap_or(enabled);
        let local_file_enabled = config
            .get_bool(OTEL_LOCAL_FILE_ENABLED_KEY)?
            .unwrap_or(true);

        let resource_attributes = match config.get_non_empty(OTEL_RESOURCE_ATTRIBUTES_KEY) {
            Some(raw) => parse_pairs(OTEL_RESOURCE_ATTRIBUTES_KEY, &raw, PairText::Shown)?,
            None => BTreeMap::new(),
        };
        let exporter_headers = match config.get_non_empty(OTEL_EXPORTER_HEADERS_KEY) {
            Some(raw) => parse_pairs(OTEL_EXPORTER_HEADERS_KEY, &raw, PairText::Hidden)?
                .into_iter()
                .map(|(name, value)| (name, SecretString::new(value)))
                .collect(),
            None => BTreeMap::new(),
        };

        Ok(OtelConfig {
            enabled,
            exporter_endpoint,
            tracing_enabled,
            local_file_enabled,
            service_version: config.get_non_empty(VERSION_KEY),
            resource_attributes,
            exporter_headers,
        })
    }

    /// Logs are shipped over OTLP only when OpenTelemetry is on and a collector exists.
    pub fn exports_logs(&self) -> bool {
        self.enabled && self.exporter_endpoint.is_some()
    }

    /// Spans are shipped over OTLP only when tracing is on and a collector exists.
    pub fn exports_traces(&self) -> bool {
        self.tracing_enabled && self.exporter_endpoint.is_some()
    }

    /// Without a collector, tracing falls back to a local trace file so span data
    /// is retained rather than dropped.
    pub fn writes_local_traces(&self) -> bool {
        self.tracing_enabled && self.exporter_endpoint.is_none() && self.local_file_enabled
    }

    /// True when a tracer provider should be built at all.
    pub fn collects_traces(&self) -> bool {
        self.exports_traces() || self.writes_local_traces()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn config_from(pairs: &[(&str, &str)]) -> Config {
        let mut values = HashMap::new();
        for (key, value) in pairs {
            values.insert(
                (*key).to_string(),
                serde_json::Value::String((*value).to_string()),
            );
        }
        Config { values }
    }

    #[test]
    fn test_parse_pairs_percent_decodes_keys_and_values() {
        let parsed = parse_pairs(
            "k",
            "authorization=Basic%20abc%3D%3D,a%2Eb=x%2Cy,p=1+2",
            PairText::Hidden,
        )
        .unwrap();
        assert_eq!(parsed["authorization"], "Basic abc==");
        assert_eq!(parsed["a.b"], "x,y");
        assert_eq!(parsed["p"], "1+2");
    }

    #[test]
    fn test_parse_pairs_rejects_bad_escape_without_echoing_secret() {
        for raw in ["a=%zz", "a=%4", "a=%FF"] {
            let err = parse_pairs("k", raw, PairText::Hidden).unwrap_err();
            assert!(matches!(err, ConfigError::InvalidPair { .. }));
            assert!(!err.to_string().contains("%zz"));
        }
    }

    #[test]
    fn defaults_are_off_without_an_endpoint() {
        let otel = config_from(&[]).otel().unwrap();
        assert!(!otel.enabled);
        assert!(!otel.tracing_enabled);
        assert!(otel.local_file_enabled);
        assert!(!otel.collects_traces());
    }

    #[test]
    fn an_endpoint_turns_everything_on() {
        let otel = config_from(&[(OTEL_EXPORTER_ENDPOINT_KEY, "http://localhost:4318")])
            .otel()
            .unwrap();
        assert!(otel.enabled);
        assert!(otel.tracing_enabled);
        assert!(otel.exports_logs());
        assert!(otel.exports_traces());
        assert!(!otel.writes_local_traces());
    }

    #[test]
    fn tracing_can_be_forced_without_a_collector() {
        let otel = config_from(&[(OTEL_TRACING_ENABLED_KEY, "true")])
            .otel()
            .unwrap();
        assert!(!otel.enabled);
        assert!(otel.tracing_enabled);
        assert!(!otel.exports_traces());
        assert!(otel.writes_local_traces());
    }

    #[test]
    fn local_file_fallback_can_be_disabled() {
        let otel = config_from(&[
            (OTEL_TRACING_ENABLED_KEY, "true"),
            (OTEL_LOCAL_FILE_ENABLED_KEY, "false"),
        ])
        .otel()
        .unwrap();
        assert!(!otel.writes_local_traces());
        assert!(!otel.collects_traces());
    }

    #[test]
    fn tracing_can_be_disabled_while_logs_export() {
        let otel = config_from(&[
            (OTEL_EXPORTER_ENDPOINT_KEY, "http://localhost:4318"),
            (OTEL_TRACING_ENABLED_KEY, "false"),
        ])
        .otel()
        .unwrap();
        assert!(otel.exports_logs());
        assert!(!otel.collects_traces());
    }

    fn attributes(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    #[test]
    fn test_otel_unset_keys_add_nothing() {
        let otel = config_from(&[]).otel().unwrap();
        assert!(otel.resource_attributes.is_empty());
        assert!(otel.exporter_headers.is_empty());
        assert_eq!(otel.service_version, None);
        let blank = config_from(&[
            (OTEL_RESOURCE_ATTRIBUTES_KEY, "  "),
            (OTEL_EXPORTER_HEADERS_KEY, ""),
            (VERSION_KEY, " "),
        ])
        .otel()
        .unwrap();
        assert!(blank.resource_attributes.is_empty());
        assert!(blank.exporter_headers.is_empty());
        assert_eq!(blank.service_version, None);
    }

    #[test]
    fn test_otel_attributes_trim_skip_empty_and_split_on_first_equals() {
        let otel = config_from(&[(OTEL_RESOURCE_ATTRIBUTES_KEY, " a = 1 ,, b=x=y%20z ,c=, ")])
            .otel()
            .unwrap();
        assert_eq!(
            otel.resource_attributes,
            attributes(&[("a", "1"), ("b", "x=y z"), ("c", "")])
        );
    }

    #[test]
    fn test_otel_attributes_later_duplicate_wins() {
        let otel = config_from(&[(OTEL_RESOURCE_ATTRIBUTES_KEY, "a=1,a=2")])
            .otel()
            .unwrap();
        assert_eq!(otel.resource_attributes, attributes(&[("a", "2")]));
    }

    #[test]
    fn test_otel_attributes_malformed_pair_names_the_pair() {
        for raw in ["a=1,oops", "=v"] {
            let error = config_from(&[(OTEL_RESOURCE_ATTRIBUTES_KEY, raw)])
                .otel()
                .unwrap_err();
            assert!(matches!(error, ConfigError::InvalidPair { .. }), "{raw}");
        }
        let message = config_from(&[(OTEL_RESOURCE_ATTRIBUTES_KEY, "a=1,oops")])
            .otel()
            .unwrap_err()
            .to_string();
        assert!(message.contains("`oops`"), "{message}");
    }

    #[test]
    fn test_otel_headers_are_parsed_and_never_debug_printed() {
        let otel = config_from(&[(
            OTEL_EXPORTER_HEADERS_KEY,
            "Authorization = Bearer s3cret-token, x-a=b",
        )])
        .otel()
        .unwrap();
        assert_eq!(
            otel.exporter_headers["Authorization"].expose(),
            "Bearer s3cret-token"
        );
        assert_eq!(otel.exporter_headers["x-a"].expose(), "b");
        assert!(!format!("{otel:?}").contains("s3cret-token"));
    }

    #[test]
    fn test_otel_headers_malformed_pair_does_not_echo_the_value() {
        for raw in ["a=b,s3cret-token-without-equals", "=s3cret-token"] {
            let error = config_from(&[(OTEL_EXPORTER_HEADERS_KEY, raw)])
                .otel()
                .unwrap_err();
            assert!(matches!(error, ConfigError::InvalidPair { .. }), "{raw}");
            assert!(!error.to_string().contains("s3cret"), "{error}");
        }
    }

    #[test]
    fn test_otel_version_is_read_from_the_version_key() {
        let otel = config_from(&[(VERSION_KEY, " v1.2.3 ")]).otel().unwrap();
        assert_eq!(otel.service_version.as_deref(), Some("v1.2.3"));
    }

    #[test]
    fn a_non_boolean_value_is_an_error() {
        let error = config_from(&[(OTEL_ENABLED_KEY, "maybe")])
            .otel()
            .unwrap_err();
        assert!(matches!(error, ConfigError::InvalidBool { .. }));
    }
}
