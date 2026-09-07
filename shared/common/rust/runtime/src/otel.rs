//! Shared OpenTelemetry configuration contract.
//!
//! The same four keys are honoured by the TypeScript, Go, and Rust runtimes so a
//! single `.woofx3.json` (or `WOOFX3_*` environment) drives every service.

use crate::{Config, ConfigError};

/// Master switch. Defaults to `true` when an exporter endpoint is configured.
pub const OTEL_ENABLED_KEY: &str = "otelEnabled";
/// OTLP collector base endpoint, for example `http://localhost:4318`.
pub const OTEL_EXPORTER_ENDPOINT_KEY: &str = "otelExporterEndpoint";
/// Independent override for tracing. Defaults to the value of `otelEnabled`.
pub const OTEL_TRACING_ENABLED_KEY: &str = "otelTracingEnabled";
/// Write trace data under `logs/` when tracing is on but no collector exists.
pub const OTEL_LOCAL_FILE_ENABLED_KEY: &str = "otelLocalFileEnabled";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OtelConfig {
    pub enabled: bool,
    pub exporter_endpoint: Option<String>,
    pub tracing_enabled: bool,
    pub local_file_enabled: bool,
}

impl OtelConfig {
    pub fn from_config(config: &Config) -> Result<OtelConfig, ConfigError> {
        let exporter_endpoint = config.get_non_empty(OTEL_EXPORTER_ENDPOINT_KEY);
        let enabled = config
            .get_bool(OTEL_ENABLED_KEY)?
            .unwrap_or(exporter_endpoint.is_some());
        let tracing_enabled = config.get_bool(OTEL_TRACING_ENABLED_KEY)?.unwrap_or(enabled);
        let local_file_enabled = config.get_bool(OTEL_LOCAL_FILE_ENABLED_KEY)?.unwrap_or(true);

        Ok(OtelConfig {
            enabled,
            exporter_endpoint,
            tracing_enabled,
            local_file_enabled,
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

    #[test]
    fn a_non_boolean_value_is_an_error() {
        let error = config_from(&[(OTEL_ENABLED_KEY, "maybe")])
            .otel()
            .unwrap_err();
        assert!(matches!(error, ConfigError::InvalidBool { .. }));
    }
}
