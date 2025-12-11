// @generated
/// Command represents a chat command that can be executed
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Command {
    /// Unique identifier for the command
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
    /// ID of the application this command belongs to
    #[prost(string, tag="2")]
    pub application_id: ::prost::alloc::string::String,
    /// Name of the command (without the prefix)
    #[prost(string, tag="3")]
    pub command: ::prost::alloc::string::String,
    /// Type of command (e.g., "text", "function", "eval")
    #[prost(string, tag="4")]
    pub r#type: ::prost::alloc::string::String,
    /// Value of the command type
    #[prost(string, tag="5")]
    pub type_value: ::prost::alloc::string::String,
    /// Cooldown between command uses in seconds
    #[prost(int32, tag="6")]
    pub cooldown: i32,
    /// Priority of the command
    #[prost(int32, tag="7")]
    pub priority: i32,
    /// Whether the command is enabled
    #[prost(bool, tag="13")]
    pub enabled: bool,
    /// User ID who created this command
    #[prost(string, tag="14")]
    pub created_by: ::prost::alloc::string::String,
    #[prost(message, optional, tag="15")]
    pub created_at: ::core::option::Option<::prost_types::Timestamp>,
}
/// Request to get a single command by ID
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct GetCommandRequest {
    #[prost(string, tag="1")]
    pub command: ::prost::alloc::string::String,
    #[prost(string, tag="2")]
    pub application_id: ::prost::alloc::string::String,
    #[prost(string, optional, tag="3")]
    pub username: ::core::option::Option<::prost::alloc::string::String>,
}
/// Response containing a single command
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct CommandResponse {
    #[prost(message, optional, tag="1")]
    pub status: ::core::option::Option<super::common::ResponseStatus>,
    #[prost(message, optional, tag="2")]
    pub command: ::core::option::Option<Command>,
}
/// Request to list commands with optional filters
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ListCommandsRequest {
    #[prost(string, tag="1")]
    pub application_id: ::prost::alloc::string::String,
    #[prost(bool, tag="2")]
    pub include_disabled: bool,
}
/// Response containing a list of commands
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ListCommandsResponse {
    #[prost(message, optional, tag="1")]
    pub status: ::core::option::Option<super::common::ResponseStatus>,
    #[prost(message, repeated, tag="2")]
    pub commands: ::prost::alloc::vec::Vec<Command>,
}
/// Request to create a new command
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct CreateCommandRequest {
    #[prost(string, tag="1")]
    pub application_id: ::prost::alloc::string::String,
    #[prost(string, tag="2")]
    pub command: ::prost::alloc::string::String,
    #[prost(bool, tag="3")]
    pub enabled: bool,
    #[prost(int32, tag="4")]
    pub cooldown: i32,
    #[prost(string, tag="5")]
    pub r#type: ::prost::alloc::string::String,
    #[prost(string, tag="6")]
    pub type_value: ::prost::alloc::string::String,
    #[prost(int32, tag="7")]
    pub priority: i32,
    #[prost(string, tag="8")]
    pub created_by: ::prost::alloc::string::String,
}
/// Request to update an existing command
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct UpdateCommandRequest {
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
    #[prost(string, tag="2")]
    pub command: ::prost::alloc::string::String,
    #[prost(bool, tag="3")]
    pub enabled: bool,
    #[prost(int32, tag="4")]
    pub cooldown: i32,
    #[prost(string, tag="5")]
    pub r#type: ::prost::alloc::string::String,
    #[prost(string, tag="6")]
    pub type_value: ::prost::alloc::string::String,
    #[prost(int32, tag="7")]
    pub priority: i32,
}
/// Request to delete a command
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct DeleteCommandRequest {
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
}
include!("command.serde.rs");
include!("command.tonic.rs");
// @@protoc_insertion_point(module)