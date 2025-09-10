// @generated
/// Setting represents a configuration setting
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Setting {
    /// Unique identifier
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
    /// Setting key (unique within scope)
    #[prost(string, tag="2")]
    pub key: ::prost::alloc::string::String,
    /// Setting value (can be any JSON-serializable type)
    #[prost(message, optional, tag="3")]
    pub value: ::core::option::Option<::prost_types::Value>,
    /// Value type (e.g., "string", "number", "boolean", "object")
    #[prost(string, tag="4")]
    pub value_type: ::prost::alloc::string::String,
    /// ID of the application this setting belongs to (for app settings)
    #[prost(string, tag="5")]
    pub application_id: ::prost::alloc::string::String,
    #[prost(message, optional, tag="14")]
    pub created_at: ::core::option::Option<::prost_types::Timestamp>,
    #[prost(message, optional, tag="15")]
    pub updated_at: ::core::option::Option<::prost_types::Timestamp>,
}
/// Request to get a setting by key
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct GetSettingRequest {
    /// Setting key
    #[prost(string, tag="1")]
    pub key: ::prost::alloc::string::String,
    /// Optional: Application ID for app-specific settings
    #[prost(string, tag="2")]
    pub application_id: ::prost::alloc::string::String,
}
/// Response containing a single setting
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct SettingResponse {
    #[prost(message, optional, tag="1")]
    pub status: ::core::option::Option<super::common::ResponseStatus>,
    #[prost(message, optional, tag="2")]
    pub setting: ::core::option::Option<Setting>,
}
/// Request to get multiple settings by keys
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct GetSettingsRequest {
    /// Keys of the settings to retrieve
    #[prost(string, repeated, tag="1")]
    pub keys: ::prost::alloc::vec::Vec<::prost::alloc::string::String>,
    /// Optional: Application ID for app-specific settings
    #[prost(string, tag="2")]
    pub application_id: ::prost::alloc::string::String,
}
/// Response containing multiple settings
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct GetSettingsResponse {
    #[prost(message, optional, tag="1")]
    pub status: ::core::option::Option<super::common::ResponseStatus>,
    #[prost(message, repeated, tag="2")]
    pub settings: ::prost::alloc::vec::Vec<Setting>,
}
/// Request to set a setting value
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct SetSettingRequest {
    /// Setting key
    #[prost(string, tag="1")]
    pub key: ::prost::alloc::string::String,
    /// New value for the setting
    #[prost(message, optional, tag="2")]
    pub value: ::core::option::Option<::prost_types::Value>,
    /// Application ID for app-specific settings
    #[prost(string, tag="4")]
    pub application_id: ::prost::alloc::string::String,
}
/// Request to set multiple settings at once
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct SetSettingsRequest {
    #[prost(message, repeated, tag="1")]
    pub settings: ::prost::alloc::vec::Vec<set_settings_request::SettingUpdate>,
    /// Application ID for app-specific settings
    #[prost(string, tag="2")]
    pub application_id: ::prost::alloc::string::String,
}
/// Nested message and enum types in `SetSettingsRequest`.
pub mod set_settings_request {
    #[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
    pub struct SettingUpdate {
        #[prost(string, tag="1")]
        pub key: ::prost::alloc::string::String,
        #[prost(message, optional, tag="2")]
        pub value: ::core::option::Option<::prost_types::Value>,
    }
}
/// Response from setting multiple settings
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct SetSettingsResponse {
    #[prost(message, optional, tag="1")]
    pub status: ::core::option::Option<super::common::ResponseStatus>,
    /// List of updated settings
    #[prost(message, repeated, tag="2")]
    pub settings: ::prost::alloc::vec::Vec<Setting>,
}
/// Request to delete a setting
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct DeleteSettingRequest {
    /// Key of the setting to delete
    #[prost(string, tag="1")]
    pub key: ::prost::alloc::string::String,
    /// Optional: Application ID for app-specific settings
    #[prost(string, tag="2")]
    pub application_id: ::prost::alloc::string::String,
}
include!("setting.serde.rs");
// @@protoc_insertion_point(module)