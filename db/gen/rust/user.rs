// @generated
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct User {
    /// Unique identifier in our application
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
    #[prost(string, tag="2")]
    pub username: ::prost::alloc::string::String,
    /// External platform user ID
    #[prost(string, tag="3")]
    pub user_id: ::prost::alloc::string::String,
    /// Platform identifier (e.g., 'twitch', 'youtube')
    #[prost(string, tag="4")]
    pub platform: ::prost::alloc::string::String,
    #[prost(message, optional, tag="5")]
    pub created_at: ::core::option::Option<::prost_types::Timestamp>,
    #[prost(message, optional, tag="6")]
    pub updated_at: ::core::option::Option<::prost_types::Timestamp>,
}
/// Requests and Responses
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct CreateUserRequest {
    #[prost(string, tag="1")]
    pub username: ::prost::alloc::string::String,
    /// External platform user ID
    #[prost(string, tag="2")]
    pub user_id: ::prost::alloc::string::String,
    /// Platform identifier (e.g., 'twitch', 'youtube')
    #[prost(string, tag="3")]
    pub platform: ::prost::alloc::string::String,
}
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct GetUserRequest {
    /// Our application's user ID
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
}
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct UpdateUserRequest {
    /// Our application's user ID
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
    #[prost(string, tag="2")]
    pub username: ::prost::alloc::string::String,
    /// Platform identifier (e.g., 'twitch', 'youtube')
    #[prost(string, tag="3")]
    pub platform: ::prost::alloc::string::String,
}
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct DeleteUserRequest {
    /// Our application's user ID
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
}
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct UserResponse {
    #[prost(message, optional, tag="1")]
    pub status: ::core::option::Option<super::common::ResponseStatus>,
    #[prost(message, optional, tag="2")]
    pub user: ::core::option::Option<User>,
}
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct GetUserTokenRequest {
    #[prost(string, tag="1")]
    pub user_id: ::prost::alloc::string::String,
    #[prost(string, tag="2")]
    pub client_id: ::prost::alloc::string::String,
}
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct GetUserTokenResponse {
    #[prost(message, optional, tag="1")]
    pub status: ::core::option::Option<super::common::ResponseStatus>,
    #[prost(string, tag="2")]
    pub token: ::prost::alloc::string::String,
    #[prost(string, tag="3")]
    pub refresh_token: ::prost::alloc::string::String,
    #[prost(int64, tag="4")]
    pub expires_in: i64,
    #[prost(string, tag="5")]
    pub token_type: ::prost::alloc::string::String,
}
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct GetBroadcasterTokenRequest {
    #[prost(string, tag="1")]
    pub broadcaster_id: ::prost::alloc::string::String,
}
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct GetBroadcasterTokenResponse {
    #[prost(message, optional, tag="1")]
    pub status: ::core::option::Option<super::common::ResponseStatus>,
    #[prost(string, tag="2")]
    pub token: ::prost::alloc::string::String,
    #[prost(int64, tag="3")]
    pub expires_in: i64,
    #[prost(string, tag="4")]
    pub token_type: ::prost::alloc::string::String,
}
include!("user.serde.rs");
// @@protoc_insertion_point(module)