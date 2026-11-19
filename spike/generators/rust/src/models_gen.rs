#![allow(clippy::redundant_closure_call)]
#![allow(clippy::needless_lifetimes)]
#![allow(clippy::match_single_binding)]
#![allow(clippy::clone_on_copy)]

#[doc = "`ActionId`"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ActionId {
    #[serde(rename = "chat.send")]
    ChatSend,
    #[serde(rename = "chat.announce")]
    ChatAnnounce,
    #[serde(rename = "chat.pin")]
    ChatPin,
    #[serde(rename = "chat.delete")]
    ChatDelete,
    #[serde(rename = "moderation.warn")]
    ModerationWarn,
    #[serde(rename = "moderation.timeout")]
    ModerationTimeout,
    #[serde(rename = "moderation.ban")]
    ModerationBan,
}
impl ::std::fmt::Display for ActionId {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::ChatSend => f.write_str("chat.send"),
            Self::ChatAnnounce => f.write_str("chat.announce"),
            Self::ChatPin => f.write_str("chat.pin"),
            Self::ChatDelete => f.write_str("chat.delete"),
            Self::ModerationWarn => f.write_str("moderation.warn"),
            Self::ModerationTimeout => f.write_str("moderation.timeout"),
            Self::ModerationBan => f.write_str("moderation.ban"),
        }
    }
}
impl ::std::str::FromStr for ActionId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "chat.send" => Ok(Self::ChatSend),
            "chat.announce" => Ok(Self::ChatAnnounce),
            "chat.pin" => Ok(Self::ChatPin),
            "chat.delete" => Ok(Self::ChatDelete),
            "moderation.warn" => Ok(Self::ModerationWarn),
            "moderation.timeout" => Ok(Self::ModerationTimeout),
            "moderation.ban" => Ok(Self::ModerationBan),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ActionId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ActionId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`CapabilitiesError`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct CapabilitiesError {
    pub error: CapabilitiesErrorError,
}
#[doc = "`CapabilitiesErrorError`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct CapabilitiesErrorError(::std::string::String);
impl ::std::ops::Deref for CapabilitiesErrorError {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<CapabilitiesErrorError> for ::std::string::String {
    fn from(value: CapabilitiesErrorError) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for CapabilitiesErrorError {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for CapabilitiesErrorError {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 500usize {
            return Err("longer than 500 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for CapabilitiesErrorError {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for CapabilitiesErrorError {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`CapabilitiesOk`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct CapabilitiesOk {
    pub platforms: ::std::vec::Vec<PlatformCapability>,
}
#[doc = "`CapabilitiesReply`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub enum CapabilitiesReply {
    #[serde(rename = "platforms")]
    Platforms(::std::vec::Vec<PlatformCapability>),
    #[serde(rename = "error")]
    Error(CapabilitiesReplyError),
}
impl ::std::convert::From<::std::vec::Vec<PlatformCapability>> for CapabilitiesReply {
    fn from(value: ::std::vec::Vec<PlatformCapability>) -> Self {
        Self::Platforms(value)
    }
}
impl ::std::convert::From<CapabilitiesReplyError> for CapabilitiesReply {
    fn from(value: CapabilitiesReplyError) -> Self {
        Self::Error(value)
    }
}
#[doc = "`CapabilitiesReplyError`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct CapabilitiesReplyError(::std::string::String);
impl ::std::ops::Deref for CapabilitiesReplyError {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<CapabilitiesReplyError> for ::std::string::String {
    fn from(value: CapabilitiesReplyError) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for CapabilitiesReplyError {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for CapabilitiesReplyError {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 500usize {
            return Err("longer than 500 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for CapabilitiesReplyError {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for CapabilitiesReplyError {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`ChatAnnouncePayload`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ChatAnnouncePayload {
    pub message: ChatAnnouncePayloadMessage,
}
#[doc = "`ChatAnnouncePayloadMessage`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ChatAnnouncePayloadMessage(::std::string::String);
impl ::std::ops::Deref for ChatAnnouncePayloadMessage {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ChatAnnouncePayloadMessage> for ::std::string::String {
    fn from(value: ChatAnnouncePayloadMessage) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ChatAnnouncePayloadMessage {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for ChatAnnouncePayloadMessage {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 500usize {
            return Err("longer than 500 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ChatAnnouncePayloadMessage {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for ChatAnnouncePayloadMessage {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`ChatAnnounceRequest`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ChatAnnounceRequest {
    pub action: ::std::string::String,
    #[serde(rename = "idempotencyKey")]
    pub idempotency_key: RefString,
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub options:
        ::std::option::Option<::std::collections::HashMap<PlatformId, ::serde_json::Value>>,
    pub payload: ChatAnnouncePayload,
    #[serde(rename = "requestedBy")]
    pub requested_by: RequestedBy,
    pub target: Target,
    #[serde(
        rename = "workflowChain",
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub workflow_chain: ::std::option::Option<ChatAnnounceRequestWorkflowChain>,
}
#[doc = "`ChatAnnounceRequestWorkflowChain`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ChatAnnounceRequestWorkflowChain(::std::string::String);
impl ::std::ops::Deref for ChatAnnounceRequestWorkflowChain {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ChatAnnounceRequestWorkflowChain> for ::std::string::String {
    fn from(value: ChatAnnounceRequestWorkflowChain) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ChatAnnounceRequestWorkflowChain {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for ChatAnnounceRequestWorkflowChain {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 1607usize {
            return Err("longer than 1607 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ChatAnnounceRequestWorkflowChain {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for ChatAnnounceRequestWorkflowChain {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`ChatDeletePayload`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ChatDeletePayload {
    #[serde(rename = "messageId")]
    pub message_id: RefString,
}
#[doc = "`ChatDeleteRequest`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ChatDeleteRequest {
    pub action: ::std::string::String,
    #[serde(rename = "idempotencyKey")]
    pub idempotency_key: RefString,
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub options:
        ::std::option::Option<::std::collections::HashMap<PlatformId, ::serde_json::Value>>,
    pub payload: ChatDeletePayload,
    #[serde(rename = "requestedBy")]
    pub requested_by: RequestedBy,
    pub target: Target,
    #[serde(
        rename = "workflowChain",
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub workflow_chain: ::std::option::Option<ChatDeleteRequestWorkflowChain>,
}
#[doc = "`ChatDeleteRequestWorkflowChain`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ChatDeleteRequestWorkflowChain(::std::string::String);
impl ::std::ops::Deref for ChatDeleteRequestWorkflowChain {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ChatDeleteRequestWorkflowChain> for ::std::string::String {
    fn from(value: ChatDeleteRequestWorkflowChain) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ChatDeleteRequestWorkflowChain {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for ChatDeleteRequestWorkflowChain {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 1607usize {
            return Err("longer than 1607 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ChatDeleteRequestWorkflowChain {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for ChatDeleteRequestWorkflowChain {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`ChatPinExistingPayload`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ChatPinExistingPayload {
    #[serde(rename = "messageId")]
    pub message_id: RefString,
}
#[doc = "`ChatPinNewPayload`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ChatPinNewPayload {
    #[serde(
        rename = "durationSeconds",
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub duration_seconds: ::std::option::Option<i64>,
    pub message: ChatPinNewPayloadMessage,
}
#[doc = "`ChatPinNewPayloadMessage`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ChatPinNewPayloadMessage(::std::string::String);
impl ::std::ops::Deref for ChatPinNewPayloadMessage {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ChatPinNewPayloadMessage> for ::std::string::String {
    fn from(value: ChatPinNewPayloadMessage) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ChatPinNewPayloadMessage {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for ChatPinNewPayloadMessage {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 500usize {
            return Err("longer than 500 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ChatPinNewPayloadMessage {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for ChatPinNewPayloadMessage {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "Pin an existing line, or post and pin a new one. The variants have disjoint required fields, so a payload matches exactly one."]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(untagged, deny_unknown_fields)]
pub enum ChatPinPayload {
    ExistingPayload {
        #[serde(rename = "messageId")]
        message_id: RefString,
    },
    NewPayload {
        #[serde(
            rename = "durationSeconds",
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        duration_seconds: ::std::option::Option<i64>,
        message: ChatPinNewPayloadMessage,
    },
}
#[doc = "`ChatPinRequest`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ChatPinRequest {
    pub action: ::std::string::String,
    #[serde(rename = "idempotencyKey")]
    pub idempotency_key: RefString,
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub options:
        ::std::option::Option<::std::collections::HashMap<PlatformId, ::serde_json::Value>>,
    pub payload: ChatPinPayload,
    #[serde(rename = "requestedBy")]
    pub requested_by: RequestedBy,
    pub target: Target,
    #[serde(
        rename = "workflowChain",
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub workflow_chain: ::std::option::Option<ChatPinRequestWorkflowChain>,
}
#[doc = "`ChatPinRequestWorkflowChain`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ChatPinRequestWorkflowChain(::std::string::String);
impl ::std::ops::Deref for ChatPinRequestWorkflowChain {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ChatPinRequestWorkflowChain> for ::std::string::String {
    fn from(value: ChatPinRequestWorkflowChain) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ChatPinRequestWorkflowChain {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for ChatPinRequestWorkflowChain {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 1607usize {
            return Err("longer than 1607 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ChatPinRequestWorkflowChain {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for ChatPinRequestWorkflowChain {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`ChatSendPayload`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ChatSendPayload {
    pub message: ChatSendPayloadMessage,
    #[serde(
        rename = "replyToMessageId",
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub reply_to_message_id: ::std::option::Option<ChatSendPayloadReplyToMessageId>,
}
#[doc = "`ChatSendPayloadMessage`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ChatSendPayloadMessage(::std::string::String);
impl ::std::ops::Deref for ChatSendPayloadMessage {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ChatSendPayloadMessage> for ::std::string::String {
    fn from(value: ChatSendPayloadMessage) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ChatSendPayloadMessage {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for ChatSendPayloadMessage {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 500usize {
            return Err("longer than 500 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ChatSendPayloadMessage {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for ChatSendPayloadMessage {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`ChatSendPayloadReplyToMessageId`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ChatSendPayloadReplyToMessageId(::std::string::String);
impl ::std::ops::Deref for ChatSendPayloadReplyToMessageId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ChatSendPayloadReplyToMessageId> for ::std::string::String {
    fn from(value: ChatSendPayloadReplyToMessageId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ChatSendPayloadReplyToMessageId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for ChatSendPayloadReplyToMessageId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ChatSendPayloadReplyToMessageId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for ChatSendPayloadReplyToMessageId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`ChatSendRequest`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ChatSendRequest {
    pub action: ::std::string::String,
    #[serde(rename = "idempotencyKey")]
    pub idempotency_key: RefString,
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub options:
        ::std::option::Option<::std::collections::HashMap<PlatformId, ::serde_json::Value>>,
    pub payload: ChatSendPayload,
    #[serde(rename = "requestedBy")]
    pub requested_by: RequestedBy,
    pub target: Target,
    #[serde(
        rename = "workflowChain",
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub workflow_chain: ::std::option::Option<ChatSendRequestWorkflowChain>,
}
#[doc = "`ChatSendRequestWorkflowChain`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ChatSendRequestWorkflowChain(::std::string::String);
impl ::std::ops::Deref for ChatSendRequestWorkflowChain {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ChatSendRequestWorkflowChain> for ::std::string::String {
    fn from(value: ChatSendRequestWorkflowChain) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ChatSendRequestWorkflowChain {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for ChatSendRequestWorkflowChain {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 1607usize {
            return Err("longer than 1607 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ChatSendRequestWorkflowChain {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for ChatSendRequestWorkflowChain {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "CloudEvents 1.0 structured-mode envelope. Validated once by the bus library; each message schema describes only data."]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct CloudEvent {
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub data: ::std::option::Option<::serde_json::Value>,
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub datacontenttype: ::std::option::Option<CloudEventDatacontenttype>,
    pub id: CloudEventId,
    pub source: CloudEventSource,
    pub specversion: ::std::string::String,
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub subject: ::std::option::Option<CloudEventSubject>,
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub time: ::std::option::Option<::chrono::DateTime<::chrono::offset::Utc>>,
    #[serde(rename = "type")]
    pub type_: CloudEventType,
}
#[doc = "`CloudEventDatacontenttype`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct CloudEventDatacontenttype(::std::string::String);
impl ::std::ops::Deref for CloudEventDatacontenttype {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<CloudEventDatacontenttype> for ::std::string::String {
    fn from(value: CloudEventDatacontenttype) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for CloudEventDatacontenttype {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for CloudEventDatacontenttype {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 100usize {
            return Err("longer than 100 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for CloudEventDatacontenttype {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for CloudEventDatacontenttype {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`CloudEventId`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct CloudEventId(::std::string::String);
impl ::std::ops::Deref for CloudEventId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<CloudEventId> for ::std::string::String {
    fn from(value: CloudEventId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for CloudEventId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for CloudEventId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for CloudEventId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for CloudEventId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`CloudEventSource`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct CloudEventSource(::std::string::String);
impl ::std::ops::Deref for CloudEventSource {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<CloudEventSource> for ::std::string::String {
    fn from(value: CloudEventSource) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for CloudEventSource {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for CloudEventSource {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for CloudEventSource {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for CloudEventSource {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`CloudEventSubject`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct CloudEventSubject(::std::string::String);
impl ::std::ops::Deref for CloudEventSubject {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<CloudEventSubject> for ::std::string::String {
    fn from(value: CloudEventSubject) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for CloudEventSubject {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for CloudEventSubject {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for CloudEventSubject {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for CloudEventSubject {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`CloudEventType`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct CloudEventType(::std::string::String);
impl ::std::ops::Deref for CloudEventType {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<CloudEventType> for ::std::string::String {
    fn from(value: CloudEventType) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for CloudEventType {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for CloudEventType {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for CloudEventType {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for CloudEventType {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "Any event of the stream and overlay domains; type picks the variant."]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum EngineEvent {
    #[doc = "OverlayTokenMintedEvent"]
    #[serde(rename = "overlay.token.minted")]
    OverlayTokenMinted {
        label: EngineEventLabel,
        #[serde(rename = "sceneId")]
        scene_id: EngineEventSceneId,
        #[serde(rename = "tokenId")]
        token_id: EngineEventTokenId,
        #[serde(rename = "tokenPrefix")]
        token_prefix: EngineEventTokenPrefix,
    },
    #[doc = "OverlayTokenRevokedEvent"]
    #[serde(rename = "overlay.token.revoked")]
    OverlayTokenRevoked {
        label: EngineEventLabel,
        #[serde(rename = "sceneId")]
        scene_id: EngineEventSceneId,
        #[serde(rename = "tokenId")]
        token_id: EngineEventTokenId,
        #[serde(rename = "tokenPrefix")]
        token_prefix: EngineEventTokenPrefix,
    },
    #[doc = "StreamOnlineEvent"]
    #[serde(rename = "stream.online")]
    StreamOnline {
        #[serde(
            rename = "gameName",
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        game_name: ::std::option::Option<EngineEventGameName>,
        #[serde(rename = "startedAt")]
        started_at: ::chrono::DateTime<::chrono::offset::Utc>,
        #[serde(
            rename = "streamTitle",
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        stream_title: ::std::option::Option<EngineEventStreamTitle>,
        #[serde(rename = "twitchUserId")]
        twitch_user_id: EngineEventTwitchUserId,
        #[serde(
            rename = "viewerCount",
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        viewer_count: ::std::option::Option<i64>,
    },
    #[doc = "StreamOfflineEvent"]
    #[serde(rename = "stream.offline")]
    StreamOffline {
        #[serde(rename = "twitchUserId")]
        twitch_user_id: EngineEventTwitchUserId,
    },
    #[doc = "SessionStartedEvent"]
    #[serde(rename = "session.started")]
    SessionStarted {
        #[serde(rename = "sessionId")]
        session_id: EngineEventSessionId,
        #[serde(rename = "startedAt")]
        started_at: ::chrono::DateTime<::chrono::offset::Utc>,
    },
}
#[doc = "`EngineEventGameName`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct EngineEventGameName(::std::string::String);
impl ::std::ops::Deref for EngineEventGameName {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<EngineEventGameName> for ::std::string::String {
    fn from(value: EngineEventGameName) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for EngineEventGameName {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for EngineEventGameName {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for EngineEventGameName {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for EngineEventGameName {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`EngineEventLabel`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct EngineEventLabel(::std::string::String);
impl ::std::ops::Deref for EngineEventLabel {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<EngineEventLabel> for ::std::string::String {
    fn from(value: EngineEventLabel) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for EngineEventLabel {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for EngineEventLabel {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for EngineEventLabel {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for EngineEventLabel {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`EngineEventSceneId`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct EngineEventSceneId(::std::string::String);
impl ::std::ops::Deref for EngineEventSceneId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<EngineEventSceneId> for ::std::string::String {
    fn from(value: EngineEventSceneId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for EngineEventSceneId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for EngineEventSceneId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for EngineEventSceneId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for EngineEventSceneId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`EngineEventSessionId`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct EngineEventSessionId(::std::string::String);
impl ::std::ops::Deref for EngineEventSessionId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<EngineEventSessionId> for ::std::string::String {
    fn from(value: EngineEventSessionId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for EngineEventSessionId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for EngineEventSessionId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for EngineEventSessionId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for EngineEventSessionId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`EngineEventStreamTitle`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct EngineEventStreamTitle(::std::string::String);
impl ::std::ops::Deref for EngineEventStreamTitle {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<EngineEventStreamTitle> for ::std::string::String {
    fn from(value: EngineEventStreamTitle) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for EngineEventStreamTitle {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for EngineEventStreamTitle {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 500usize {
            return Err("longer than 500 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for EngineEventStreamTitle {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for EngineEventStreamTitle {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`EngineEventTokenId`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct EngineEventTokenId(::std::string::String);
impl ::std::ops::Deref for EngineEventTokenId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<EngineEventTokenId> for ::std::string::String {
    fn from(value: EngineEventTokenId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for EngineEventTokenId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for EngineEventTokenId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for EngineEventTokenId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for EngineEventTokenId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`EngineEventTokenPrefix`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct EngineEventTokenPrefix(::std::string::String);
impl ::std::ops::Deref for EngineEventTokenPrefix {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<EngineEventTokenPrefix> for ::std::string::String {
    fn from(value: EngineEventTokenPrefix) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for EngineEventTokenPrefix {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for EngineEventTokenPrefix {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 32usize {
            return Err("longer than 32 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for EngineEventTokenPrefix {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for EngineEventTokenPrefix {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`EngineEventTwitchUserId`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct EngineEventTwitchUserId(::std::string::String);
impl ::std::ops::Deref for EngineEventTwitchUserId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<EngineEventTwitchUserId> for ::std::string::String {
    fn from(value: EngineEventTwitchUserId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for EngineEventTwitchUserId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for EngineEventTwitchUserId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for EngineEventTwitchUserId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for EngineEventTwitchUserId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`FailureCode`"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum FailureCode {
    #[serde(rename = "invalid")]
    Invalid,
    #[serde(rename = "rate_limited")]
    RateLimited,
    #[serde(rename = "forbidden")]
    Forbidden,
    #[serde(rename = "upstream")]
    Upstream,
}
impl ::std::fmt::Display for FailureCode {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Invalid => f.write_str("invalid"),
            Self::RateLimited => f.write_str("rate_limited"),
            Self::Forbidden => f.write_str("forbidden"),
            Self::Upstream => f.write_str("upstream"),
        }
    }
}
impl ::std::str::FromStr for FailureCode {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "invalid" => Ok(Self::Invalid),
            "rate_limited" => Ok(Self::RateLimited),
            "forbidden" => Ok(Self::Forbidden),
            "upstream" => Ok(Self::Upstream),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for FailureCode {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for FailureCode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`FieldOption`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct FieldOption {
    pub label: FieldOptionLabel,
    pub value: PlatformId,
}
#[doc = "`FieldOptionLabel`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct FieldOptionLabel(::std::string::String);
impl ::std::ops::Deref for FieldOptionLabel {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<FieldOptionLabel> for ::std::string::String {
    fn from(value: FieldOptionLabel) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for FieldOptionLabel {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for FieldOptionLabel {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 100usize {
            return Err("longer than 100 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for FieldOptionLabel {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for FieldOptionLabel {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`FieldOptionsError`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct FieldOptionsError {
    pub error: FieldOptionsErrorError,
}
#[doc = "`FieldOptionsErrorError`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct FieldOptionsErrorError(::std::string::String);
impl ::std::ops::Deref for FieldOptionsErrorError {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<FieldOptionsErrorError> for ::std::string::String {
    fn from(value: FieldOptionsErrorError) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for FieldOptionsErrorError {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for FieldOptionsErrorError {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 500usize {
            return Err("longer than 500 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for FieldOptionsErrorError {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for FieldOptionsErrorError {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`FieldOptionsList`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(transparent)]
pub struct FieldOptionsList(pub ::std::vec::Vec<FieldOption>);
impl ::std::ops::Deref for FieldOptionsList {
    type Target = ::std::vec::Vec<FieldOption>;
    fn deref(&self) -> &::std::vec::Vec<FieldOption> {
        &self.0
    }
}
impl ::std::convert::From<FieldOptionsList> for ::std::vec::Vec<FieldOption> {
    fn from(value: FieldOptionsList) -> Self {
        value.0
    }
}
impl ::std::convert::From<::std::vec::Vec<FieldOption>> for FieldOptionsList {
    fn from(value: ::std::vec::Vec<FieldOption>) -> Self {
        Self(value)
    }
}
#[doc = "`FieldOptionsReply`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(untagged, deny_unknown_fields)]
pub enum FieldOptionsReply {
    List(::std::vec::Vec<FieldOption>),
    Error { error: FieldOptionsErrorError },
}
impl ::std::convert::From<::std::vec::Vec<FieldOption>> for FieldOptionsReply {
    fn from(value: ::std::vec::Vec<FieldOption>) -> Self {
        Self::List(value)
    }
}
#[doc = "`FieldOptionsRequest`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct FieldOptionsRequest {
    pub action: ActionId,
}
#[doc = "A request the gateway refused before reaching any platform."]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct GatewayError {
    pub code: FailureCode,
    pub message: GatewayErrorMessage,
}
#[doc = "`GatewayErrorMessage`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct GatewayErrorMessage(::std::string::String);
impl ::std::ops::Deref for GatewayErrorMessage {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<GatewayErrorMessage> for ::std::string::String {
    fn from(value: GatewayErrorMessage) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for GatewayErrorMessage {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for GatewayErrorMessage {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 500usize {
            return Err("longer than 500 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for GatewayErrorMessage {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for GatewayErrorMessage {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "The reply to a request. error is set, with ok false and no results, when the request was refused as a whole."]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct GatewayReply {
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub error: ::std::option::Option<GatewayError>,
    pub ok: bool,
    pub results: ::std::collections::HashMap<PlatformId, PlatformOutcome>,
}
#[doc = "A request for one action on the target's platforms; action picks the variant and so the payload shape."]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(tag = "action", deny_unknown_fields)]
pub enum GatewayRequest {
    #[doc = "ChatSendRequest"]
    #[serde(rename = "chat.send")]
    ChatSend {
        #[serde(rename = "idempotencyKey")]
        idempotency_key: RefString,
        #[serde(skip_serializing_if = "::std::option::Option::is_none")]
        options:
            ::std::option::Option<::std::collections::HashMap<PlatformId, ::serde_json::Value>>,
        payload: ChatSendPayload,
        #[serde(rename = "requestedBy")]
        requested_by: RequestedBy,
        target: Target,
        #[serde(
            rename = "workflowChain",
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        workflow_chain: ::std::option::Option<GatewayRequestWorkflowChain>,
    },
    #[doc = "ChatAnnounceRequest"]
    #[serde(rename = "chat.announce")]
    ChatAnnounce {
        #[serde(rename = "idempotencyKey")]
        idempotency_key: RefString,
        #[serde(skip_serializing_if = "::std::option::Option::is_none")]
        options:
            ::std::option::Option<::std::collections::HashMap<PlatformId, ::serde_json::Value>>,
        payload: ChatAnnouncePayload,
        #[serde(rename = "requestedBy")]
        requested_by: RequestedBy,
        target: Target,
        #[serde(
            rename = "workflowChain",
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        workflow_chain: ::std::option::Option<GatewayRequestWorkflowChain>,
    },
    #[doc = "ChatPinRequest"]
    #[serde(rename = "chat.pin")]
    ChatPin {
        #[serde(rename = "idempotencyKey")]
        idempotency_key: RefString,
        #[serde(skip_serializing_if = "::std::option::Option::is_none")]
        options:
            ::std::option::Option<::std::collections::HashMap<PlatformId, ::serde_json::Value>>,
        payload: ChatPinPayload,
        #[serde(rename = "requestedBy")]
        requested_by: RequestedBy,
        target: Target,
        #[serde(
            rename = "workflowChain",
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        workflow_chain: ::std::option::Option<GatewayRequestWorkflowChain>,
    },
    #[doc = "ChatDeleteRequest"]
    #[serde(rename = "chat.delete")]
    ChatDelete {
        #[serde(rename = "idempotencyKey")]
        idempotency_key: RefString,
        #[serde(skip_serializing_if = "::std::option::Option::is_none")]
        options:
            ::std::option::Option<::std::collections::HashMap<PlatformId, ::serde_json::Value>>,
        payload: ChatDeletePayload,
        #[serde(rename = "requestedBy")]
        requested_by: RequestedBy,
        target: Target,
        #[serde(
            rename = "workflowChain",
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        workflow_chain: ::std::option::Option<GatewayRequestWorkflowChain>,
    },
    #[doc = "ModerationWarnRequest"]
    #[serde(rename = "moderation.warn")]
    ModerationWarn {
        #[serde(rename = "idempotencyKey")]
        idempotency_key: RefString,
        #[serde(skip_serializing_if = "::std::option::Option::is_none")]
        options:
            ::std::option::Option<::std::collections::HashMap<PlatformId, ::serde_json::Value>>,
        payload: ModerationWarnPayload,
        #[serde(rename = "requestedBy")]
        requested_by: RequestedBy,
        target: Target,
        #[serde(
            rename = "workflowChain",
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        workflow_chain: ::std::option::Option<GatewayRequestWorkflowChain>,
    },
    #[doc = "ModerationTimeoutRequest"]
    #[serde(rename = "moderation.timeout")]
    ModerationTimeout {
        #[serde(rename = "idempotencyKey")]
        idempotency_key: RefString,
        #[serde(skip_serializing_if = "::std::option::Option::is_none")]
        options:
            ::std::option::Option<::std::collections::HashMap<PlatformId, ::serde_json::Value>>,
        payload: ModerationTimeoutPayload,
        #[serde(rename = "requestedBy")]
        requested_by: RequestedBy,
        target: Target,
        #[serde(
            rename = "workflowChain",
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        workflow_chain: ::std::option::Option<GatewayRequestWorkflowChain>,
    },
    #[doc = "ModerationBanRequest"]
    #[serde(rename = "moderation.ban")]
    ModerationBan {
        #[serde(rename = "idempotencyKey")]
        idempotency_key: RefString,
        #[serde(skip_serializing_if = "::std::option::Option::is_none")]
        options:
            ::std::option::Option<::std::collections::HashMap<PlatformId, ::serde_json::Value>>,
        payload: ModerationBanPayload,
        #[serde(rename = "requestedBy")]
        requested_by: RequestedBy,
        target: Target,
        #[serde(
            rename = "workflowChain",
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        workflow_chain: ::std::option::Option<GatewayRequestWorkflowChain>,
    },
}
#[doc = "`GatewayRequestWorkflowChain`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct GatewayRequestWorkflowChain(::std::string::String);
impl ::std::ops::Deref for GatewayRequestWorkflowChain {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<GatewayRequestWorkflowChain> for ::std::string::String {
    fn from(value: GatewayRequestWorkflowChain) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for GatewayRequestWorkflowChain {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for GatewayRequestWorkflowChain {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 1607usize {
            return Err("longer than 1607 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for GatewayRequestWorkflowChain {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for GatewayRequestWorkflowChain {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`ModerationBanPayload`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ModerationBanPayload {
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub reason: ::std::option::Option<ModerationBanPayloadReason>,
    pub viewer: RefString,
}
#[doc = "`ModerationBanPayloadReason`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ModerationBanPayloadReason(::std::string::String);
impl ::std::ops::Deref for ModerationBanPayloadReason {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ModerationBanPayloadReason> for ::std::string::String {
    fn from(value: ModerationBanPayloadReason) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ModerationBanPayloadReason {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for ModerationBanPayloadReason {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 500usize {
            return Err("longer than 500 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ModerationBanPayloadReason {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for ModerationBanPayloadReason {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`ModerationBanRequest`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ModerationBanRequest {
    pub action: ::std::string::String,
    #[serde(rename = "idempotencyKey")]
    pub idempotency_key: RefString,
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub options:
        ::std::option::Option<::std::collections::HashMap<PlatformId, ::serde_json::Value>>,
    pub payload: ModerationBanPayload,
    #[serde(rename = "requestedBy")]
    pub requested_by: RequestedBy,
    pub target: Target,
    #[serde(
        rename = "workflowChain",
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub workflow_chain: ::std::option::Option<ModerationBanRequestWorkflowChain>,
}
#[doc = "`ModerationBanRequestWorkflowChain`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ModerationBanRequestWorkflowChain(::std::string::String);
impl ::std::ops::Deref for ModerationBanRequestWorkflowChain {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ModerationBanRequestWorkflowChain> for ::std::string::String {
    fn from(value: ModerationBanRequestWorkflowChain) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ModerationBanRequestWorkflowChain {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for ModerationBanRequestWorkflowChain {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 1607usize {
            return Err("longer than 1607 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ModerationBanRequestWorkflowChain {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for ModerationBanRequestWorkflowChain {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`ModerationTimeoutPayload`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ModerationTimeoutPayload {
    #[serde(rename = "durationSeconds")]
    pub duration_seconds: ::std::num::NonZeroU64,
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub reason: ::std::option::Option<ModerationTimeoutPayloadReason>,
    pub viewer: RefString,
}
#[doc = "`ModerationTimeoutPayloadReason`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ModerationTimeoutPayloadReason(::std::string::String);
impl ::std::ops::Deref for ModerationTimeoutPayloadReason {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ModerationTimeoutPayloadReason> for ::std::string::String {
    fn from(value: ModerationTimeoutPayloadReason) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ModerationTimeoutPayloadReason {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for ModerationTimeoutPayloadReason {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 500usize {
            return Err("longer than 500 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ModerationTimeoutPayloadReason {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for ModerationTimeoutPayloadReason {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`ModerationTimeoutRequest`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ModerationTimeoutRequest {
    pub action: ::std::string::String,
    #[serde(rename = "idempotencyKey")]
    pub idempotency_key: RefString,
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub options:
        ::std::option::Option<::std::collections::HashMap<PlatformId, ::serde_json::Value>>,
    pub payload: ModerationTimeoutPayload,
    #[serde(rename = "requestedBy")]
    pub requested_by: RequestedBy,
    pub target: Target,
    #[serde(
        rename = "workflowChain",
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub workflow_chain: ::std::option::Option<ModerationTimeoutRequestWorkflowChain>,
}
#[doc = "`ModerationTimeoutRequestWorkflowChain`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ModerationTimeoutRequestWorkflowChain(::std::string::String);
impl ::std::ops::Deref for ModerationTimeoutRequestWorkflowChain {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ModerationTimeoutRequestWorkflowChain> for ::std::string::String {
    fn from(value: ModerationTimeoutRequestWorkflowChain) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ModerationTimeoutRequestWorkflowChain {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for ModerationTimeoutRequestWorkflowChain {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 1607usize {
            return Err("longer than 1607 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ModerationTimeoutRequestWorkflowChain {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for ModerationTimeoutRequestWorkflowChain {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`ModerationWarnPayload`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ModerationWarnPayload {
    pub reason: ModerationWarnPayloadReason,
    pub viewer: RefString,
}
#[doc = "`ModerationWarnPayloadReason`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ModerationWarnPayloadReason(::std::string::String);
impl ::std::ops::Deref for ModerationWarnPayloadReason {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ModerationWarnPayloadReason> for ::std::string::String {
    fn from(value: ModerationWarnPayloadReason) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ModerationWarnPayloadReason {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for ModerationWarnPayloadReason {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 500usize {
            return Err("longer than 500 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ModerationWarnPayloadReason {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for ModerationWarnPayloadReason {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`ModerationWarnRequest`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ModerationWarnRequest {
    pub action: ::std::string::String,
    #[serde(rename = "idempotencyKey")]
    pub idempotency_key: RefString,
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub options:
        ::std::option::Option<::std::collections::HashMap<PlatformId, ::serde_json::Value>>,
    pub payload: ModerationWarnPayload,
    #[serde(rename = "requestedBy")]
    pub requested_by: RequestedBy,
    pub target: Target,
    #[serde(
        rename = "workflowChain",
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub workflow_chain: ::std::option::Option<ModerationWarnRequestWorkflowChain>,
}
#[doc = "`ModerationWarnRequestWorkflowChain`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ModerationWarnRequestWorkflowChain(::std::string::String);
impl ::std::ops::Deref for ModerationWarnRequestWorkflowChain {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ModerationWarnRequestWorkflowChain> for ::std::string::String {
    fn from(value: ModerationWarnRequestWorkflowChain) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ModerationWarnRequestWorkflowChain {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for ModerationWarnRequestWorkflowChain {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 1607usize {
            return Err("longer than 1607 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ModerationWarnRequestWorkflowChain {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for ModerationWarnRequestWorkflowChain {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "The platform event a request answers."]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct OriginRef {
    #[serde(
        rename = "channelId",
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub channel_id: ::std::option::Option<OriginRefChannelId>,
    #[serde(
        rename = "messageId",
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub message_id: ::std::option::Option<OriginRefMessageId>,
    pub platform: PlatformId,
}
#[doc = "`OriginRefChannelId`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct OriginRefChannelId(::std::string::String);
impl ::std::ops::Deref for OriginRefChannelId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<OriginRefChannelId> for ::std::string::String {
    fn from(value: OriginRefChannelId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for OriginRefChannelId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for OriginRefChannelId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for OriginRefChannelId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for OriginRefChannelId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`OriginRefMessageId`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct OriginRefMessageId(::std::string::String);
impl ::std::ops::Deref for OriginRefMessageId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<OriginRefMessageId> for ::std::string::String {
    fn from(value: OriginRefMessageId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for OriginRefMessageId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for OriginRefMessageId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for OriginRefMessageId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for OriginRefMessageId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`OutcomeDelivered`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct OutcomeDelivered {
    #[serde(
        rename = "messageId",
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub message_id: ::std::option::Option<OutcomeDeliveredMessageId>,
    pub status: ::std::string::String,
}
#[doc = "`OutcomeDeliveredMessageId`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct OutcomeDeliveredMessageId(::std::string::String);
impl ::std::ops::Deref for OutcomeDeliveredMessageId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<OutcomeDeliveredMessageId> for ::std::string::String {
    fn from(value: OutcomeDeliveredMessageId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for OutcomeDeliveredMessageId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for OutcomeDeliveredMessageId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for OutcomeDeliveredMessageId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for OutcomeDeliveredMessageId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`OutcomeDropped`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct OutcomeDropped {
    pub reason: OutcomeDroppedReason,
    pub status: ::std::string::String,
}
#[doc = "`OutcomeDroppedReason`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct OutcomeDroppedReason(::std::string::String);
impl ::std::ops::Deref for OutcomeDroppedReason {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<OutcomeDroppedReason> for ::std::string::String {
    fn from(value: OutcomeDroppedReason) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for OutcomeDroppedReason {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for OutcomeDroppedReason {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 500usize {
            return Err("longer than 500 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for OutcomeDroppedReason {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for OutcomeDroppedReason {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`OutcomeFailed`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct OutcomeFailed {
    pub code: FailureCode,
    pub message: OutcomeFailedMessage,
    #[serde(
        rename = "messageId",
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub message_id: ::std::option::Option<OutcomeFailedMessageId>,
    pub status: ::std::string::String,
}
#[doc = "`OutcomeFailedMessage`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct OutcomeFailedMessage(::std::string::String);
impl ::std::ops::Deref for OutcomeFailedMessage {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<OutcomeFailedMessage> for ::std::string::String {
    fn from(value: OutcomeFailedMessage) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for OutcomeFailedMessage {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for OutcomeFailedMessage {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 500usize {
            return Err("longer than 500 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for OutcomeFailedMessage {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for OutcomeFailedMessage {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`OutcomeFailedMessageId`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct OutcomeFailedMessageId(::std::string::String);
impl ::std::ops::Deref for OutcomeFailedMessageId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<OutcomeFailedMessageId> for ::std::string::String {
    fn from(value: OutcomeFailedMessageId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for OutcomeFailedMessageId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for OutcomeFailedMessageId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for OutcomeFailedMessageId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for OutcomeFailedMessageId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`OutcomeUnavailable`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct OutcomeUnavailable {
    pub reason: OutcomeUnavailableReason,
    pub status: ::std::string::String,
}
#[doc = "`OutcomeUnavailableReason`"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum OutcomeUnavailableReason {
    #[serde(rename = "not_linked")]
    NotLinked,
    #[serde(rename = "disabled")]
    Disabled,
    #[serde(rename = "stopped")]
    Stopped,
    #[serde(rename = "starting")]
    Starting,
    #[serde(rename = "parked")]
    Parked,
}
impl ::std::fmt::Display for OutcomeUnavailableReason {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::NotLinked => f.write_str("not_linked"),
            Self::Disabled => f.write_str("disabled"),
            Self::Stopped => f.write_str("stopped"),
            Self::Starting => f.write_str("starting"),
            Self::Parked => f.write_str("parked"),
        }
    }
}
impl ::std::str::FromStr for OutcomeUnavailableReason {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "not_linked" => Ok(Self::NotLinked),
            "disabled" => Ok(Self::Disabled),
            "stopped" => Ok(Self::Stopped),
            "starting" => Ok(Self::Starting),
            "parked" => Ok(Self::Parked),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for OutcomeUnavailableReason {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for OutcomeUnavailableReason {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`OutcomeUnconfirmed`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct OutcomeUnconfirmed {
    pub message: OutcomeUnconfirmedMessage,
    pub status: ::std::string::String,
}
#[doc = "`OutcomeUnconfirmedMessage`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct OutcomeUnconfirmedMessage(::std::string::String);
impl ::std::ops::Deref for OutcomeUnconfirmedMessage {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<OutcomeUnconfirmedMessage> for ::std::string::String {
    fn from(value: OutcomeUnconfirmedMessage) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for OutcomeUnconfirmedMessage {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for OutcomeUnconfirmedMessage {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 500usize {
            return Err("longer than 500 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for OutcomeUnconfirmedMessage {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for OutcomeUnconfirmedMessage {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`OutcomeUnsupported`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct OutcomeUnsupported {
    pub status: ::std::string::String,
}
#[doc = "`OverlayTokenMintedEvent`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct OverlayTokenMintedEvent {
    pub label: OverlayTokenMintedEventLabel,
    #[serde(rename = "sceneId")]
    pub scene_id: OverlayTokenMintedEventSceneId,
    #[serde(rename = "tokenId")]
    pub token_id: OverlayTokenMintedEventTokenId,
    #[serde(rename = "tokenPrefix")]
    pub token_prefix: OverlayTokenMintedEventTokenPrefix,
    #[serde(rename = "type")]
    pub type_: ::std::string::String,
}
#[doc = "`OverlayTokenMintedEventLabel`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct OverlayTokenMintedEventLabel(::std::string::String);
impl ::std::ops::Deref for OverlayTokenMintedEventLabel {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<OverlayTokenMintedEventLabel> for ::std::string::String {
    fn from(value: OverlayTokenMintedEventLabel) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for OverlayTokenMintedEventLabel {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for OverlayTokenMintedEventLabel {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for OverlayTokenMintedEventLabel {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for OverlayTokenMintedEventLabel {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`OverlayTokenMintedEventSceneId`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct OverlayTokenMintedEventSceneId(::std::string::String);
impl ::std::ops::Deref for OverlayTokenMintedEventSceneId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<OverlayTokenMintedEventSceneId> for ::std::string::String {
    fn from(value: OverlayTokenMintedEventSceneId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for OverlayTokenMintedEventSceneId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for OverlayTokenMintedEventSceneId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for OverlayTokenMintedEventSceneId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for OverlayTokenMintedEventSceneId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`OverlayTokenMintedEventTokenId`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct OverlayTokenMintedEventTokenId(::std::string::String);
impl ::std::ops::Deref for OverlayTokenMintedEventTokenId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<OverlayTokenMintedEventTokenId> for ::std::string::String {
    fn from(value: OverlayTokenMintedEventTokenId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for OverlayTokenMintedEventTokenId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for OverlayTokenMintedEventTokenId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for OverlayTokenMintedEventTokenId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for OverlayTokenMintedEventTokenId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`OverlayTokenMintedEventTokenPrefix`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct OverlayTokenMintedEventTokenPrefix(::std::string::String);
impl ::std::ops::Deref for OverlayTokenMintedEventTokenPrefix {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<OverlayTokenMintedEventTokenPrefix> for ::std::string::String {
    fn from(value: OverlayTokenMintedEventTokenPrefix) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for OverlayTokenMintedEventTokenPrefix {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for OverlayTokenMintedEventTokenPrefix {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 32usize {
            return Err("longer than 32 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for OverlayTokenMintedEventTokenPrefix {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for OverlayTokenMintedEventTokenPrefix {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`OverlayTokenRevokedEvent`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct OverlayTokenRevokedEvent {
    pub label: OverlayTokenRevokedEventLabel,
    #[serde(rename = "sceneId")]
    pub scene_id: OverlayTokenRevokedEventSceneId,
    #[serde(rename = "tokenId")]
    pub token_id: OverlayTokenRevokedEventTokenId,
    #[serde(rename = "tokenPrefix")]
    pub token_prefix: OverlayTokenRevokedEventTokenPrefix,
    #[serde(rename = "type")]
    pub type_: ::std::string::String,
}
#[doc = "`OverlayTokenRevokedEventLabel`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct OverlayTokenRevokedEventLabel(::std::string::String);
impl ::std::ops::Deref for OverlayTokenRevokedEventLabel {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<OverlayTokenRevokedEventLabel> for ::std::string::String {
    fn from(value: OverlayTokenRevokedEventLabel) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for OverlayTokenRevokedEventLabel {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for OverlayTokenRevokedEventLabel {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for OverlayTokenRevokedEventLabel {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for OverlayTokenRevokedEventLabel {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`OverlayTokenRevokedEventSceneId`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct OverlayTokenRevokedEventSceneId(::std::string::String);
impl ::std::ops::Deref for OverlayTokenRevokedEventSceneId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<OverlayTokenRevokedEventSceneId> for ::std::string::String {
    fn from(value: OverlayTokenRevokedEventSceneId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for OverlayTokenRevokedEventSceneId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for OverlayTokenRevokedEventSceneId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for OverlayTokenRevokedEventSceneId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for OverlayTokenRevokedEventSceneId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`OverlayTokenRevokedEventTokenId`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct OverlayTokenRevokedEventTokenId(::std::string::String);
impl ::std::ops::Deref for OverlayTokenRevokedEventTokenId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<OverlayTokenRevokedEventTokenId> for ::std::string::String {
    fn from(value: OverlayTokenRevokedEventTokenId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for OverlayTokenRevokedEventTokenId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for OverlayTokenRevokedEventTokenId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for OverlayTokenRevokedEventTokenId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for OverlayTokenRevokedEventTokenId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`OverlayTokenRevokedEventTokenPrefix`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct OverlayTokenRevokedEventTokenPrefix(::std::string::String);
impl ::std::ops::Deref for OverlayTokenRevokedEventTokenPrefix {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<OverlayTokenRevokedEventTokenPrefix> for ::std::string::String {
    fn from(value: OverlayTokenRevokedEventTokenPrefix) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for OverlayTokenRevokedEventTokenPrefix {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for OverlayTokenRevokedEventTokenPrefix {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 32usize {
            return Err("longer than 32 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for OverlayTokenRevokedEventTokenPrefix {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for OverlayTokenRevokedEventTokenPrefix {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`PlatformCapability`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct PlatformCapability {
    pub actions: ::std::vec::Vec<ActionId>,
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub connected: ::std::option::Option<bool>,
    #[serde(rename = "displayName")]
    pub display_name: PlatformCapabilityDisplayName,
    #[serde(skip_serializing_if = "::std::option::Option::is_none")]
    pub enabled: ::std::option::Option<bool>,
    pub id: PlatformId,
    pub state: PlatformCapabilityState,
}
#[doc = "`PlatformCapabilityDisplayName`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct PlatformCapabilityDisplayName(::std::string::String);
impl ::std::ops::Deref for PlatformCapabilityDisplayName {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<PlatformCapabilityDisplayName> for ::std::string::String {
    fn from(value: PlatformCapabilityDisplayName) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for PlatformCapabilityDisplayName {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for PlatformCapabilityDisplayName {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 100usize {
            return Err("longer than 100 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for PlatformCapabilityDisplayName {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for PlatformCapabilityDisplayName {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`PlatformCapabilityState`"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum PlatformCapabilityState {
    #[serde(rename = "stopped")]
    Stopped,
    #[serde(rename = "starting")]
    Starting,
    #[serde(rename = "connected")]
    Connected,
    #[serde(rename = "degraded")]
    Degraded,
    #[serde(rename = "parked")]
    Parked,
    #[serde(rename = "stopping")]
    Stopping,
}
impl ::std::fmt::Display for PlatformCapabilityState {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Stopped => f.write_str("stopped"),
            Self::Starting => f.write_str("starting"),
            Self::Connected => f.write_str("connected"),
            Self::Degraded => f.write_str("degraded"),
            Self::Parked => f.write_str("parked"),
            Self::Stopping => f.write_str("stopping"),
        }
    }
}
impl ::std::str::FromStr for PlatformCapabilityState {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "stopped" => Ok(Self::Stopped),
            "starting" => Ok(Self::Starting),
            "connected" => Ok(Self::Connected),
            "degraded" => Ok(Self::Degraded),
            "parked" => Ok(Self::Parked),
            "stopping" => Ok(Self::Stopping),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for PlatformCapabilityState {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for PlatformCapabilityState {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "A streaming platform the engine can act on."]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum PlatformId {
    #[serde(rename = "twitch")]
    Twitch,
}
impl ::std::fmt::Display for PlatformId {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Twitch => f.write_str("twitch"),
        }
    }
}
impl ::std::str::FromStr for PlatformId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "twitch" => Ok(Self::Twitch),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for PlatformId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for PlatformId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "What happened on one platform; status decides the other fields."]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(tag = "status", deny_unknown_fields)]
pub enum PlatformOutcome {
    #[doc = "OutcomeDelivered"]
    #[serde(rename = "delivered")]
    Delivered {
        #[serde(
            rename = "messageId",
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        message_id: ::std::option::Option<PlatformOutcomeMessageId>,
    },
    #[doc = "OutcomeDropped"]
    #[serde(rename = "dropped")]
    Dropped { reason: PlatformOutcomeReason },
    #[serde(rename = "unsupported")]
    Unsupported,
    #[doc = "OutcomeUnavailable"]
    #[serde(rename = "unavailable")]
    Unavailable { reason: PlatformOutcomeReason },
    #[doc = "OutcomeUnconfirmed"]
    #[serde(rename = "unconfirmed")]
    Unconfirmed { message: PlatformOutcomeMessage },
    #[doc = "OutcomeFailed"]
    #[serde(rename = "failed")]
    Failed {
        code: FailureCode,
        message: PlatformOutcomeMessage,
        #[serde(
            rename = "messageId",
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        message_id: ::std::option::Option<PlatformOutcomeMessageId>,
    },
}
#[doc = "`PlatformOutcomeMessage`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct PlatformOutcomeMessage(::std::string::String);
impl ::std::ops::Deref for PlatformOutcomeMessage {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<PlatformOutcomeMessage> for ::std::string::String {
    fn from(value: PlatformOutcomeMessage) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for PlatformOutcomeMessage {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for PlatformOutcomeMessage {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 500usize {
            return Err("longer than 500 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for PlatformOutcomeMessage {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for PlatformOutcomeMessage {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`PlatformOutcomeMessageId`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct PlatformOutcomeMessageId(::std::string::String);
impl ::std::ops::Deref for PlatformOutcomeMessageId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<PlatformOutcomeMessageId> for ::std::string::String {
    fn from(value: PlatformOutcomeMessageId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for PlatformOutcomeMessageId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for PlatformOutcomeMessageId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for PlatformOutcomeMessageId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for PlatformOutcomeMessageId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`PlatformOutcomeReason`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct PlatformOutcomeReason(::std::string::String);
impl ::std::ops::Deref for PlatformOutcomeReason {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<PlatformOutcomeReason> for ::std::string::String {
    fn from(value: PlatformOutcomeReason) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for PlatformOutcomeReason {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for PlatformOutcomeReason {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 500usize {
            return Err("longer than 500 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for PlatformOutcomeReason {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for PlatformOutcomeReason {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "An opaque identifier of at most 200 code points. The one place the contract's maxRefLength lives."]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct RefString(::std::string::String);
impl ::std::ops::Deref for RefString {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<RefString> for ::std::string::String {
    fn from(value: RefString) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for RefString {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for RefString {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for RefString {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for RefString {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "The engine component behind a request. Logged, not authenticated."]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct RequestedBy {
    pub kind: RequestedByKind,
    #[serde(rename = "ref")]
    pub ref_: RefString,
}
#[doc = "`RequestedByKind`"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum RequestedByKind {
    #[serde(rename = "workflow")]
    Workflow,
    #[serde(rename = "dispatcher")]
    Dispatcher,
    #[serde(rename = "api")]
    Api,
}
impl ::std::fmt::Display for RequestedByKind {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Workflow => f.write_str("workflow"),
            Self::Dispatcher => f.write_str("dispatcher"),
            Self::Api => f.write_str("api"),
        }
    }
}
impl ::std::str::FromStr for RequestedByKind {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "workflow" => Ok(Self::Workflow),
            "dispatcher" => Ok(Self::Dispatcher),
            "api" => Ok(Self::Api),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for RequestedByKind {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for RequestedByKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`SessionStartedEvent`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct SessionStartedEvent {
    #[serde(rename = "sessionId")]
    pub session_id: SessionStartedEventSessionId,
    #[serde(rename = "startedAt")]
    pub started_at: ::chrono::DateTime<::chrono::offset::Utc>,
    #[serde(rename = "type")]
    pub type_: ::std::string::String,
}
#[doc = "`SessionStartedEventSessionId`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct SessionStartedEventSessionId(::std::string::String);
impl ::std::ops::Deref for SessionStartedEventSessionId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<SessionStartedEventSessionId> for ::std::string::String {
    fn from(value: SessionStartedEventSessionId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for SessionStartedEventSessionId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for SessionStartedEventSessionId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for SessionStartedEventSessionId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for SessionStartedEventSessionId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`StreamOfflineEvent`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct StreamOfflineEvent {
    #[serde(rename = "twitchUserId")]
    pub twitch_user_id: StreamOfflineEventTwitchUserId,
    #[serde(rename = "type")]
    pub type_: ::std::string::String,
}
#[doc = "`StreamOfflineEventTwitchUserId`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct StreamOfflineEventTwitchUserId(::std::string::String);
impl ::std::ops::Deref for StreamOfflineEventTwitchUserId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<StreamOfflineEventTwitchUserId> for ::std::string::String {
    fn from(value: StreamOfflineEventTwitchUserId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for StreamOfflineEventTwitchUserId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for StreamOfflineEventTwitchUserId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for StreamOfflineEventTwitchUserId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for StreamOfflineEventTwitchUserId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`StreamOnlineEvent`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct StreamOnlineEvent {
    #[serde(
        rename = "gameName",
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub game_name: ::std::option::Option<StreamOnlineEventGameName>,
    #[serde(rename = "startedAt")]
    pub started_at: ::chrono::DateTime<::chrono::offset::Utc>,
    #[serde(
        rename = "streamTitle",
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub stream_title: ::std::option::Option<StreamOnlineEventStreamTitle>,
    #[serde(rename = "twitchUserId")]
    pub twitch_user_id: StreamOnlineEventTwitchUserId,
    #[serde(rename = "type")]
    pub type_: ::std::string::String,
    #[serde(
        rename = "viewerCount",
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub viewer_count: ::std::option::Option<i64>,
}
#[doc = "`StreamOnlineEventGameName`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct StreamOnlineEventGameName(::std::string::String);
impl ::std::ops::Deref for StreamOnlineEventGameName {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<StreamOnlineEventGameName> for ::std::string::String {
    fn from(value: StreamOnlineEventGameName) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for StreamOnlineEventGameName {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for StreamOnlineEventGameName {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for StreamOnlineEventGameName {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for StreamOnlineEventGameName {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`StreamOnlineEventStreamTitle`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct StreamOnlineEventStreamTitle(::std::string::String);
impl ::std::ops::Deref for StreamOnlineEventStreamTitle {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<StreamOnlineEventStreamTitle> for ::std::string::String {
    fn from(value: StreamOnlineEventStreamTitle) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for StreamOnlineEventStreamTitle {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for StreamOnlineEventStreamTitle {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 500usize {
            return Err("longer than 500 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for StreamOnlineEventStreamTitle {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for StreamOnlineEventStreamTitle {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`StreamOnlineEventTwitchUserId`"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct StreamOnlineEventTwitchUserId(::std::string::String);
impl ::std::ops::Deref for StreamOnlineEventTwitchUserId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<StreamOnlineEventTwitchUserId> for ::std::string::String {
    fn from(value: StreamOnlineEventTwitchUserId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for StreamOnlineEventTwitchUserId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value)
    }
}
impl ::std::convert::TryFrom<&str> for StreamOnlineEventTwitchUserId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200usize {
            return Err("longer than 200 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<::std::string::String> for StreamOnlineEventTwitchUserId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        ::std::convert::TryFrom::try_from(value.as_str())
    }
}
impl<'de> ::serde::Deserialize<'de> for StreamOnlineEventTwitchUserId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::convert::TryFrom::try_from(::std::string::String::deserialize(deserializer)?)
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "Which platforms a request goes to; kind picks the variant."]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum Target {
    #[serde(rename = "all")]
    All,
    #[doc = "TargetPlatforms"]
    #[serde(rename = "platforms")]
    Platforms { ids: ::std::vec::Vec<PlatformId> },
    #[doc = "TargetOrigin"]
    #[serde(rename = "origin")]
    Origin { origin: OriginRef },
}
#[doc = "`TargetAll`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct TargetAll {
    pub kind: ::std::string::String,
}
#[doc = "`TargetOrigin`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct TargetOrigin {
    pub kind: ::std::string::String,
    pub origin: OriginRef,
}
#[doc = "`TargetPlatforms`"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct TargetPlatforms {
    pub ids: ::std::vec::Vec<PlatformId>,
    pub kind: ::std::string::String,
}
#[doc = " Error types."]
pub mod error {
    #[doc = r" Error from a `TryFrom` or `FromStr` implementation."]
    pub struct ConversionError(::std::borrow::Cow<'static, str>);
    impl ::std::error::Error for ConversionError {}
    impl ::std::fmt::Display for ConversionError {
        fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> Result<(), ::std::fmt::Error> {
            ::std::fmt::Display::fmt(&self.0, f)
        }
    }
    impl ::std::fmt::Debug for ConversionError {
        fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> Result<(), ::std::fmt::Error> {
            ::std::fmt::Debug::fmt(&self.0, f)
        }
    }
    impl From<&'static str> for ConversionError {
        fn from(value: &'static str) -> Self {
            Self(value.into())
        }
    }
    impl From<String> for ConversionError {
        fn from(value: String) -> Self {
            Self(value.into())
        }
    }
}
