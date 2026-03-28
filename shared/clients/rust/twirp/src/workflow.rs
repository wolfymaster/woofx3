use crate::{TwirpClient, TwirpError};
use woofx3::db::common::ResponseStatus;
use woofx3::db::workflow::{
    CancelWorkflowExecutionRequest, CreateWorkflowRequest, DeleteWorkflowRequest,
    ExecuteWorkflowRequest, ExecuteWorkflowResponse, GetWorkflowExecutionRequest,
    GetWorkflowRequest, ListWorkflowExecutionsRequest, ListWorkflowExecutionsResponse,
    ListWorkflowsRequest, ListWorkflowsResponse, UpdateWorkflowRequest, WorkflowExecutionResponse,
    WorkflowResponse,
};

const SERVICE_NAME: &str = "workflow.WorkflowService";

#[derive(Clone)]
pub struct WorkflowServiceClient {
    client: TwirpClient,
}

impl WorkflowServiceClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            client: TwirpClient::new(base_url),
        }
    }

    pub fn with_client(client: TwirpClient) -> Self {
        Self { client }
    }

    pub async fn create_workflow(
        &self,
        request: CreateWorkflowRequest,
    ) -> Result<WorkflowResponse, TwirpError> {
        self.client
            .call(SERVICE_NAME, "CreateWorkflow", &request)
            .await
    }

    pub async fn get_workflow(
        &self,
        request: GetWorkflowRequest,
    ) -> Result<WorkflowResponse, TwirpError> {
        self.client
            .call(SERVICE_NAME, "GetWorkflow", &request)
            .await
    }

    pub async fn update_workflow(
        &self,
        request: UpdateWorkflowRequest,
    ) -> Result<WorkflowResponse, TwirpError> {
        self.client
            .call(SERVICE_NAME, "UpdateWorkflow", &request)
            .await
    }

    pub async fn delete_workflow(
        &self,
        request: DeleteWorkflowRequest,
    ) -> Result<ResponseStatus, TwirpError> {
        self.client
            .call(SERVICE_NAME, "DeleteWorkflow", &request)
            .await
    }

    pub async fn list_workflows(
        &self,
        request: ListWorkflowsRequest,
    ) -> Result<ListWorkflowsResponse, TwirpError> {
        self.client
            .call(SERVICE_NAME, "ListWorkflows", &request)
            .await
    }

    pub async fn execute_workflow(
        &self,
        request: ExecuteWorkflowRequest,
    ) -> Result<ExecuteWorkflowResponse, TwirpError> {
        self.client
            .call(SERVICE_NAME, "ExecuteWorkflow", &request)
            .await
    }

    pub async fn get_workflow_execution(
        &self,
        request: GetWorkflowExecutionRequest,
    ) -> Result<WorkflowExecutionResponse, TwirpError> {
        self.client
            .call(SERVICE_NAME, "GetWorkflowExecution", &request)
            .await
    }

    pub async fn list_workflow_executions(
        &self,
        request: ListWorkflowExecutionsRequest,
    ) -> Result<ListWorkflowExecutionsResponse, TwirpError> {
        self.client
            .call(SERVICE_NAME, "ListWorkflowExecutions", &request)
            .await
    }

    pub async fn cancel_workflow_execution(
        &self,
        request: CancelWorkflowExecutionRequest,
    ) -> Result<ResponseStatus, TwirpError> {
        self.client
            .call(SERVICE_NAME, "CancelWorkflowExecution", &request)
            .await
    }
}
