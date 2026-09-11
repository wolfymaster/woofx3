//! Local trace sink used when tracing is enabled but no OTLP collector is configured.
//!
//! Spans are written as newline-delimited JSON so the file stays greppable and can
//! be replayed into a collector later.

use std::fs::{File, OpenOptions};
use std::future::{ready, Future};
use std::io::{BufWriter, Write};
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use chrono::{DateTime, SecondsFormat, Utc};
use opentelemetry::trace::SpanId;
use opentelemetry_sdk::error::{OTelSdkError, OTelSdkResult};
use opentelemetry_sdk::trace::{SpanData, SpanExporter};
use serde_json::{json, Map, Value};

/// Appends spans to a file as JSON lines.
#[derive(Debug)]
pub struct FileSpanExporter {
    service_name: String,
    writer: Mutex<Option<BufWriter<File>>>,
}

impl FileSpanExporter {
    pub fn create(service_name: &str, path: &Path) -> std::io::Result<FileSpanExporter> {
        assert!(!service_name.is_empty(), "service name must not be empty");

        let file = OpenOptions::new().create(true).append(true).open(path)?;

        Ok(FileSpanExporter {
            service_name: service_name.to_string(),
            writer: Mutex::new(Some(BufWriter::new(file))),
        })
    }

    fn write_batch(&self, batch: Vec<SpanData>) -> OTelSdkResult {
        let mut guard = self.lock_writer()?;
        let writer = match guard.as_mut() {
            Some(writer) => writer,
            None => {
                return Err(OTelSdkError::AlreadyShutdown);
            }
        };

        for span in batch {
            let line = serde_json::to_string(&encode_span(&self.service_name, &span))
                .map_err(|error| OTelSdkError::InternalFailure(error.to_string()))?;
            writeln!(writer, "{}", line)
                .map_err(|error| OTelSdkError::InternalFailure(error.to_string()))?;
        }

        writer
            .flush()
            .map_err(|error| OTelSdkError::InternalFailure(error.to_string()))
    }

    fn lock_writer(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, Option<BufWriter<File>>>, OTelSdkError> {
        self.writer.lock().map_err(|_| {
            OTelSdkError::InternalFailure("trace file writer mutex is poisoned".to_string())
        })
    }
}

impl SpanExporter for FileSpanExporter {
    fn export(&self, batch: Vec<SpanData>) -> impl Future<Output = OTelSdkResult> + Send {
        ready(self.write_batch(batch))
    }

    fn force_flush(&self) -> OTelSdkResult {
        let mut guard = self.lock_writer()?;
        match guard.as_mut() {
            Some(writer) => writer
                .flush()
                .map_err(|error| OTelSdkError::InternalFailure(error.to_string())),
            None => Err(OTelSdkError::AlreadyShutdown),
        }
    }

    fn shutdown_with_timeout(&self, _timeout: Duration) -> OTelSdkResult {
        let mut guard = self.lock_writer()?;
        match guard.take() {
            Some(mut writer) => writer
                .flush()
                .map_err(|error| OTelSdkError::InternalFailure(error.to_string())),
            None => Ok(()),
        }
    }
}

fn encode_span(service_name: &str, span: &SpanData) -> Value {
    let start_time = format_timestamp(span.start_time);
    let end_time = format_timestamp(span.end_time);
    let duration = span
        .end_time
        .duration_since(span.start_time)
        .unwrap_or_default();

    let mut attributes = Map::new();
    for attribute in &span.attributes {
        attributes.insert(
            attribute.key.to_string(),
            json!(attribute.value.to_string()),
        );
    }

    let events: Vec<Value> = span
        .events
        .iter()
        .map(|event| {
            json!({
                "name": event.name.to_string(),
                "timestamp": format_timestamp(event.timestamp),
            })
        })
        .collect();

    let parent_span_id = if span.parent_span_id == SpanId::INVALID {
        Value::Null
    } else {
        json!(span.parent_span_id.to_string())
    };

    json!({
        "service": service_name,
        "traceId": span.span_context.trace_id().to_string(),
        "spanId": span.span_context.span_id().to_string(),
        "parentSpanId": parent_span_id,
        "name": span.name.to_string(),
        "kind": format!("{:?}", span.span_kind),
        "status": format!("{:?}", span.status),
        "startTime": start_time,
        "endTime": end_time,
        "durationMs": duration.as_secs_f64() * 1000.0,
        "scope": span.instrumentation_scope.name().to_string(),
        "attributes": Value::Object(attributes),
        "events": events,
    })
}

fn format_timestamp(timestamp: SystemTime) -> String {
    DateTime::<Utc>::from(timestamp).to_rfc3339_opts(SecondsFormat::Micros, true)
}
