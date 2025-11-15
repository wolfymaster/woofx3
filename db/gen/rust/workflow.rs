// @generated
/// Workflow definition
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Workflow {
    /// Unique identifier
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
    /// Human-readable name
    #[prost(string, tag="2")]
    pub name: ::prost::alloc::string::String,
    /// Description of the workflow
    #[prost(string, tag="3")]
    pub description: ::prost::alloc::string::String,
    /// ID of the application this workflow belongs to
    #[prost(string, tag="4")]
    pub application_id: ::prost::alloc::string::String,
    /// User ID who created the workflow
    #[prost(string, tag="5")]
    pub created_by: ::prost::alloc::string::String,
    /// Whether the workflow is enabled
    #[prost(bool, tag="6")]
    pub enabled: bool,
    /// Steps in the workflow
    #[prost(message, repeated, tag="7")]
    pub steps: ::prost::alloc::vec::Vec<WorkflowStep>,
    /// Default variables for the workflow
    #[prost(map="string, string", tag="8")]
    pub variables: ::std::collections::HashMap<::prost::alloc::string::String, ::prost::alloc::string::String>,
    /// ID of the next workflow to execute on success
    #[prost(string, tag="9")]
    pub on_success: ::prost::alloc::string::String,
    /// ID of the next workflow to execute on failure
    #[prost(string, tag="10")]
    pub on_failure: ::prost::alloc::string::String,
    /// Maximum number of retries for failed steps
    #[prost(int32, tag="11")]
    pub max_retries: i32,
    /// Global timeout for the workflow in seconds
    #[prost(int32, tag="12")]
    pub timeout_seconds: i32,
    #[prost(message, optional, tag="13")]
    pub created_at: ::core::option::Option<::prost_types::Timestamp>,
    #[prost(message, optional, tag="14")]
    pub updated_at: ::core::option::Option<::prost_types::Timestamp>,
}
/// A single step in a workflow
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct WorkflowStep {
    /// Unique identifier for the step
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
    /// Human-readable name
    #[prost(string, tag="2")]
    pub name: ::prost::alloc::string::String,
    /// Description of the step
    #[prost(string, tag="3")]
    pub description: ::prost::alloc::string::String,
    /// Type of step (e.g., "command", "http", "condition")
    #[prost(string, tag="4")]
    pub r#type: ::prost::alloc::string::String,
    /// Step-specific parameters
    #[prost(map="string, string", tag="5")]
    pub parameters: ::std::collections::HashMap<::prost::alloc::string::String, ::prost::alloc::string::String>,
    /// ID of the next step on success
    #[prost(string, tag="6")]
    pub on_success: ::prost::alloc::string::String,
    /// ID of the next step on failure
    #[prost(string, tag="7")]
    pub on_failure: ::prost::alloc::string::String,
    /// Step-specific timeout in seconds
    #[prost(int32, tag="8")]
    pub timeout_seconds: i32,
    /// Number of retry attempts for this step
    #[prost(int32, tag="9")]
    pub retry_attempts: i32,
    /// Whether to execute this step asynchronously
    #[prost(bool, tag="10")]
    pub r#async: bool,
    /// Output variable mappings
    #[prost(map="string, string", tag="11")]
    pub outputs: ::std::collections::HashMap<::prost::alloc::string::String, ::prost::alloc::string::String>,
}
/// Workflow execution
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct WorkflowExecution {
    /// Unique identifier for the execution
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
    /// ID of the workflow being executed
    #[prost(string, tag="2")]
    pub workflow_id: ::prost::alloc::string::String,
    /// Current status (pending, running, completed, failed, cancelled)
    #[prost(string, tag="3")]
    pub status: ::prost::alloc::string::String,
    /// User ID who triggered the execution
    #[prost(string, tag="4")]
    pub started_by: ::prost::alloc::string::String,
    /// ID of the application
    #[prost(string, tag="5")]
    pub application_id: ::prost::alloc::string::String,
    /// Input variables for the workflow
    #[prost(map="string, string", tag="6")]
    pub inputs: ::std::collections::HashMap<::prost::alloc::string::String, ::prost::alloc::string::String>,
    /// Output variables from the workflow
    #[prost(map="string, string", tag="7")]
    pub outputs: ::std::collections::HashMap<::prost::alloc::string::String, ::prost::alloc::string::String>,
    /// Error message if the execution failed
    #[prost(string, tag="8")]
    pub error: ::prost::alloc::string::String,
    #[prost(message, optional, tag="9")]
    pub started_at: ::core::option::Option<::prost_types::Timestamp>,
    #[prost(message, optional, tag="10")]
    pub completed_at: ::core::option::Option<::prost_types::Timestamp>,
    #[prost(message, optional, tag="11")]
    pub created_at: ::core::option::Option<::prost_types::Timestamp>,
    #[prost(message, optional, tag="12")]
    pub updated_at: ::core::option::Option<::prost_types::Timestamp>,
    /// Execution details for each step
    #[prost(message, repeated, tag="13")]
    pub steps: ::prost::alloc::vec::Vec<ExecutionStep>,
}
/// Execution details for a single step
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ExecutionStep {
    /// ID of the workflow step
    #[prost(string, tag="1")]
    pub step_id: ::prost::alloc::string::String,
    /// Name of the step
    #[prost(string, tag="2")]
    pub name: ::prost::alloc::string::String,
    /// Current status (pending, running, completed, failed, skipped)
    #[prost(string, tag="3")]
    pub status: ::prost::alloc::string::String,
    /// Current attempt number (1-based)
    #[prost(int32, tag="4")]
    pub attempt: i32,
    /// Error message if the step failed
    #[prost(string, tag="5")]
    pub error: ::prost::alloc::string::String,
    /// Input variables for the step
    #[prost(map="string, string", tag="6")]
    pub inputs: ::std::collections::HashMap<::prost::alloc::string::String, ::prost::alloc::string::String>,
    /// Output variables from the step
    #[prost(map="string, string", tag="7")]
    pub outputs: ::std::collections::HashMap<::prost::alloc::string::String, ::prost::alloc::string::String>,
    #[prost(message, optional, tag="8")]
    pub started_at: ::core::option::Option<::prost_types::Timestamp>,
    #[prost(message, optional, tag="9")]
    pub completed_at: ::core::option::Option<::prost_types::Timestamp>,
    /// Duration in milliseconds
    #[prost(int64, tag="10")]
    pub duration_ms: i64,
}
/// Request to create a new workflow
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct CreateWorkflowRequest {
    #[prost(string, tag="1")]
    pub name: ::prost::alloc::string::String,
    #[prost(string, tag="2")]
    pub description: ::prost::alloc::string::String,
    #[prost(string, tag="3")]
    pub application_id: ::prost::alloc::string::String,
    #[prost(string, tag="4")]
    pub created_by: ::prost::alloc::string::String,
    #[prost(bool, tag="5")]
    pub enabled: bool,
    #[prost(message, repeated, tag="6")]
    pub steps: ::prost::alloc::vec::Vec<WorkflowStep>,
    #[prost(map="string, string", tag="7")]
    pub variables: ::std::collections::HashMap<::prost::alloc::string::String, ::prost::alloc::string::String>,
    #[prost(string, tag="8")]
    pub on_success: ::prost::alloc::string::String,
    #[prost(string, tag="9")]
    pub on_failure: ::prost::alloc::string::String,
    #[prost(int32, tag="10")]
    pub max_retries: i32,
    #[prost(int32, tag="11")]
    pub timeout_seconds: i32,
}
/// Request to get a workflow by ID
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct GetWorkflowRequest {
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
}
/// Response containing a single workflow
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct WorkflowResponse {
    #[prost(message, optional, tag="1")]
    pub status: ::core::option::Option<super::common::ResponseStatus>,
    #[prost(message, optional, tag="2")]
    pub workflow: ::core::option::Option<Workflow>,
}
/// Request to update an existing workflow
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct UpdateWorkflowRequest {
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
    #[prost(string, tag="2")]
    pub name: ::prost::alloc::string::String,
    #[prost(string, tag="3")]
    pub description: ::prost::alloc::string::String,
    #[prost(bool, tag="4")]
    pub enabled: bool,
    #[prost(message, repeated, tag="5")]
    pub steps: ::prost::alloc::vec::Vec<WorkflowStep>,
    #[prost(map="string, string", tag="6")]
    pub variables: ::std::collections::HashMap<::prost::alloc::string::String, ::prost::alloc::string::String>,
    #[prost(string, tag="7")]
    pub on_success: ::prost::alloc::string::String,
    #[prost(string, tag="8")]
    pub on_failure: ::prost::alloc::string::String,
    #[prost(int32, tag="9")]
    pub max_retries: i32,
    #[prost(int32, tag="10")]
    pub timeout_seconds: i32,
}
/// Request to delete a workflow
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct DeleteWorkflowRequest {
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
}
/// Request to list workflows
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ListWorkflowsRequest {
    #[prost(string, tag="1")]
    pub application_id: ::prost::alloc::string::String,
    #[prost(bool, tag="2")]
    pub include_disabled: bool,
    #[prost(int32, tag="3")]
    pub page: i32,
    #[prost(int32, tag="4")]
    pub page_size: i32,
    /// Field to sort by (e.g., "name", "created_at")
    #[prost(string, tag="5")]
    pub sort_by: ::prost::alloc::string::String,
    /// Whether to sort in descending order
    #[prost(bool, tag="6")]
    pub sort_desc: bool,
}
/// Response containing a list of workflows
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ListWorkflowsResponse {
    #[prost(message, optional, tag="1")]
    pub status: ::core::option::Option<super::common::ResponseStatus>,
    #[prost(message, repeated, tag="2")]
    pub workflows: ::prost::alloc::vec::Vec<Workflow>,
    #[prost(int32, tag="3")]
    pub total_count: i32,
    #[prost(int32, tag="4")]
    pub page: i32,
    #[prost(int32, tag="5")]
    pub page_size: i32,
}
/// Request to execute a workflow
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ExecuteWorkflowRequest {
    /// ID of the workflow to execute
    #[prost(string, tag="1")]
    pub workflow_id: ::prost::alloc::string::String,
    /// ID of the application
    #[prost(string, tag="2")]
    pub application_id: ::prost::alloc::string::String,
    /// User ID who triggered the execution
    #[prost(string, tag="3")]
    pub started_by: ::prost::alloc::string::String,
    /// Input variables for the workflow
    #[prost(map="string, string", tag="4")]
    pub inputs: ::std::collections::HashMap<::prost::alloc::string::String, ::prost::alloc::string::String>,
    /// Whether to execute asynchronously
    #[prost(bool, tag="5")]
    pub r#async: bool,
    /// Correlation ID for tracing
    #[prost(string, tag="6")]
    pub correlation_id: ::prost::alloc::string::String,
}
/// Response from executing a workflow
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ExecuteWorkflowResponse {
    #[prost(message, optional, tag="1")]
    pub status: ::core::option::Option<super::common::ResponseStatus>,
    /// ID of the workflow execution
    #[prost(string, tag="2")]
    pub execution_id: ::prost::alloc::string::String,
    /// Whether the execution is running asynchronously
    #[prost(bool, tag="3")]
    pub r#async: bool,
    /// URL to check the status of the execution
    #[prost(string, tag="4")]
    pub status_url: ::prost::alloc::string::String,
    /// Output variables (if execution completed synchronously)
    #[prost(map="string, string", tag="5")]
    pub outputs: ::std::collections::HashMap<::prost::alloc::string::String, ::prost::alloc::string::String>,
}
/// Request to get a workflow execution
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct GetWorkflowExecutionRequest {
    /// Execution ID
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
}
/// Response containing workflow execution details
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct WorkflowExecutionResponse {
    #[prost(message, optional, tag="1")]
    pub status: ::core::option::Option<super::common::ResponseStatus>,
    #[prost(message, optional, tag="2")]
    pub execution: ::core::option::Option<WorkflowExecution>,
}
/// Request to list workflow executions
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ListWorkflowExecutionsRequest {
    /// Filter by workflow ID
    #[prost(string, tag="1")]
    pub workflow_id: ::prost::alloc::string::String,
    /// Filter by application ID
    #[prost(string, tag="2")]
    pub application_id: ::prost::alloc::string::String,
    /// Filter by status
    #[prost(string, tag="3")]
    pub status: ::prost::alloc::string::String,
    /// Filter by user who started the execution
    #[prost(string, tag="4")]
    pub started_by: ::prost::alloc::string::String,
    /// Filter by start time (inclusive)
    #[prost(message, optional, tag="5")]
    pub from: ::core::option::Option<::prost_types::Timestamp>,
    /// Filter by end time (inclusive)
    #[prost(message, optional, tag="6")]
    pub to: ::core::option::Option<::prost_types::Timestamp>,
    #[prost(int32, tag="7")]
    pub page: i32,
    #[prost(int32, tag="8")]
    pub page_size: i32,
    /// Field to sort by (e.g., "started_at", "completed_at")
    #[prost(string, tag="9")]
    pub sort_by: ::prost::alloc::string::String,
    /// Whether to sort in descending order
    #[prost(bool, tag="10")]
    pub sort_desc: bool,
}
/// Response containing a list of workflow executions
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ListWorkflowExecutionsResponse {
    #[prost(message, optional, tag="1")]
    pub status: ::core::option::Option<super::common::ResponseStatus>,
    #[prost(message, repeated, tag="2")]
    pub executions: ::prost::alloc::vec::Vec<WorkflowExecution>,
    #[prost(int32, tag="3")]
    pub total_count: i32,
    #[prost(int32, tag="4")]
    pub page: i32,
    #[prost(int32, tag="5")]
    pub page_size: i32,
}
/// Request to cancel a workflow execution
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct CancelWorkflowExecutionRequest {
    /// Execution ID
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
    /// Optional reason for cancellation
    #[prost(string, tag="2")]
    pub reason: ::prost::alloc::string::String,
}
include!("workflow.serde.rs");
include!("workflow.tonic.rs");
// @@protoc_insertion_point(module)