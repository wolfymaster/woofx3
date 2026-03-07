mod workflow;

pub use workflow::WorkflowServiceClient;

use reqwest::Client;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
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

#[derive(Debug, Deserialize)]
struct TwirpErrorResponse {
    code: String,
    msg: String,
}

#[derive(Clone)]
pub struct TwirpClient {
    client: Client,
    base_url: String,
}

impl TwirpClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.into(),
        }
    }

    pub fn with_client(client: Client, base_url: impl Into<String>) -> Self {
        Self {
            client,
            base_url: base_url.into(),
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
        ExecuteWorkflowRequest, ExecuteWorkflowResponse, ExecutionStep, GetWorkflowExecutionRequest,
        GetWorkflowRequest, ListWorkflowExecutionsRequest, ListWorkflowExecutionsResponse,
        ListWorkflowsRequest, ListWorkflowsResponse, UpdateWorkflowRequest, Workflow,
        WorkflowExecution, WorkflowExecutionResponse, WorkflowResponse, WorkflowStep,
    };
}
