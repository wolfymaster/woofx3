mod metrics;
mod workflow;

pub use workflow::WorkflowServiceClient;

use metrics::RpcClientMetrics;
use opentelemetry::metrics::Meter;
use reqwest::Client;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::time::Instant;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TwirpError {
    #[error("HTTP error: {status} - {body}")]
    Http { status: u16, body: String },

    #[error("Twirp error ({code}): {msg}")]
    Twirp { code: String, msg: String },

    #[error("Request failed: {0}")]
    Request(#[from] reqwest::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Service error ({code}): {message}")]
    Service { code: i32, message: String },
}

impl TwirpError {
    /// The `error.type` metric attribute: the Twirp code when the server sent
    /// one, otherwise a fixed word for where the call failed.
    fn error_type(&self) -> String {
        match self {
            TwirpError::Twirp { code, .. } => code.clone(),
            TwirpError::Http { status, .. } => format!("http_{status}"),
            TwirpError::Request(_) => "request".to_owned(),
            TwirpError::Json(_) => "json".to_owned(),
            TwirpError::Service { code, .. } => format!("service_{code}"),
        }
    }
}

#[derive(Debug, Deserialize)]
struct TwirpErrorResponse {
    code: String,
    msg: String,
}

const METER_NAME: &str = "woofx3-twirp";

#[derive(Clone)]
pub struct TwirpClient {
    client: Client,
    base_url: String,
    metrics: RpcClientMetrics,
}

impl TwirpClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.into(),
            metrics: RpcClientMetrics::new(&opentelemetry::global::meter(METER_NAME)),
        }
    }

    /// Reports `rpc.client.duration` through `meter` instead of the global one.
    pub fn with_meter(mut self, meter: &Meter) -> Self {
        self.metrics = RpcClientMetrics::new(meter);
        self
    }

    pub fn with_client(client: Client, base_url: impl Into<String>) -> Self {
        Self {
            client,
            base_url: base_url.into(),
            metrics: RpcClientMetrics::new(&opentelemetry::global::meter(METER_NAME)),
        }
    }

    pub(crate) async fn call<Req, Resp>(
        &self,
        service: &str,
        method: &str,
        request: &Req,
    ) -> Result<Resp, TwirpError>
    where
        Req: Serialize,
        Resp: DeserializeOwned,
    {
        let started = Instant::now();
        let result = self.send(service, method, request).await;
        let error_type = result.as_ref().err().map(TwirpError::error_type);
        self.metrics
            .record(service, method, started.elapsed(), error_type.as_deref());
        result
    }

    async fn send<Req, Resp>(
        &self,
        service: &str,
        method: &str,
        request: &Req,
    ) -> Result<Resp, TwirpError>
    where
        Req: Serialize,
        Resp: DeserializeOwned,
    {
        let url = format!("{}/twirp/{}/{}", self.base_url, service, method);

        let response = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(request)
            .send()
            .await?;

        let status = response.status();
        let body = response.text().await?;

        if !status.is_success() {
            if let Ok(twirp_error) = serde_json::from_str::<TwirpErrorResponse>(&body) {
                return Err(TwirpError::Twirp {
                    code: twirp_error.code,
                    msg: twirp_error.msg,
                });
            }
            return Err(TwirpError::Http {
                status: status.as_u16(),
                body,
            });
        }

        Ok(serde_json::from_str(&body)?)
    }
}

pub mod types {
    pub use woofx3::db::common::ResponseStatus;
    pub use woofx3::db::workflow::{
        CancelWorkflowExecutionRequest, CreateWorkflowRequest, DeleteWorkflowRequest,
        ExecuteWorkflowRequest, ExecuteWorkflowResponse, ExecutionStep,
        GetWorkflowExecutionRequest, GetWorkflowRequest, ListWorkflowExecutionsRequest,
        ListWorkflowExecutionsResponse, ListWorkflowsRequest, ListWorkflowsResponse,
        UpdateWorkflowRequest, Workflow, WorkflowExecution, WorkflowExecutionResponse,
        WorkflowResponse,
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use opentelemetry::metrics::MeterProvider;
    use opentelemetry_sdk::metrics::data::{AggregatedMetrics, MetricData};
    use opentelemetry_sdk::metrics::{InMemoryMetricExporter, PeriodicReader, SdkMeterProvider};
    use serde_json::Value;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// A server that answers one request with `status` and `body`.
    async fn serve_once(status: &str, body: &str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0u8; 4096];
            let _ = socket.read(&mut buffer).await.unwrap();
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        format!("http://{address}")
    }

    fn client_with_exporter(
        base_url: String,
    ) -> (TwirpClient, SdkMeterProvider, InMemoryMetricExporter) {
        let exporter = InMemoryMetricExporter::default();
        let provider = SdkMeterProvider::builder()
            .with_reader(PeriodicReader::builder(exporter.clone()).build())
            .build();
        let client = TwirpClient::new(base_url).with_meter(&provider.meter("test"));
        (client, provider, exporter)
    }

    /// Attribute key/value pairs and observation count of each point of `rpc.client.duration`.
    fn recorded(
        provider: &SdkMeterProvider,
        exporter: &InMemoryMetricExporter,
    ) -> (String, Vec<(Vec<(String, String)>, u64)>) {
        provider.force_flush().unwrap();
        let exported = exporter.get_finished_metrics().unwrap();
        let metric = exported
            .iter()
            .flat_map(|resource| resource.scope_metrics())
            .flat_map(|scope| scope.metrics())
            .find(|metric| metric.name() == "rpc.client.duration")
            .expect("rpc.client.duration was recorded");
        let AggregatedMetrics::F64(MetricData::Histogram(histogram)) = metric.data() else {
            panic!("rpc.client.duration is not an f64 histogram");
        };
        let points = histogram
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
        (metric.unit().to_owned(), points)
    }

    fn pairs(items: &[(&str, &str)]) -> Vec<(String, String)> {
        let mut pairs: Vec<_> = items
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        pairs.sort();
        pairs
    }

    #[tokio::test]
    async fn test_call_records_a_successful_call_without_error_type() {
        let url = serve_once("200 OK", "{}").await;
        let (client, provider, exporter) = client_with_exporter(url);

        let _: Value = client
            .call("woofx3.db.Test", "Get", &Value::Null)
            .await
            .unwrap();

        let (unit, points) = recorded(&provider, &exporter);
        assert_eq!(unit, "s");
        assert_eq!(
            points,
            vec![(
                pairs(&[
                    ("rpc.system", "twirp"),
                    ("rpc.service", "woofx3.db.Test"),
                    ("rpc.method", "Get")
                ]),
                1
            )]
        );
    }

    #[tokio::test]
    async fn test_call_records_the_twirp_error_code_as_error_type() {
        let url = serve_once(
            "404 Not Found",
            r#"{"code":"not_found","msg":"no such row"}"#,
        )
        .await;
        let (client, provider, exporter) = client_with_exporter(url);

        let result: Result<Value, TwirpError> =
            client.call("woofx3.db.Test", "Get", &Value::Null).await;

        assert!(matches!(result, Err(TwirpError::Twirp { .. })));
        let (_, points) = recorded(&provider, &exporter);
        assert_eq!(
            points,
            vec![(
                pairs(&[
                    ("rpc.system", "twirp"),
                    ("rpc.service", "woofx3.db.Test"),
                    ("rpc.method", "Get"),
                    ("error.type", "not_found"),
                ]),
                1
            )]
        );
    }

    #[tokio::test]
    async fn test_call_records_a_refused_connection_as_a_request_error() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let (client, provider, exporter) = client_with_exporter(url);

        let result: Result<Value, TwirpError> =
            client.call("woofx3.db.Test", "Get", &Value::Null).await;

        assert!(matches!(result, Err(TwirpError::Request(_))));
        let (_, points) = recorded(&provider, &exporter);
        assert!(
            points[0]
                .0
                .contains(&("error.type".to_owned(), "request".to_owned()))
        );
    }
}
