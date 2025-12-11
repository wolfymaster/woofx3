// @generated
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct HasPermissionRequest {
    #[prost(string, tag="1")]
    pub username: ::prost::alloc::string::String,
    #[prost(string, tag="2")]
    pub resource: ::prost::alloc::string::String,
    #[prost(string, tag="3")]
    pub action: ::prost::alloc::string::String,
}
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct PermissionRequest {
    #[prost(string, tag="1")]
    pub application_id: ::prost::alloc::string::String,
    #[prost(string, tag="2")]
    pub subject: ::prost::alloc::string::String,
    #[prost(string, tag="3")]
    pub object: ::prost::alloc::string::String,
    #[prost(string, tag="4")]
    pub action: ::prost::alloc::string::String,
    #[prost(string, tag="5")]
    pub permission: ::prost::alloc::string::String,
}
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct UserResourceRoleRequest {
    #[prost(string, tag="1")]
    pub application_id: ::prost::alloc::string::String,
    #[prost(string, tag="2")]
    pub username: ::prost::alloc::string::String,
    #[prost(string, tag="3")]
    pub resource: ::prost::alloc::string::String,
    #[prost(string, tag="4")]
    pub role: ::prost::alloc::string::String,
}
include!("permission.serde.rs");
include!("permission.tonic.rs");
// @@protoc_insertion_point(module)