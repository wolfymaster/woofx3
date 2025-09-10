// @generated
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ResponseStatus {
    #[prost(enumeration="response_status::Code", tag="1")]
    pub code: i32,
    #[prost(string, tag="2")]
    pub message: ::prost::alloc::string::String,
}
/// Nested message and enum types in `ResponseStatus`.
pub mod response_status {
    #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, ::prost::Enumeration)]
    #[repr(i32)]
    pub enum Code {
        Ok = 0,
        InvalidArgument = 1,
        NotFound = 2,
        PermissionDenied = 3,
        Internal = 4,
    }
    impl Code {
        /// String value of the enum field names used in the ProtoBuf definition.
        ///
        /// The values are not transformed in any way and thus are considered stable
        /// (if the ProtoBuf definition does not change) and safe for programmatic use.
        pub fn as_str_name(&self) -> &'static str {
            match self {
                Code::Ok => "OK",
                Code::InvalidArgument => "INVALID_ARGUMENT",
                Code::NotFound => "NOT_FOUND",
                Code::PermissionDenied => "PERMISSION_DENIED",
                Code::Internal => "INTERNAL",
            }
        }
        /// Creates an enum from field names used in the ProtoBuf definition.
        pub fn from_str_name(value: &str) -> ::core::option::Option<Self> {
            match value {
                "OK" => Some(Self::Ok),
                "INVALID_ARGUMENT" => Some(Self::InvalidArgument),
                "NOT_FOUND" => Some(Self::NotFound),
                "PERMISSION_DENIED" => Some(Self::PermissionDenied),
                "INTERNAL" => Some(Self::Internal),
                _ => None,
            }
        }
    }
}
include!("common.serde.rs");
// @@protoc_insertion_point(module)