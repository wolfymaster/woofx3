// @generated
impl serde::Serialize for GetStreamSessionEventTotalsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.stream_session_id.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("user_event.GetStreamSessionEventTotalsRequest", len)?;
        if !self.stream_session_id.is_empty() {
            struct_ser.serialize_field("streamSessionId", &self.stream_session_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetStreamSessionEventTotalsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "stream_session_id",
            "streamSessionId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            StreamSessionId,
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
                            "streamSessionId" | "stream_session_id" => Ok(GeneratedField::StreamSessionId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetStreamSessionEventTotalsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct user_event.GetStreamSessionEventTotalsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetStreamSessionEventTotalsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut stream_session_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::StreamSessionId => {
                            if stream_session_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("streamSessionId"));
                            }
                            stream_session_id__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(GetStreamSessionEventTotalsRequest {
                    stream_session_id: stream_session_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("user_event.GetStreamSessionEventTotalsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetStreamSessionEventTotalsResponse {
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
        if self.totals.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("user_event.GetStreamSessionEventTotalsResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.totals.as_ref() {
            struct_ser.serialize_field("totals", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetStreamSessionEventTotalsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "totals",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Totals,
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
                            "totals" => Ok(GeneratedField::Totals),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetStreamSessionEventTotalsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct user_event.GetStreamSessionEventTotalsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetStreamSessionEventTotalsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut totals__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Totals => {
                            if totals__.is_some() {
                                return Err(serde::de::Error::duplicate_field("totals"));
                            }
                            totals__ = map_.next_value()?;
                        }
                    }
                }
                Ok(GetStreamSessionEventTotalsResponse {
                    status: status__,
                    totals: totals__,
                })
            }
        }
        deserializer.deserialize_struct("user_event.GetStreamSessionEventTotalsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetViewerEventTotalsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.platform.is_empty() {
            len += 1;
        }
        if !self.platform_user_id.is_empty() {
            len += 1;
        }
        if self.stream_session_id.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("user_event.GetViewerEventTotalsRequest", len)?;
        if !self.platform.is_empty() {
            struct_ser.serialize_field("platform", &self.platform)?;
        }
        if !self.platform_user_id.is_empty() {
            struct_ser.serialize_field("platformUserId", &self.platform_user_id)?;
        }
        if let Some(v) = self.stream_session_id.as_ref() {
            struct_ser.serialize_field("streamSessionId", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetViewerEventTotalsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "platform",
            "platform_user_id",
            "platformUserId",
            "stream_session_id",
            "streamSessionId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Platform,
            PlatformUserId,
            StreamSessionId,
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
                            "platform" => Ok(GeneratedField::Platform),
                            "platformUserId" | "platform_user_id" => Ok(GeneratedField::PlatformUserId),
                            "streamSessionId" | "stream_session_id" => Ok(GeneratedField::StreamSessionId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetViewerEventTotalsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct user_event.GetViewerEventTotalsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetViewerEventTotalsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut platform__ = None;
                let mut platform_user_id__ = None;
                let mut stream_session_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
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
                            platform_user_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::StreamSessionId => {
                            if stream_session_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("streamSessionId"));
                            }
                            stream_session_id__ = map_.next_value()?;
                        }
                    }
                }
                Ok(GetViewerEventTotalsRequest {
                    platform: platform__.unwrap_or_default(),
                    platform_user_id: platform_user_id__.unwrap_or_default(),
                    stream_session_id: stream_session_id__,
                })
            }
        }
        deserializer.deserialize_struct("user_event.GetViewerEventTotalsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetViewerEventTotalsResponse {
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
        if self.totals.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("user_event.GetViewerEventTotalsResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.totals.as_ref() {
            struct_ser.serialize_field("totals", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetViewerEventTotalsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "totals",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Totals,
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
                            "totals" => Ok(GeneratedField::Totals),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetViewerEventTotalsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct user_event.GetViewerEventTotalsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetViewerEventTotalsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut totals__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Totals => {
                            if totals__.is_some() {
                                return Err(serde::de::Error::duplicate_field("totals"));
                            }
                            totals__ = map_.next_value()?;
                        }
                    }
                }
                Ok(GetViewerEventTotalsResponse {
                    status: status__,
                    totals: totals__,
                })
            }
        }
        deserializer.deserialize_struct("user_event.GetViewerEventTotalsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for LeaderboardEntry {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.platform.is_empty() {
            len += 1;
        }
        if !self.platform_user_id.is_empty() {
            len += 1;
        }
        if self.user_name.is_some() {
            len += 1;
        }
        if self.total != 0 {
            len += 1;
        }
        if self.events != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("user_event.LeaderboardEntry", len)?;
        if !self.platform.is_empty() {
            struct_ser.serialize_field("platform", &self.platform)?;
        }
        if !self.platform_user_id.is_empty() {
            struct_ser.serialize_field("platformUserId", &self.platform_user_id)?;
        }
        if let Some(v) = self.user_name.as_ref() {
            struct_ser.serialize_field("userName", v)?;
        }
        if self.total != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("total", ToString::to_string(&self.total).as_str())?;
        }
        if self.events != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("events", ToString::to_string(&self.events).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for LeaderboardEntry {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "platform",
            "platform_user_id",
            "platformUserId",
            "user_name",
            "userName",
            "total",
            "events",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Platform,
            PlatformUserId,
            UserName,
            Total,
            Events,
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
                            "platform" => Ok(GeneratedField::Platform),
                            "platformUserId" | "platform_user_id" => Ok(GeneratedField::PlatformUserId),
                            "userName" | "user_name" => Ok(GeneratedField::UserName),
                            "total" => Ok(GeneratedField::Total),
                            "events" => Ok(GeneratedField::Events),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = LeaderboardEntry;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct user_event.LeaderboardEntry")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<LeaderboardEntry, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut platform__ = None;
                let mut platform_user_id__ = None;
                let mut user_name__ = None;
                let mut total__ = None;
                let mut events__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
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
                            platform_user_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::UserName => {
                            if user_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("userName"));
                            }
                            user_name__ = map_.next_value()?;
                        }
                        GeneratedField::Total => {
                            if total__.is_some() {
                                return Err(serde::de::Error::duplicate_field("total"));
                            }
                            total__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Events => {
                            if events__.is_some() {
                                return Err(serde::de::Error::duplicate_field("events"));
                            }
                            events__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(LeaderboardEntry {
                    platform: platform__.unwrap_or_default(),
                    platform_user_id: platform_user_id__.unwrap_or_default(),
                    user_name: user_name__,
                    total: total__.unwrap_or_default(),
                    events: events__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("user_event.LeaderboardEntry", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for LeaderboardMetric {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::Unspecified => "LEADERBOARD_METRIC_UNSPECIFIED",
            Self::Bits => "LEADERBOARD_METRIC_BITS",
            Self::GiftedSubs => "LEADERBOARD_METRIC_GIFTED_SUBS",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for LeaderboardMetric {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "LEADERBOARD_METRIC_UNSPECIFIED",
            "LEADERBOARD_METRIC_BITS",
            "LEADERBOARD_METRIC_GIFTED_SUBS",
        ];

        struct GeneratedVisitor;

        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = LeaderboardMetric;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(formatter, "expected one of: {:?}", &FIELDS)
            }

            fn visit_i64<E>(self, v: i64) -> std::result::Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                i32::try_from(v)
                    .ok()
                    .and_then(|x| x.try_into().ok())
                    .ok_or_else(|| {
                        serde::de::Error::invalid_value(serde::de::Unexpected::Signed(v), &self)
                    })
            }

            fn visit_u64<E>(self, v: u64) -> std::result::Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                i32::try_from(v)
                    .ok()
                    .and_then(|x| x.try_into().ok())
                    .ok_or_else(|| {
                        serde::de::Error::invalid_value(serde::de::Unexpected::Unsigned(v), &self)
                    })
            }

            fn visit_str<E>(self, value: &str) -> std::result::Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                match value {
                    "LEADERBOARD_METRIC_UNSPECIFIED" => Ok(LeaderboardMetric::Unspecified),
                    "LEADERBOARD_METRIC_BITS" => Ok(LeaderboardMetric::Bits),
                    "LEADERBOARD_METRIC_GIFTED_SUBS" => Ok(LeaderboardMetric::GiftedSubs),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for ListRecentUserEventsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.since.is_some() {
            len += 1;
        }
        if self.limit.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("user_event.ListRecentUserEventsRequest", len)?;
        if let Some(v) = self.since.as_ref() {
            struct_ser.serialize_field("since", v)?;
        }
        if let Some(v) = self.limit.as_ref() {
            struct_ser.serialize_field("limit", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListRecentUserEventsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "since",
            "limit",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Since,
            Limit,
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
                            "since" => Ok(GeneratedField::Since),
                            "limit" => Ok(GeneratedField::Limit),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListRecentUserEventsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct user_event.ListRecentUserEventsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListRecentUserEventsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut since__ = None;
                let mut limit__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Since => {
                            if since__.is_some() {
                                return Err(serde::de::Error::duplicate_field("since"));
                            }
                            since__ = map_.next_value()?;
                        }
                        GeneratedField::Limit => {
                            if limit__.is_some() {
                                return Err(serde::de::Error::duplicate_field("limit"));
                            }
                            limit__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                    }
                }
                Ok(ListRecentUserEventsRequest {
                    since: since__,
                    limit: limit__,
                })
            }
        }
        deserializer.deserialize_struct("user_event.ListRecentUserEventsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListRecentUserEventsResponse {
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
        if !self.events.is_empty() {
            len += 1;
        }
        if self.total != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("user_event.ListRecentUserEventsResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.events.is_empty() {
            struct_ser.serialize_field("events", &self.events)?;
        }
        if self.total != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("total", ToString::to_string(&self.total).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListRecentUserEventsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "events",
            "total",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Events,
            Total,
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
                            "events" => Ok(GeneratedField::Events),
                            "total" => Ok(GeneratedField::Total),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListRecentUserEventsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct user_event.ListRecentUserEventsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListRecentUserEventsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut events__ = None;
                let mut total__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Events => {
                            if events__.is_some() {
                                return Err(serde::de::Error::duplicate_field("events"));
                            }
                            events__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Total => {
                            if total__.is_some() {
                                return Err(serde::de::Error::duplicate_field("total"));
                            }
                            total__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(ListRecentUserEventsResponse {
                    status: status__,
                    events: events__.unwrap_or_default(),
                    total: total__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("user_event.ListRecentUserEventsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListStreamSessionUserEventsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.stream_session_id.is_empty() {
            len += 1;
        }
        if self.limit.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("user_event.ListStreamSessionUserEventsRequest", len)?;
        if !self.stream_session_id.is_empty() {
            struct_ser.serialize_field("streamSessionId", &self.stream_session_id)?;
        }
        if let Some(v) = self.limit.as_ref() {
            struct_ser.serialize_field("limit", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListStreamSessionUserEventsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "stream_session_id",
            "streamSessionId",
            "limit",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            StreamSessionId,
            Limit,
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
                            "streamSessionId" | "stream_session_id" => Ok(GeneratedField::StreamSessionId),
                            "limit" => Ok(GeneratedField::Limit),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListStreamSessionUserEventsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct user_event.ListStreamSessionUserEventsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListStreamSessionUserEventsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut stream_session_id__ = None;
                let mut limit__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::StreamSessionId => {
                            if stream_session_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("streamSessionId"));
                            }
                            stream_session_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Limit => {
                            if limit__.is_some() {
                                return Err(serde::de::Error::duplicate_field("limit"));
                            }
                            limit__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                    }
                }
                Ok(ListStreamSessionUserEventsRequest {
                    stream_session_id: stream_session_id__.unwrap_or_default(),
                    limit: limit__,
                })
            }
        }
        deserializer.deserialize_struct("user_event.ListStreamSessionUserEventsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListStreamSessionUserEventsResponse {
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
        if !self.events.is_empty() {
            len += 1;
        }
        if self.total != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("user_event.ListStreamSessionUserEventsResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.events.is_empty() {
            struct_ser.serialize_field("events", &self.events)?;
        }
        if self.total != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("total", ToString::to_string(&self.total).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListStreamSessionUserEventsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "events",
            "total",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Events,
            Total,
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
                            "events" => Ok(GeneratedField::Events),
                            "total" => Ok(GeneratedField::Total),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListStreamSessionUserEventsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct user_event.ListStreamSessionUserEventsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListStreamSessionUserEventsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut events__ = None;
                let mut total__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Events => {
                            if events__.is_some() {
                                return Err(serde::de::Error::duplicate_field("events"));
                            }
                            events__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Total => {
                            if total__.is_some() {
                                return Err(serde::de::Error::duplicate_field("total"));
                            }
                            total__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(ListStreamSessionUserEventsResponse {
                    status: status__,
                    events: events__.unwrap_or_default(),
                    total: total__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("user_event.ListStreamSessionUserEventsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListViewerLeaderboardRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.metric != 0 {
            len += 1;
        }
        if self.stream_session_id.is_some() {
            len += 1;
        }
        if self.min_total.is_some() {
            len += 1;
        }
        if self.limit.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("user_event.ListViewerLeaderboardRequest", len)?;
        if self.metric != 0 {
            let v = LeaderboardMetric::try_from(self.metric)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.metric)))?;
            struct_ser.serialize_field("metric", &v)?;
        }
        if let Some(v) = self.stream_session_id.as_ref() {
            struct_ser.serialize_field("streamSessionId", v)?;
        }
        if let Some(v) = self.min_total.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("minTotal", ToString::to_string(&v).as_str())?;
        }
        if let Some(v) = self.limit.as_ref() {
            struct_ser.serialize_field("limit", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListViewerLeaderboardRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "metric",
            "stream_session_id",
            "streamSessionId",
            "min_total",
            "minTotal",
            "limit",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Metric,
            StreamSessionId,
            MinTotal,
            Limit,
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
                            "metric" => Ok(GeneratedField::Metric),
                            "streamSessionId" | "stream_session_id" => Ok(GeneratedField::StreamSessionId),
                            "minTotal" | "min_total" => Ok(GeneratedField::MinTotal),
                            "limit" => Ok(GeneratedField::Limit),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListViewerLeaderboardRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct user_event.ListViewerLeaderboardRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListViewerLeaderboardRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut metric__ = None;
                let mut stream_session_id__ = None;
                let mut min_total__ = None;
                let mut limit__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Metric => {
                            if metric__.is_some() {
                                return Err(serde::de::Error::duplicate_field("metric"));
                            }
                            metric__ = Some(map_.next_value::<LeaderboardMetric>()? as i32);
                        }
                        GeneratedField::StreamSessionId => {
                            if stream_session_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("streamSessionId"));
                            }
                            stream_session_id__ = map_.next_value()?;
                        }
                        GeneratedField::MinTotal => {
                            if min_total__.is_some() {
                                return Err(serde::de::Error::duplicate_field("minTotal"));
                            }
                            min_total__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::Limit => {
                            if limit__.is_some() {
                                return Err(serde::de::Error::duplicate_field("limit"));
                            }
                            limit__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                    }
                }
                Ok(ListViewerLeaderboardRequest {
                    metric: metric__.unwrap_or_default(),
                    stream_session_id: stream_session_id__,
                    min_total: min_total__,
                    limit: limit__,
                })
            }
        }
        deserializer.deserialize_struct("user_event.ListViewerLeaderboardRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListViewerLeaderboardResponse {
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
        if !self.entries.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("user_event.ListViewerLeaderboardResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.entries.is_empty() {
            struct_ser.serialize_field("entries", &self.entries)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListViewerLeaderboardResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "entries",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Entries,
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
                            "entries" => Ok(GeneratedField::Entries),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListViewerLeaderboardResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct user_event.ListViewerLeaderboardResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListViewerLeaderboardResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut entries__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Entries => {
                            if entries__.is_some() {
                                return Err(serde::de::Error::duplicate_field("entries"));
                            }
                            entries__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListViewerLeaderboardResponse {
                    status: status__,
                    entries: entries__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("user_event.ListViewerLeaderboardResponse", FIELDS, GeneratedVisitor)
    }
}
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
impl serde::Serialize for StreamSessionEventTotals {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.bits != 0 {
            len += 1;
        }
        if self.cheers != 0 {
            len += 1;
        }
        if self.subs != 0 {
            len += 1;
        }
        if self.gifted_subs != 0 {
            len += 1;
        }
        if self.follows != 0 {
            len += 1;
        }
        if self.raids != 0 {
            len += 1;
        }
        if self.raiders != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("user_event.StreamSessionEventTotals", len)?;
        if self.bits != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("bits", ToString::to_string(&self.bits).as_str())?;
        }
        if self.cheers != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("cheers", ToString::to_string(&self.cheers).as_str())?;
        }
        if self.subs != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("subs", ToString::to_string(&self.subs).as_str())?;
        }
        if self.gifted_subs != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("giftedSubs", ToString::to_string(&self.gifted_subs).as_str())?;
        }
        if self.follows != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("follows", ToString::to_string(&self.follows).as_str())?;
        }
        if self.raids != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("raids", ToString::to_string(&self.raids).as_str())?;
        }
        if self.raiders != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("raiders", ToString::to_string(&self.raiders).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for StreamSessionEventTotals {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "bits",
            "cheers",
            "subs",
            "gifted_subs",
            "giftedSubs",
            "follows",
            "raids",
            "raiders",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Bits,
            Cheers,
            Subs,
            GiftedSubs,
            Follows,
            Raids,
            Raiders,
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
                            "bits" => Ok(GeneratedField::Bits),
                            "cheers" => Ok(GeneratedField::Cheers),
                            "subs" => Ok(GeneratedField::Subs),
                            "giftedSubs" | "gifted_subs" => Ok(GeneratedField::GiftedSubs),
                            "follows" => Ok(GeneratedField::Follows),
                            "raids" => Ok(GeneratedField::Raids),
                            "raiders" => Ok(GeneratedField::Raiders),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = StreamSessionEventTotals;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct user_event.StreamSessionEventTotals")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<StreamSessionEventTotals, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut bits__ = None;
                let mut cheers__ = None;
                let mut subs__ = None;
                let mut gifted_subs__ = None;
                let mut follows__ = None;
                let mut raids__ = None;
                let mut raiders__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Bits => {
                            if bits__.is_some() {
                                return Err(serde::de::Error::duplicate_field("bits"));
                            }
                            bits__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Cheers => {
                            if cheers__.is_some() {
                                return Err(serde::de::Error::duplicate_field("cheers"));
                            }
                            cheers__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Subs => {
                            if subs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("subs"));
                            }
                            subs__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::GiftedSubs => {
                            if gifted_subs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("giftedSubs"));
                            }
                            gifted_subs__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Follows => {
                            if follows__.is_some() {
                                return Err(serde::de::Error::duplicate_field("follows"));
                            }
                            follows__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Raids => {
                            if raids__.is_some() {
                                return Err(serde::de::Error::duplicate_field("raids"));
                            }
                            raids__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Raiders => {
                            if raiders__.is_some() {
                                return Err(serde::de::Error::duplicate_field("raiders"));
                            }
                            raiders__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(StreamSessionEventTotals {
                    bits: bits__.unwrap_or_default(),
                    cheers: cheers__.unwrap_or_default(),
                    subs: subs__.unwrap_or_default(),
                    gifted_subs: gifted_subs__.unwrap_or_default(),
                    follows: follows__.unwrap_or_default(),
                    raids: raids__.unwrap_or_default(),
                    raiders: raiders__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("user_event.StreamSessionEventTotals", FIELDS, GeneratedVisitor)
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
impl serde::Serialize for ViewerEventTotals {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.platform.is_empty() {
            len += 1;
        }
        if !self.platform_user_id.is_empty() {
            len += 1;
        }
        if self.user_name.is_some() {
            len += 1;
        }
        if self.bits != 0 {
            len += 1;
        }
        if self.cheers != 0 {
            len += 1;
        }
        if self.gifted_subs != 0 {
            len += 1;
        }
        if self.gifts != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("user_event.ViewerEventTotals", len)?;
        if !self.platform.is_empty() {
            struct_ser.serialize_field("platform", &self.platform)?;
        }
        if !self.platform_user_id.is_empty() {
            struct_ser.serialize_field("platformUserId", &self.platform_user_id)?;
        }
        if let Some(v) = self.user_name.as_ref() {
            struct_ser.serialize_field("userName", v)?;
        }
        if self.bits != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("bits", ToString::to_string(&self.bits).as_str())?;
        }
        if self.cheers != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("cheers", ToString::to_string(&self.cheers).as_str())?;
        }
        if self.gifted_subs != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("giftedSubs", ToString::to_string(&self.gifted_subs).as_str())?;
        }
        if self.gifts != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("gifts", ToString::to_string(&self.gifts).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ViewerEventTotals {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "platform",
            "platform_user_id",
            "platformUserId",
            "user_name",
            "userName",
            "bits",
            "cheers",
            "gifted_subs",
            "giftedSubs",
            "gifts",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Platform,
            PlatformUserId,
            UserName,
            Bits,
            Cheers,
            GiftedSubs,
            Gifts,
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
                            "platform" => Ok(GeneratedField::Platform),
                            "platformUserId" | "platform_user_id" => Ok(GeneratedField::PlatformUserId),
                            "userName" | "user_name" => Ok(GeneratedField::UserName),
                            "bits" => Ok(GeneratedField::Bits),
                            "cheers" => Ok(GeneratedField::Cheers),
                            "giftedSubs" | "gifted_subs" => Ok(GeneratedField::GiftedSubs),
                            "gifts" => Ok(GeneratedField::Gifts),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ViewerEventTotals;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct user_event.ViewerEventTotals")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ViewerEventTotals, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut platform__ = None;
                let mut platform_user_id__ = None;
                let mut user_name__ = None;
                let mut bits__ = None;
                let mut cheers__ = None;
                let mut gifted_subs__ = None;
                let mut gifts__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
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
                            platform_user_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::UserName => {
                            if user_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("userName"));
                            }
                            user_name__ = map_.next_value()?;
                        }
                        GeneratedField::Bits => {
                            if bits__.is_some() {
                                return Err(serde::de::Error::duplicate_field("bits"));
                            }
                            bits__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Cheers => {
                            if cheers__.is_some() {
                                return Err(serde::de::Error::duplicate_field("cheers"));
                            }
                            cheers__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::GiftedSubs => {
                            if gifted_subs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("giftedSubs"));
                            }
                            gifted_subs__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Gifts => {
                            if gifts__.is_some() {
                                return Err(serde::de::Error::duplicate_field("gifts"));
                            }
                            gifts__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(ViewerEventTotals {
                    platform: platform__.unwrap_or_default(),
                    platform_user_id: platform_user_id__.unwrap_or_default(),
                    user_name: user_name__,
                    bits: bits__.unwrap_or_default(),
                    cheers: cheers__.unwrap_or_default(),
                    gifted_subs: gifted_subs__.unwrap_or_default(),
                    gifts: gifts__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("user_event.ViewerEventTotals", FIELDS, GeneratedVisitor)
    }
}
