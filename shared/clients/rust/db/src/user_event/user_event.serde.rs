// @generated
impl serde::Serialize for RecordUserEventRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.event_id.is_empty() {
            len += 1;
        }
        if !self.source.is_empty() {
            len += 1;
        }
        if !self.event_type.is_empty() {
            len += 1;
        }
        if !self.platform.is_empty() {
            len += 1;
        }
        if self.platform_user_id.is_some() {
            len += 1;
        }
        if self.user_name.is_some() {
            len += 1;
        }
        if self.session_id.is_some() {
            len += 1;
        }
        if self.amount.is_some() {
            len += 1;
        }
        if !self.event_value.is_empty() {
            len += 1;
        }
        if self.occurred_at.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("user_event.RecordUserEventRequest", len)?;
        if !self.event_id.is_empty() {
            struct_ser.serialize_field("eventId", &self.event_id)?;
        }
        if !self.source.is_empty() {
            struct_ser.serialize_field("source", &self.source)?;
        }
        if !self.event_type.is_empty() {
            struct_ser.serialize_field("eventType", &self.event_type)?;
        }
        if !self.platform.is_empty() {
            struct_ser.serialize_field("platform", &self.platform)?;
        }
        if let Some(v) = self.platform_user_id.as_ref() {
            struct_ser.serialize_field("platformUserId", v)?;
        }
        if let Some(v) = self.user_name.as_ref() {
            struct_ser.serialize_field("userName", v)?;
        }
        if let Some(v) = self.session_id.as_ref() {
            struct_ser.serialize_field("sessionId", v)?;
        }
        if let Some(v) = self.amount.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("amount", ToString::to_string(&v).as_str())?;
        }
        if !self.event_value.is_empty() {
            struct_ser.serialize_field("eventValue", &self.event_value)?;
        }
        if let Some(v) = self.occurred_at.as_ref() {
            struct_ser.serialize_field("occurredAt", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RecordUserEventRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "event_id",
            "eventId",
            "source",
            "event_type",
            "eventType",
            "platform",
            "platform_user_id",
            "platformUserId",
            "user_name",
            "userName",
            "session_id",
            "sessionId",
            "amount",
            "event_value",
            "eventValue",
            "occurred_at",
            "occurredAt",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            EventId,
            Source,
            EventType,
            Platform,
            PlatformUserId,
            UserName,
            SessionId,
            Amount,
            EventValue,
            OccurredAt,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "eventId" | "event_id" => Ok(GeneratedField::EventId),
                            "source" => Ok(GeneratedField::Source),
                            "eventType" | "event_type" => Ok(GeneratedField::EventType),
                            "platform" => Ok(GeneratedField::Platform),
                            "platformUserId" | "platform_user_id" => Ok(GeneratedField::PlatformUserId),
                            "userName" | "user_name" => Ok(GeneratedField::UserName),
                            "sessionId" | "session_id" => Ok(GeneratedField::SessionId),
                            "amount" => Ok(GeneratedField::Amount),
                            "eventValue" | "event_value" => Ok(GeneratedField::EventValue),
                            "occurredAt" | "occurred_at" => Ok(GeneratedField::OccurredAt),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RecordUserEventRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct user_event.RecordUserEventRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RecordUserEventRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut event_id__ = None;
                let mut source__ = None;
                let mut event_type__ = None;
                let mut platform__ = None;
                let mut platform_user_id__ = None;
                let mut user_name__ = None;
                let mut session_id__ = None;
                let mut amount__ = None;
                let mut event_value__ = None;
                let mut occurred_at__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::EventId => {
                            if event_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("eventId"));
                            }
                            event_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Source => {
                            if source__.is_some() {
                                return Err(serde::de::Error::duplicate_field("source"));
                            }
                            source__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EventType => {
                            if event_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("eventType"));
                            }
                            event_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Platform => {
                            if platform__.is_some() {
                                return Err(serde::de::Error::duplicate_field("platform"));
                            }
                            platform__ = Some(map_.next_value()?);
                        }
                        GeneratedField::PlatformUserId => {
                            if platform_user_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("platformUserId"));
                            }
                            platform_user_id__ = map_.next_value()?;
                        }
                        GeneratedField::UserName => {
                            if user_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("userName"));
                            }
                            user_name__ = map_.next_value()?;
                        }
                        GeneratedField::SessionId => {
                            if session_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sessionId"));
                            }
                            session_id__ = map_.next_value()?;
                        }
                        GeneratedField::Amount => {
                            if amount__.is_some() {
                                return Err(serde::de::Error::duplicate_field("amount"));
                            }
                            amount__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::EventValue => {
                            if event_value__.is_some() {
                                return Err(serde::de::Error::duplicate_field("eventValue"));
                            }
                            event_value__ = Some(map_.next_value()?);
                        }
                        GeneratedField::OccurredAt => {
                            if occurred_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("occurredAt"));
                            }
                            occurred_at__ = map_.next_value()?;
                        }
                    }
                }
                Ok(RecordUserEventRequest {
                    event_id: event_id__.unwrap_or_default(),
                    source: source__.unwrap_or_default(),
                    event_type: event_type__.unwrap_or_default(),
                    platform: platform__.unwrap_or_default(),
                    platform_user_id: platform_user_id__,
                    user_name: user_name__,
                    session_id: session_id__,
                    amount: amount__,
                    event_value: event_value__.unwrap_or_default(),
                    occurred_at: occurred_at__,
                })
            }
        }
        deserializer.deserialize_struct("user_event.RecordUserEventRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RecordUserEventResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.status.is_some() {
            len += 1;
        }
        if self.event.is_some() {
            len += 1;
        }
        if self.created {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("user_event.RecordUserEventResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.event.as_ref() {
            struct_ser.serialize_field("event", v)?;
        }
        if self.created {
            struct_ser.serialize_field("created", &self.created)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RecordUserEventResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "event",
            "created",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Event,
            Created,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "status" => Ok(GeneratedField::Status),
                            "event" => Ok(GeneratedField::Event),
                            "created" => Ok(GeneratedField::Created),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RecordUserEventResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct user_event.RecordUserEventResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RecordUserEventResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut event__ = None;
                let mut created__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Event => {
                            if event__.is_some() {
                                return Err(serde::de::Error::duplicate_field("event"));
                            }
                            event__ = map_.next_value()?;
                        }
                        GeneratedField::Created => {
                            if created__.is_some() {
                                return Err(serde::de::Error::duplicate_field("created"));
                            }
                            created__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RecordUserEventResponse {
                    status: status__,
                    event: event__,
                    created: created__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("user_event.RecordUserEventResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for UserEvent {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.id.is_empty() {
            len += 1;
        }
        if !self.event_id.is_empty() {
            len += 1;
        }
        if !self.source.is_empty() {
            len += 1;
        }
        if !self.event_type.is_empty() {
            len += 1;
        }
        if !self.platform.is_empty() {
            len += 1;
        }
        if self.platform_user_id.is_some() {
            len += 1;
        }
        if self.user_name.is_some() {
            len += 1;
        }
        if self.session_id.is_some() {
            len += 1;
        }
        if self.amount.is_some() {
            len += 1;
        }
        if !self.event_value.is_empty() {
            len += 1;
        }
        if self.occurred_at.is_some() {
            len += 1;
        }
        if self.created_at.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("user_event.UserEvent", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.event_id.is_empty() {
            struct_ser.serialize_field("eventId", &self.event_id)?;
        }
        if !self.source.is_empty() {
            struct_ser.serialize_field("source", &self.source)?;
        }
        if !self.event_type.is_empty() {
            struct_ser.serialize_field("eventType", &self.event_type)?;
        }
        if !self.platform.is_empty() {
            struct_ser.serialize_field("platform", &self.platform)?;
        }
        if let Some(v) = self.platform_user_id.as_ref() {
            struct_ser.serialize_field("platformUserId", v)?;
        }
        if let Some(v) = self.user_name.as_ref() {
            struct_ser.serialize_field("userName", v)?;
        }
        if let Some(v) = self.session_id.as_ref() {
            struct_ser.serialize_field("sessionId", v)?;
        }
        if let Some(v) = self.amount.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("amount", ToString::to_string(&v).as_str())?;
        }
        if !self.event_value.is_empty() {
            struct_ser.serialize_field("eventValue", &self.event_value)?;
        }
        if let Some(v) = self.occurred_at.as_ref() {
            struct_ser.serialize_field("occurredAt", v)?;
        }
        if let Some(v) = self.created_at.as_ref() {
            struct_ser.serialize_field("createdAt", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for UserEvent {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "event_id",
            "eventId",
            "source",
            "event_type",
            "eventType",
            "platform",
            "platform_user_id",
            "platformUserId",
            "user_name",
            "userName",
            "session_id",
            "sessionId",
            "amount",
            "event_value",
            "eventValue",
            "occurred_at",
            "occurredAt",
            "created_at",
            "createdAt",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            EventId,
            Source,
            EventType,
            Platform,
            PlatformUserId,
            UserName,
            SessionId,
            Amount,
            EventValue,
            OccurredAt,
            CreatedAt,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "id" => Ok(GeneratedField::Id),
                            "eventId" | "event_id" => Ok(GeneratedField::EventId),
                            "source" => Ok(GeneratedField::Source),
                            "eventType" | "event_type" => Ok(GeneratedField::EventType),
                            "platform" => Ok(GeneratedField::Platform),
                            "platformUserId" | "platform_user_id" => Ok(GeneratedField::PlatformUserId),
                            "userName" | "user_name" => Ok(GeneratedField::UserName),
                            "sessionId" | "session_id" => Ok(GeneratedField::SessionId),
                            "amount" => Ok(GeneratedField::Amount),
                            "eventValue" | "event_value" => Ok(GeneratedField::EventValue),
                            "occurredAt" | "occurred_at" => Ok(GeneratedField::OccurredAt),
                            "createdAt" | "created_at" => Ok(GeneratedField::CreatedAt),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = UserEvent;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct user_event.UserEvent")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<UserEvent, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut event_id__ = None;
                let mut source__ = None;
                let mut event_type__ = None;
                let mut platform__ = None;
                let mut platform_user_id__ = None;
                let mut user_name__ = None;
                let mut session_id__ = None;
                let mut amount__ = None;
                let mut event_value__ = None;
                let mut occurred_at__ = None;
                let mut created_at__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EventId => {
                            if event_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("eventId"));
                            }
                            event_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Source => {
                            if source__.is_some() {
                                return Err(serde::de::Error::duplicate_field("source"));
                            }
                            source__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EventType => {
                            if event_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("eventType"));
                            }
                            event_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Platform => {
                            if platform__.is_some() {
                                return Err(serde::de::Error::duplicate_field("platform"));
                            }
                            platform__ = Some(map_.next_value()?);
                        }
                        GeneratedField::PlatformUserId => {
                            if platform_user_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("platformUserId"));
                            }
                            platform_user_id__ = map_.next_value()?;
                        }
                        GeneratedField::UserName => {
                            if user_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("userName"));
                            }
                            user_name__ = map_.next_value()?;
                        }
                        GeneratedField::SessionId => {
                            if session_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sessionId"));
                            }
                            session_id__ = map_.next_value()?;
                        }
                        GeneratedField::Amount => {
                            if amount__.is_some() {
                                return Err(serde::de::Error::duplicate_field("amount"));
                            }
                            amount__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::EventValue => {
                            if event_value__.is_some() {
                                return Err(serde::de::Error::duplicate_field("eventValue"));
                            }
                            event_value__ = Some(map_.next_value()?);
                        }
                        GeneratedField::OccurredAt => {
                            if occurred_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("occurredAt"));
                            }
                            occurred_at__ = map_.next_value()?;
                        }
                        GeneratedField::CreatedAt => {
                            if created_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdAt"));
                            }
                            created_at__ = map_.next_value()?;
                        }
                    }
                }
                Ok(UserEvent {
                    id: id__.unwrap_or_default(),
                    event_id: event_id__.unwrap_or_default(),
                    source: source__.unwrap_or_default(),
                    event_type: event_type__.unwrap_or_default(),
                    platform: platform__.unwrap_or_default(),
                    platform_user_id: platform_user_id__,
                    user_name: user_name__,
                    session_id: session_id__,
                    amount: amount__,
                    event_value: event_value__.unwrap_or_default(),
                    occurred_at: occurred_at__,
                    created_at: created_at__,
                })
            }
        }
        deserializer.deserialize_struct("user_event.UserEvent", FIELDS, GeneratedVisitor)
    }
}
