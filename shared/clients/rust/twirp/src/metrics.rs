use opentelemetry::KeyValue;
use opentelemetry::metrics::{Histogram, Meter};
use std::time::Duration;
use woofx3_logging::metric_buckets::SHORT_DURATION_BUCKETS_SECONDS;

pub(crate) const RPC_SYSTEM: &str = "twirp";

/// `rpc.client.duration`: one observation per call, failed or not.
/// `rpc.service` and `rpc.method` are the Twirp names, a fixed set per client.
#[derive(Clone)]
pub(crate) struct RpcClientMetrics {
    duration: Histogram<f64>,
}

impl RpcClientMetrics {
    pub(crate) fn new(meter: &Meter) -> Self {
        Self {
            duration: meter
                .f64_histogram("rpc.client.duration")
                .with_unit("s")
                .with_description("Time a Twirp call took, from send to decoded response.")
                .with_boundaries(SHORT_DURATION_BUCKETS_SECONDS.to_vec())
                .build(),
        }
    }

    pub(crate) fn record(
        &self,
        service: &str,
        method: &str,
        elapsed: Duration,
        error_type: Option<&str>,
    ) {
        let mut attributes = vec![
            KeyValue::new("rpc.system", RPC_SYSTEM),
            KeyValue::new("rpc.service", service.to_owned()),
            KeyValue::new("rpc.method", method.to_owned()),
        ];
        if let Some(error_type) = error_type {
            attributes.push(KeyValue::new("error.type", error_type.to_owned()));
        }
        self.duration.record(elapsed.as_secs_f64(), &attributes);
    }
}
