// Concrete adapters that bridge barkloader's existing runtime services
// (NATS publisher, `log` crate) into the trait shapes `BuiltinActionContext`
// expects. Keeping these here — rather than leaking them into lib_sandbox —
// preserves the one-way dep direction (app → lib_sandbox).

use super::{Logger, MessageBusPublisher};
use lib_sandbox::host::NatsPublisher;
use serde_json::Value;
use std::sync::Arc;

/// Bridges the builtin `MessageBusPublisher` trait onto the sandbox host's
/// `NatsPublisher`. The sandbox already owns the live NATS client; we just
/// adapt the interface so builtin actions don't have to depend on the
/// sandbox's host types.
pub struct NatsMessageBusPublisher {
    nats: Arc<dyn NatsPublisher>,
}

impl NatsMessageBusPublisher {
    pub fn new(nats: Arc<dyn NatsPublisher>) -> Self {
        Self { nats }
    }
}

impl MessageBusPublisher for NatsMessageBusPublisher {
    fn publish(&self, subject: &str, payload: Value) -> anyhow::Result<()> {
        self.nats
            .publish(subject, payload)
            .map_err(|e| anyhow::anyhow!("nats publish failed: {}", e))
    }
}

/// Delegates builtin-action logging to the `log` crate so it lands in the
/// same destination as the rest of barkloader's logs.
pub struct LogCrateLogger;

impl Logger for LogCrateLogger {
    fn info(&self, msg: &str) {
        log::info!("{}", msg);
    }

    fn warn(&self, msg: &str) {
        log::warn!("{}", msg);
    }

    fn error(&self, msg: &str) {
        log::error!("{}", msg);
    }
}
