//! Shared logging and tracing initialization for woofx3 Rust services.
//!
//! One call to [`init`] installs the global `tracing` subscriber with, in order:
//! a pretty console layer, a rolling file layer under `logs/`, and - when the
//! shared `WOOFX3_OTEL_*` configuration asks for it - OpenTelemetry layers that
//! export logs and spans over OTLP.
//!
//! With no configuration at all the behaviour is console plus file logging and
//! no tracing, so a service that never sees a collector pays nothing for this.

mod file_exporter;

use std::io::IsTerminal;
use std::path::{Path, PathBuf};

use chrono::Local;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_sdk::logs::SdkLoggerProvider;
use opentelemetry_sdk::trace::SdkTracerProvider;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::Resource;
use thiserror::Error;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::filter::filter_fn;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, Layer};
use woofx3_runtime::{Config, ConfigError, OtelConfig};

pub use file_exporter::FileSpanExporter;

const DEFAULT_LOG_DIRECTORY: &str = "logs";
const DEFAULT_LOG_LEVEL: &str = "info";
const LOG_DIRECTORY_ENV: &str = "WOOFX3_LOG_DIR";
const LOG_LEVEL_ENV: &str = "WOOFX3_LOG_LEVEL";
const RUST_LOG_ENV: &str = "RUST_LOG";
const FILE_TIMESTAMP_FORMAT: &str = "%Y%m%d_%H%M";

/// The OpenTelemetry exporters emit their own diagnostics through `tracing`.
/// Feeding those back into the OTLP log bridge would loop, so the bridge skips them.
const OTEL_INTERNAL_TARGET_PREFIX: &str = "opentelemetry";

#[derive(Debug, Error)]
pub enum LoggingError {
    #[error("invalid OpenTelemetry configuration: {0}")]
    Config(#[from] ConfigError),
    #[error("failed to create log directory `{path}`: {source}")]
    LogDirectory {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to open trace file `{path}`: {source}")]
    TraceFile {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("invalid log filter `{directive}`: {source}")]
    LogFilter {
        directive: String,
        #[source]
        source: tracing_subscriber::filter::ParseError,
    },
    #[error("failed to build OTLP exporter: {0}")]
    Exporter(#[from] opentelemetry_otlp::ExporterBuildError),
    #[error("a global tracing subscriber is already installed: {0}")]
    AlreadyInitialized(#[from] tracing_subscriber::util::TryInitError),
}

/// Keeps the logging pipeline alive. Dropping it flushes the file writer and
/// shuts the OpenTelemetry providers down, so hold it for the process lifetime.
#[must_use = "logging shuts down when this guard is dropped"]
pub struct LoggingGuard {
    _file_writer: WorkerGuard,
    tracer_provider: Option<SdkTracerProvider>,
    logger_provider: Option<SdkLoggerProvider>,
}

impl LoggingGuard {
    /// Flush every buffered telemetry pipeline without tearing them down.
    pub fn flush(&self) {
        if let Some(provider) = &self.tracer_provider {
            let _ = provider.force_flush();
        }
        if let Some(provider) = &self.logger_provider {
            let _ = provider.force_flush();
        }
    }
}

impl Drop for LoggingGuard {
    fn drop(&mut self) {
        if let Some(provider) = self.tracer_provider.take() {
            let _ = provider.shutdown();
        }
        if let Some(provider) = self.logger_provider.take() {
            let _ = provider.shutdown();
        }
    }
}

/// Install the global subscriber for `service_name`.
///
/// Call this exactly once, as early in `main` as possible, and keep the returned
/// guard alive for the rest of the process.
pub fn init(service_name: &str) -> Result<LoggingGuard, LoggingError> {
    assert!(!service_name.is_empty(), "service name must not be empty");

    let config = load_config()?;
    let otel = config.otel()?;
    let log_directory = resolve_log_directory(&config);

    std::fs::create_dir_all(&log_directory).map_err(|source| LoggingError::LogDirectory {
        path: log_directory.display().to_string(),
        source,
    })?;

    let (file_writer, file_writer_guard) = tracing_appender::non_blocking(
        tracing_appender::rolling::never(&log_directory, log_file_name(service_name)),
    );

    let console_layer = tracing_subscriber::fmt::layer()
        .with_target(true)
        .with_ansi(std::io::stderr().is_terminal())
        .with_writer(std::io::stderr);

    let file_layer = tracing_subscriber::fmt::layer()
        .with_target(true)
        .with_ansi(false)
        .with_writer(file_writer);

    let tracer_provider = match otel.collects_traces() {
        true => Some(build_tracer_provider(service_name, &otel, &log_directory)?),
        false => None,
    };
    let logger_provider = match otel.exports_logs() {
        true => Some(build_logger_provider(service_name, &otel)?),
        false => None,
    };

    let otel_trace_layer = tracer_provider.as_ref().map(|provider| {
        tracing_opentelemetry::layer().with_tracer(provider.tracer(service_name.to_string()))
    });
    let otel_log_layer = logger_provider.as_ref().map(|provider| {
        OpenTelemetryTracingBridge::new(provider).with_filter(filter_fn(|metadata| {
            !metadata.target().starts_with(OTEL_INTERNAL_TARGET_PREFIX)
        }))
    });

    tracing_subscriber::registry()
        .with(resolve_filter()?)
        .with(console_layer)
        .with(file_layer)
        .with(otel_trace_layer)
        .with(otel_log_layer)
        .try_init()?;

    Ok(LoggingGuard {
        _file_writer: file_writer_guard,
        tracer_provider,
        logger_provider,
    })
}

fn load_config() -> Result<Config, LoggingError> {
    match Config::load() {
        Ok(config) => Ok(config),
        // A missing `.woofx3.json` is normal; the environment still drives everything.
        Err(ConfigError::ConfigNotFound) => Ok(Config::default()),
        Err(error) => Err(LoggingError::Config(error)),
    }
}

fn build_tracer_provider(
    service_name: &str,
    otel: &OtelConfig,
    log_directory: &Path,
) -> Result<SdkTracerProvider, LoggingError> {
    let builder = SdkTracerProvider::builder().with_resource(resource_for(service_name));

    match &otel.exporter_endpoint {
        Some(endpoint) => {
            let exporter = opentelemetry_otlp::SpanExporter::builder()
                .with_http()
                .with_endpoint(endpoint)
                .build()?;
            Ok(builder.with_batch_exporter(exporter).build())
        }
        None => {
            let path = log_directory.join(trace_file_name(service_name));
            let exporter = FileSpanExporter::create(service_name, &path).map_err(|source| {
                LoggingError::TraceFile {
                    path: path.display().to_string(),
                    source,
                }
            })?;
            Ok(builder.with_batch_exporter(exporter).build())
        }
    }
}

fn build_logger_provider(
    service_name: &str,
    otel: &OtelConfig,
) -> Result<SdkLoggerProvider, LoggingError> {
    let endpoint = otel
        .exporter_endpoint
        .as_ref()
        .expect("exports_logs() guarantees an exporter endpoint");

    let exporter = opentelemetry_otlp::LogExporter::builder()
        .with_http()
        .with_endpoint(endpoint)
        .build()?;

    Ok(SdkLoggerProvider::builder()
        .with_resource(resource_for(service_name))
        .with_batch_exporter(exporter)
        .build())
}

fn resource_for(service_name: &str) -> Resource {
    Resource::builder()
        .with_service_name(service_name.to_string())
        .build()
}

fn resolve_filter() -> Result<EnvFilter, LoggingError> {
    let directive = std::env::var(RUST_LOG_ENV)
        .ok()
        .or_else(|| std::env::var(LOG_LEVEL_ENV).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_LOG_LEVEL.to_string());

    EnvFilter::try_new(&directive).map_err(|source| LoggingError::LogFilter { directive, source })
}

fn resolve_log_directory(config: &Config) -> PathBuf {
    std::env::var(LOG_DIRECTORY_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| config.get_non_empty("logDir"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_LOG_DIRECTORY))
}

/// Matches the Go and TypeScript shared loggers: `<service>_YYYYMMDD_HHMM.log`.
fn log_file_name(service_name: &str) -> String {
    format!(
        "{}_{}.log",
        service_name,
        Local::now().format(FILE_TIMESTAMP_FORMAT)
    )
}

fn trace_file_name(service_name: &str) -> String {
    format!(
        "{}_{}.traces.jsonl",
        service_name,
        Local::now().format(FILE_TIMESTAMP_FORMAT)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_file_name_matches_the_shared_convention() {
        let name = log_file_name("barkloader");
        assert!(name.starts_with("barkloader_"), "unexpected name: {}", name);
        assert!(name.ends_with(".log"), "unexpected name: {}", name);
        // <service>_ + YYYYMMDD_HHMM + .log
        assert_eq!(name.len(), "barkloader_".len() + 13 + ".log".len());
    }

    #[test]
    fn trace_file_name_is_json_lines() {
        assert!(trace_file_name("barkloader").ends_with(".traces.jsonl"));
    }

    #[test]
    fn log_directory_defaults_to_logs() {
        let config = Config::default();
        assert_eq!(
            resolve_log_directory(&config),
            PathBuf::from(DEFAULT_LOG_DIRECTORY)
        );
    }

    #[test]
    fn file_span_exporter_creates_its_file() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("barkloader.traces.jsonl");
        let exporter = FileSpanExporter::create("barkloader", &path).expect("exporter");
        assert!(path.exists());
        drop(exporter);
    }
}
