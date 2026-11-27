use opentelemetry::KeyValue;
use opentelemetry::metrics::{Histogram, Meter};
use std::time::Duration;
use woofx3_logging::metric_buckets::SHORT_DURATION_BUCKETS_SECONDS;

const METER_NAME: &str = "barkloader-sandbox";

/// How a function invocation ended, as the `outcome` metric attribute.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Ok,
    Error,
}

impl Outcome {
    fn as_str(self) -> &'static str {
        match self {
            Outcome::Ok => "ok",
            Outcome::Error => "error",
        }
    }
}

/// `woofx3.barkloader.function.duration`: time spent running a module
/// function. `module.id` and `function.name` are bounded by what the engine has
/// installed.
#[derive(Clone)]
pub struct FunctionMetrics {
    duration: Histogram<f64>,
}

impl FunctionMetrics {
    pub fn new(meter: &Meter) -> Self {
        Self {
            duration: meter
                .f64_histogram("woofx3.barkloader.function.duration")
                .with_unit("s")
                .with_description("Time a module function took to run in the sandbox.")
                .with_boundaries(SHORT_DURATION_BUCKETS_SECONDS.to_vec())
                .build(),
        }
    }

    /// Reports through the global meter, which the service's logging setup installs.
    pub fn global() -> Self {
        Self::new(&opentelemetry::global::meter(METER_NAME))
    }

    pub(crate) fn record(
        &self,
        module_id: &str,
        function_name: &str,
        elapsed: Duration,
        outcome: Outcome,
    ) {
        self.duration.record(
            elapsed.as_secs_f64(),
            &[
                KeyValue::new("module.id", module_id.to_owned()),
                KeyValue::new("function.name", function_name.to_owned()),
                KeyValue::new("outcome", outcome.as_str()),
            ],
        );
    }
}
