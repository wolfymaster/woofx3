// @generated
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Application {
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
    #[prost(string, tag="2")]
    pub name: ::prost::alloc::string::String,
    #[prost(string, tag="4")]
    pub owner_id: ::prost::alloc::string::String,
    #[prost(message, repeated, tag="5")]
    pub clients: ::prost::alloc::vec::Vec<Client>,
    #[prost(bool, tag="6")]
    pub enabled: bool,
    #[prost(message, optional, tag="15")]
    pub created_at: ::core::option::Option<::prost_types::Timestamp>,
}
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Client {
    #[prost(string, tag="1")]
    pub client_id: ::prost::alloc::string::String,
    #[prost(string, tag="2")]
    pub client_secret: ::prost::alloc::string::String,
}
// Requests and Responses

/// Create a new application
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct CreateApplicationRequest {
    #[prost(string, tag="1")]
    pub name: ::prost::alloc::string::String,
    #[prost(string, tag="2")]
    pub owner_id: ::prost::alloc::string::String,
}
/// Get an application by ID or client ID
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct GetApplicationRequest {
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
}
/// Update an existing application
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct UpdateApplicationRequest {
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
    #[prost(string, tag="2")]
    pub name: ::prost::alloc::string::String,
    #[prost(bool, tag="3")]
    pub enabled: bool,
}
/// Delete an application
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct DeleteApplicationRequest {
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
}
/// List applications with optional filtering
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ListApplicationsRequest {
    #[prost(string, tag="1")]
    pub owner_id: ::prost::alloc::string::String,
    #[prost(bool, tag="2")]
    pub include_inactive: bool,
    #[prost(string, tag="3")]
    pub query: ::prost::alloc::string::String,
}
/// Response containing a single application
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ApplicationResponse {
    #[prost(message, optional, tag="1")]
    pub status: ::core::option::Option<super::common::ResponseStatus>,
    #[prost(message, optional, tag="2")]
    pub application: ::core::option::Option<Application>,
}
/// Response containing a list of applications
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ListApplicationsResponse {
    #[prost(message, optional, tag="1")]
    pub status: ::core::option::Option<super::common::ResponseStatus>,
    #[prost(message, repeated, tag="2")]
    pub applications: ::prost::alloc::vec::Vec<Application>,
}
include!("application.serde.rs");
// @@protoc_insertion_point(module)