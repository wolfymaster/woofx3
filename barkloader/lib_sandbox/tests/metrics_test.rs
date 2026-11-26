use lib_sandbox::host::noop::noop_host_context;
use lib_sandbox::metrics::FunctionMetrics;
use lib_sandbox::models::function::Function;
use lib_sandbox::models::request::InvokeRequest;
use lib_sandbox::{
    ModuleMetadata, ModuleRegistry, ModuleState, RegisteredModule, Sandbox, SandboxLimits,
};
use opentelemetry::metrics::MeterProvider;
use opentelemetry_sdk::metrics::data::{AggregatedMetrics, MetricData};
use opentelemetry_sdk::metrics::{InMemoryMetricExporter, PeriodicReader, SdkMeterProvider};
use std::collections::HashMap;
use std::sync::Arc;

/// A point's sorted attribute pairs and its observation count.
type Point = (Vec<(String, String)>, u64);

fn registry() -> Arc<ModuleRegistry> {
    let registry = Arc::new(ModuleRegistry::new());
    let mut functions = HashMap::new();
    for (name, file) in [("works", "works.echo"), ("broken", "broken.unsupported")] {
        functions.insert(
            name.to_string(),
            Function::new(name.to_string(), file.to_string(), String::new(), false),
        );
    }
    let module = RegisteredModule {
        actions: Default::default(),
        metadata: ModuleMetadata {
            name: "example".to_string(),
            version: "1.0.0".to_string(),
            installed_at: 0,
            updated_at: 0,
        },
        functions,
        state: ModuleState::Active,
        event_types: Default::default(),
        permissions: Default::default(),
        protected_settings: Default::default(),
        local_endpoints: Default::default(),
        resource_link_settings: Default::default(),
        oauth: Default::default(),
    };
    registry
        .register_module("example".to_string(), module)
        .unwrap();
    registry
}

fn invoke(sandbox: &mut Sandbox, function: &str) -> bool {
    sandbox
        .invoke(InvokeRequest {
            function: format!("example:function:{function}"),
            event: serde_json::Value::Null,
            user: None,
            params: serde_json::Value::Null,
            workflow_chain: None,
            timeout_ms: None,
        })
        .is_ok()
}

/// Sorted attribute pairs and observation count per point of the function histogram, plus its unit.
fn recorded(
    provider: &SdkMeterProvider,
    exporter: &InMemoryMetricExporter,
) -> (String, Vec<Point>) {
    provider.force_flush().unwrap();
    let exported = exporter.get_finished_metrics().unwrap();
    let metric = exported
        .iter()
        .flat_map(|resource| resource.scope_metrics())
        .flat_map(|scope| scope.metrics())
        .find(|metric| metric.name() == "woofx3.barkloader.function.duration")
        .expect("the function duration was recorded");
    let AggregatedMetrics::F64(MetricData::Histogram(histogram)) = metric.data() else {
        panic!("function duration is not an f64 histogram");
    };
    let mut points: Vec<_> = histogram
        .data_points()
        .map(|point| {
            let mut attributes: Vec<(String, String)> = point
                .attributes()
                .map(|kv| (kv.key.to_string(), kv.value.to_string()))
                .collect();
            attributes.sort();
            (attributes, point.count())
        })
        .collect();
    points.sort();
    (metric.unit().to_owned(), points)
}

fn pairs(items: &[(&str, &str)]) -> Vec<(String, String)> {
    let mut pairs: Vec<_> = items
        .iter()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect();
    pairs.sort();
    pairs
}

#[test]
fn test_invoke_records_duration_by_module_function_and_outcome() {
    let exporter = InMemoryMetricExporter::default();
    let provider = SdkMeterProvider::builder()
        .with_reader(PeriodicReader::builder(exporter.clone()).build())
        .build();
    let metrics = FunctionMetrics::new(&provider.meter("test"));
    let mut sandbox = Sandbox::with_metrics(
        registry(),
        noop_host_context(),
        SandboxLimits::default(),
        metrics,
    )
    .unwrap();

    assert!(invoke(&mut sandbox, "works"));
    assert!(invoke(&mut sandbox, "works"));
    assert!(!invoke(&mut sandbox, "broken"));

    let (unit, points) = recorded(&provider, &exporter);
    assert_eq!(unit, "s");
    assert_eq!(
        points,
        vec![
            (
                pairs(&[
                    ("module.id", "example"),
                    ("function.name", "broken"),
                    ("outcome", "error"),
                ]),
                1
            ),
            (
                pairs(&[
                    ("module.id", "example"),
                    ("function.name", "works"),
                    ("outcome", "ok"),
                ]),
                2
            ),
        ]
    );
}
