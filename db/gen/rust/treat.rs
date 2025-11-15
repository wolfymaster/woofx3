// @generated
/// Treat represents a reward or treat given to a user
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Treat {
    /// Unique identifier
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
    /// ID of the user who received the treat
    #[prost(string, tag="2")]
    pub user_id: ::prost::alloc::string::String,
    /// Type/category of the treat
    #[prost(string, tag="3")]
    pub treat_type: ::prost::alloc::string::String,
    /// Human-readable title
    #[prost(string, tag="4")]
    pub title: ::prost::alloc::string::String,
    /// Description of the treat
    #[prost(string, tag="5")]
    pub description: ::prost::alloc::string::String,
    /// Point value of the treat
    #[prost(int32, tag="6")]
    pub points: i32,
    /// Optional image URL
    #[prost(string, tag="7")]
    pub image_url: ::prost::alloc::string::String,
    /// User ID who awarded the treat (empty for system)
    #[prost(string, tag="8")]
    pub awarded_by: ::prost::alloc::string::String,
    /// ID of the application this treat is associated with
    #[prost(string, tag="9")]
    pub application_id: ::prost::alloc::string::String,
    /// Additional metadata
    #[prost(map="string, string", tag="10")]
    pub metadata: ::std::collections::HashMap<::prost::alloc::string::String, ::prost::alloc::string::String>,
    #[prost(message, optional, tag="11")]
    pub awarded_at: ::core::option::Option<::prost_types::Timestamp>,
    /// Optional expiration time
    #[prost(message, optional, tag="12")]
    pub expires_at: ::core::option::Option<::prost_types::Timestamp>,
    #[prost(message, optional, tag="13")]
    pub created_at: ::core::option::Option<::prost_types::Timestamp>,
    #[prost(message, optional, tag="14")]
    pub updated_at: ::core::option::Option<::prost_types::Timestamp>,
}
/// Request to award a treat to a user
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct AwardTreatRequest {
    /// ID of the user to award the treat to
    #[prost(string, tag="1")]
    pub user_id: ::prost::alloc::string::String,
    /// Type/category of the treat
    #[prost(string, tag="2")]
    pub treat_type: ::prost::alloc::string::String,
    /// Human-readable title
    #[prost(string, tag="3")]
    pub title: ::prost::alloc::string::String,
    /// Description of the treat
    #[prost(string, tag="4")]
    pub description: ::prost::alloc::string::String,
    /// Point value of the treat
    #[prost(int32, tag="5")]
    pub points: i32,
    /// Optional image URL
    #[prost(string, tag="6")]
    pub image_url: ::prost::alloc::string::String,
    /// User ID who is awarding the treat (empty for system)
    #[prost(string, tag="7")]
    pub awarded_by: ::prost::alloc::string::String,
    /// ID of the application this treat is associated with
    #[prost(string, tag="8")]
    pub application_id: ::prost::alloc::string::String,
    /// Additional metadata
    #[prost(map="string, string", tag="9")]
    pub metadata: ::std::collections::HashMap<::prost::alloc::string::String, ::prost::alloc::string::String>,
    /// Optional expiration time
    #[prost(message, optional, tag="10")]
    pub expires_at: ::core::option::Option<::prost_types::Timestamp>,
}
/// Response containing a single treat
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct TreatResponse {
    #[prost(message, optional, tag="1")]
    pub status: ::core::option::Option<super::common::ResponseStatus>,
    #[prost(message, optional, tag="2")]
    pub treat: ::core::option::Option<Treat>,
}
/// Request to get a treat by ID
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct GetTreatRequest {
    /// Treat ID
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
}
/// Request to update a treat
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct UpdateTreatRequest {
    /// Treat ID
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
    /// Updated title
    #[prost(string, tag="2")]
    pub title: ::prost::alloc::string::String,
    /// Updated description
    #[prost(string, tag="3")]
    pub description: ::prost::alloc::string::String,
    /// Updated point value
    #[prost(int32, tag="4")]
    pub points: i32,
    /// Updated image URL
    #[prost(string, tag="5")]
    pub image_url: ::prost::alloc::string::String,
    /// Updated metadata
    #[prost(map="string, string", tag="6")]
    pub metadata: ::std::collections::HashMap<::prost::alloc::string::String, ::prost::alloc::string::String>,
    /// Updated expiration time
    #[prost(message, optional, tag="7")]
    pub expires_at: ::core::option::Option<::prost_types::Timestamp>,
}
/// Request to delete a treat
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct DeleteTreatRequest {
    /// Treat ID
    #[prost(string, tag="1")]
    pub id: ::prost::alloc::string::String,
}
/// Request to list treats with filtering
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ListTreatsRequest {
    /// Filter by user ID
    #[prost(string, tag="1")]
    pub user_id: ::prost::alloc::string::String,
    /// Filter by treat type
    #[prost(string, tag="2")]
    pub treat_type: ::prost::alloc::string::String,
    /// Filter by application ID
    #[prost(string, tag="3")]
    pub application_id: ::prost::alloc::string::String,
    /// Filter by award date (inclusive)
    #[prost(message, optional, tag="4")]
    pub from_date: ::core::option::Option<::prost_types::Timestamp>,
    /// Filter by award date (inclusive)
    #[prost(message, optional, tag="5")]
    pub to_date: ::core::option::Option<::prost_types::Timestamp>,
    /// Whether to include expired treats
    #[prost(bool, tag="6")]
    pub include_expired: bool,
    /// Minimum point value
    #[prost(int32, tag="7")]
    pub min_points: i32,
    /// Maximum point value
    #[prost(int32, tag="8")]
    pub max_points: i32,
    /// Page number for pagination (1-based)
    #[prost(int32, tag="9")]
    pub page: i32,
    /// Number of items per page
    #[prost(int32, tag="10")]
    pub page_size: i32,
    /// Field to sort by (e.g., "awarded_at", "points")
    #[prost(string, tag="11")]
    pub sort_by: ::prost::alloc::string::String,
    /// Whether to sort in descending order
    #[prost(bool, tag="12")]
    pub sort_desc: bool,
}
/// Response containing a list of treats
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ListTreatsResponse {
    #[prost(message, optional, tag="1")]
    pub status: ::core::option::Option<super::common::ResponseStatus>,
    #[prost(message, repeated, tag="2")]
    pub treats: ::prost::alloc::vec::Vec<Treat>,
    #[prost(int32, tag="3")]
    pub total_count: i32,
    #[prost(int32, tag="4")]
    pub page: i32,
    #[prost(int32, tag="5")]
    pub page_size: i32,
}
/// Request to get a summary of treats for a user
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct GetUserTreatsSummaryRequest {
    /// User ID
    #[prost(string, tag="1")]
    pub user_id: ::prost::alloc::string::String,
    /// Optional: Filter by application ID
    #[prost(string, tag="2")]
    pub application_id: ::prost::alloc::string::String,
    /// Optional: Start date for the summary period
    #[prost(message, optional, tag="3")]
    pub from_date: ::core::option::Option<::prost_types::Timestamp>,
    /// Optional: End date for the summary period
    #[prost(message, optional, tag="4")]
    pub to_date: ::core::option::Option<::prost_types::Timestamp>,
}
/// Summary of treats for a user
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct TreatsSummary {
    /// User ID
    #[prost(string, tag="1")]
    pub user_id: ::prost::alloc::string::String,
    /// Total number of treats
    #[prost(int32, tag="2")]
    pub total_treats: i32,
    /// Total points from all treats
    #[prost(int32, tag="3")]
    pub total_points: i32,
    /// Points grouped by treat type
    #[prost(map="string, int32", tag="4")]
    pub points_by_type: ::std::collections::HashMap<::prost::alloc::string::String, i32>,
    /// Most recent treats
    #[prost(message, repeated, tag="5")]
    pub recent_treats: ::prost::alloc::vec::Vec<Treat>,
    /// Start of the summary period
    #[prost(message, optional, tag="6")]
    pub from_date: ::core::option::Option<::prost_types::Timestamp>,
    /// End of the summary period
    #[prost(message, optional, tag="7")]
    pub to_date: ::core::option::Option<::prost_types::Timestamp>,
}
/// Response containing a treats summary
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct TreatsSummaryResponse {
    #[prost(message, optional, tag="1")]
    pub status: ::core::option::Option<super::common::ResponseStatus>,
    #[prost(message, optional, tag="2")]
    pub summary: ::core::option::Option<TreatsSummary>,
}
/// Request to get treat statistics
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct GetTreatStatsRequest {
    /// Optional: Filter by application ID
    #[prost(string, tag="1")]
    pub application_id: ::prost::alloc::string::String,
    /// Start date for the stats period
    #[prost(message, optional, tag="2")]
    pub from_date: ::core::option::Option<::prost_types::Timestamp>,
    /// End date for the stats period
    #[prost(message, optional, tag="3")]
    pub to_date: ::core::option::Option<::prost_types::Timestamp>,
    /// How to group the stats (e.g., "day", "week", "month", "treat_type")
    #[prost(string, tag="4")]
    pub group_by: ::prost::alloc::string::String,
    /// Optional: Filter by user IDs
    #[prost(string, repeated, tag="5")]
    pub user_ids: ::prost::alloc::vec::Vec<::prost::alloc::string::String>,
    /// Optional: Filter by treat types
    #[prost(string, repeated, tag="6")]
    pub treat_types: ::prost::alloc::vec::Vec<::prost::alloc::string::String>,
}
/// Statistics about treats
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct TreatStats {
    /// Data points for the stats
    #[prost(message, repeated, tag="1")]
    pub data_points: ::prost::alloc::vec::Vec<treat_stats::DataPoint>,
    /// Total number of treats
    #[prost(int32, tag="2")]
    pub total_treats: i32,
    /// Total points
    #[prost(int32, tag="3")]
    pub total_points: i32,
    /// Number of unique users with treats
    #[prost(int32, tag="4")]
    pub unique_users: i32,
    /// Points grouped by treat type
    #[prost(map="string, int32", tag="5")]
    pub points_by_type: ::std::collections::HashMap<::prost::alloc::string::String, i32>,
    /// Start of the stats period
    #[prost(message, optional, tag="6")]
    pub from_date: ::core::option::Option<::prost_types::Timestamp>,
    /// End of the stats period
    #[prost(message, optional, tag="7")]
    pub to_date: ::core::option::Option<::prost_types::Timestamp>,
}
/// Nested message and enum types in `TreatStats`.
pub mod treat_stats {
    #[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
    pub struct DataPoint {
        /// Label for the data point (e.g., date, treat type)
        #[prost(string, tag="1")]
        pub label: ::prost::alloc::string::String,
        /// Number of treats
        #[prost(int32, tag="2")]
        pub count: i32,
        /// Total points
        #[prost(int32, tag="3")]
        pub total_points: i32,
        /// Points by treat type
        #[prost(map="string, int32", tag="4")]
        pub points_by_type: ::std::collections::HashMap<::prost::alloc::string::String, i32>,
    }
}
/// Response containing treat statistics
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct TreatStatsResponse {
    #[prost(message, optional, tag="1")]
    pub status: ::core::option::Option<super::common::ResponseStatus>,
    #[prost(message, optional, tag="2")]
    pub stats: ::core::option::Option<TreatStats>,
}
include!("treat.serde.rs");
include!("treat.tonic.rs");
// @@protoc_insertion_point(module)