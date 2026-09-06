//! Proves the no-collector fallback: tracing still produces span data on disk.

use opentelemetry::trace::{Tracer, TracerProvider};
use opentelemetry_sdk::trace::SdkTracerProvider;
use woofx3_logging::FileSpanExporter;

#[test]
fn spans_are_written_to_the_local_trace_file() {
    let directory = tempfile::tempdir().expect("tempdir");
    let path = directory.path().join("barkloader.traces.jsonl");

    let exporter = FileSpanExporter::create("barkloader", &path).expect("exporter");
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter)
        .build();

    let tracer = provider.tracer("local-trace-file-test");
    tracer.in_span("unit-span", |_context| {});

    provider.force_flush().expect("flush");
    provider.shutdown().expect("shutdown");

    let contents = std::fs::read_to_string(&path).expect("read trace file");
    let line = contents.lines().next().expect("at least one span line");
    let span: serde_json::Value = serde_json::from_str(line).expect("valid json line");

    assert_eq!(span["name"], "unit-span");
    assert_eq!(span["service"], "barkloader");
    assert!(span["traceId"].as_str().is_some());
    assert!(span["durationMs"].as_f64().is_some());
}
