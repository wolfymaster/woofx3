//! W3C trace context helpers shared by every Rust boundary (HTTP, NATS).
//!
//! They read and write the context of the current `tracing` span through the
//! global text-map propagator, which `init` registers when tracing is active.
//! Without a propagator or an active span, injection writes nothing and
//! extraction yields an empty context, so a malformed or absent header starts a
//! new root trace and never fails.

use opentelemetry::propagation::{Extractor, Injector};
use opentelemetry::Context;
use tracing_opentelemetry::OpenTelemetrySpanExt;

/// Writes the current span's trace context into `injector`.
pub fn inject_current(injector: &mut dyn Injector) {
    let context = tracing::Span::current().context();
    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&context, injector);
    });
}

/// Reads a remote trace context from `extractor`; empty when none is present or valid.
pub fn extract(extractor: &dyn Extractor) -> Context {
    opentelemetry::global::get_text_map_propagator(|propagator| propagator.extract(extractor))
}

/// Makes `span` a child of the remote context carried by `extractor`.
pub fn set_parent_from(span: &tracing::Span, extractor: &dyn Extractor) {
    let context = extract(extractor);
    // An empty context would detach the span from its tracing parent for nothing.
    if opentelemetry::trace::TraceContextExt::span(&context)
        .span_context()
        .is_valid()
    {
        // Fails only when tracing is not active, where there is no trace to join.
        if let Err(error) = span.set_parent(context) {
            tracing::debug!(%error, "remote trace context not applied");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use opentelemetry::trace::{TraceContextExt, TracerProvider as _};
    use opentelemetry_sdk::propagation::TraceContextPropagator;
    use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
    use std::collections::HashMap;
    use tracing_subscriber::layer::SubscriberExt;

    #[test]
    fn test_inject_then_extract_keeps_the_trace_id() {
        opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());
        let exporter = InMemorySpanExporter::default();
        let provider = SdkTracerProvider::builder()
            .with_simple_exporter(exporter.clone())
            .build();
        let subscriber = tracing_subscriber::registry()
            .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));

        tracing::subscriber::with_default(subscriber, || {
            let producer = tracing::info_span!("producer");
            let mut headers = HashMap::new();
            producer.in_scope(|| inject_current(&mut headers));
            assert!(headers["traceparent"].starts_with("00-"));

            let consumer = tracing::info_span!("consumer");
            set_parent_from(&consumer, &headers);
            let producer_trace = producer.context().span().span_context().trace_id();
            assert_eq!(
                consumer.context().span().span_context().trace_id(),
                producer_trace
            );
        });
        provider.force_flush().unwrap();
        let spans = exporter.get_finished_spans().unwrap();
        let by_name = |name: &str| spans.iter().find(|s| s.name == name).unwrap();
        assert_eq!(
            by_name("consumer").span_context.trace_id(),
            by_name("producer").span_context.trace_id()
        );
    }

    #[test]
    fn test_absent_or_malformed_context_yields_a_new_root() {
        opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());
        let mut bad = HashMap::new();
        bad.insert("traceparent".to_string(), "not-a-traceparent".to_string());
        for headers in [HashMap::new(), bad] {
            let context = extract(&headers);
            assert!(!context.span().span_context().is_valid());
        }
    }
}
