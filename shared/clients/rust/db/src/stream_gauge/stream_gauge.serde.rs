// @generated
impl serde::Serialize for ListStreamGaugeSamplesRequest {
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
        let mut struct_ser = serializer.serialize_struct("stream_gauge.ListStreamGaugeSamplesRequest", len)?;
        if !self.stream_session_id.is_empty() {
            struct_ser.serialize_field("streamSessionId", &self.stream_session_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListStreamGaugeSamplesRequest {
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
            type Value = ListStreamGaugeSamplesRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct stream_gauge.ListStreamGaugeSamplesRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListStreamGaugeSamplesRequest, V::Error>
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
                Ok(ListStreamGaugeSamplesRequest {
                    stream_session_id: stream_session_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("stream_gauge.ListStreamGaugeSamplesRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListStreamGaugeSamplesResponse {
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
        if !self.samples.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("stream_gauge.ListStreamGaugeSamplesResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.samples.is_empty() {
            struct_ser.serialize_field("samples", &self.samples)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListStreamGaugeSamplesResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "samples",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Samples,
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
                            "samples" => Ok(GeneratedField::Samples),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListStreamGaugeSamplesResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct stream_gauge.ListStreamGaugeSamplesResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListStreamGaugeSamplesResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut samples__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Samples => {
                            if samples__.is_some() {
                                return Err(serde::de::Error::duplicate_field("samples"));
                            }
                            samples__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListStreamGaugeSamplesResponse {
                    status: status__,
                    samples: samples__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("stream_gauge.ListStreamGaugeSamplesResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RecordStreamGaugeSampleRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.sampled_at.is_some() {
            len += 1;
        }
        if self.viewer_count.is_some() {
            len += 1;
        }
        if self.follower_total.is_some() {
            len += 1;
        }
        if self.subscriber_total.is_some() {
            len += 1;
        }
        if self.subscriber_points.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("stream_gauge.RecordStreamGaugeSampleRequest", len)?;
        if let Some(v) = self.sampled_at.as_ref() {
            struct_ser.serialize_field("sampledAt", v)?;
        }
        if let Some(v) = self.viewer_count.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("viewerCount", ToString::to_string(&v).as_str())?;
        }
        if let Some(v) = self.follower_total.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("followerTotal", ToString::to_string(&v).as_str())?;
        }
        if let Some(v) = self.subscriber_total.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("subscriberTotal", ToString::to_string(&v).as_str())?;
        }
        if let Some(v) = self.subscriber_points.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("subscriberPoints", ToString::to_string(&v).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RecordStreamGaugeSampleRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "sampled_at",
            "sampledAt",
            "viewer_count",
            "viewerCount",
            "follower_total",
            "followerTotal",
            "subscriber_total",
            "subscriberTotal",
            "subscriber_points",
            "subscriberPoints",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            SampledAt,
            ViewerCount,
            FollowerTotal,
            SubscriberTotal,
            SubscriberPoints,
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
                            "sampledAt" | "sampled_at" => Ok(GeneratedField::SampledAt),
                            "viewerCount" | "viewer_count" => Ok(GeneratedField::ViewerCount),
                            "followerTotal" | "follower_total" => Ok(GeneratedField::FollowerTotal),
                            "subscriberTotal" | "subscriber_total" => Ok(GeneratedField::SubscriberTotal),
                            "subscriberPoints" | "subscriber_points" => Ok(GeneratedField::SubscriberPoints),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RecordStreamGaugeSampleRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct stream_gauge.RecordStreamGaugeSampleRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RecordStreamGaugeSampleRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut sampled_at__ = None;
                let mut viewer_count__ = None;
                let mut follower_total__ = None;
                let mut subscriber_total__ = None;
                let mut subscriber_points__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::SampledAt => {
                            if sampled_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sampledAt"));
                            }
                            sampled_at__ = map_.next_value()?;
                        }
                        GeneratedField::ViewerCount => {
                            if viewer_count__.is_some() {
                                return Err(serde::de::Error::duplicate_field("viewerCount"));
                            }
                            viewer_count__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::FollowerTotal => {
                            if follower_total__.is_some() {
                                return Err(serde::de::Error::duplicate_field("followerTotal"));
                            }
                            follower_total__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::SubscriberTotal => {
                            if subscriber_total__.is_some() {
                                return Err(serde::de::Error::duplicate_field("subscriberTotal"));
                            }
                            subscriber_total__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::SubscriberPoints => {
                            if subscriber_points__.is_some() {
                                return Err(serde::de::Error::duplicate_field("subscriberPoints"));
                            }
                            subscriber_points__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                    }
                }
                Ok(RecordStreamGaugeSampleRequest {
                    sampled_at: sampled_at__,
                    viewer_count: viewer_count__,
                    follower_total: follower_total__,
                    subscriber_total: subscriber_total__,
                    subscriber_points: subscriber_points__,
                })
            }
        }
        deserializer.deserialize_struct("stream_gauge.RecordStreamGaugeSampleRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RecordStreamGaugeSampleResponse {
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
        if self.sample.is_some() {
            len += 1;
        }
        if self.created {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("stream_gauge.RecordStreamGaugeSampleResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.sample.as_ref() {
            struct_ser.serialize_field("sample", v)?;
        }
        if self.created {
            struct_ser.serialize_field("created", &self.created)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RecordStreamGaugeSampleResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "sample",
            "created",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Sample,
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
                            "sample" => Ok(GeneratedField::Sample),
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
            type Value = RecordStreamGaugeSampleResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct stream_gauge.RecordStreamGaugeSampleResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RecordStreamGaugeSampleResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut sample__ = None;
                let mut created__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Sample => {
                            if sample__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sample"));
                            }
                            sample__ = map_.next_value()?;
                        }
                        GeneratedField::Created => {
                            if created__.is_some() {
                                return Err(serde::de::Error::duplicate_field("created"));
                            }
                            created__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RecordStreamGaugeSampleResponse {
                    status: status__,
                    sample: sample__,
                    created: created__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("stream_gauge.RecordStreamGaugeSampleResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for StreamGaugeSample {
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
        if !self.segment_id.is_empty() {
            len += 1;
        }
        if !self.session_id.is_empty() {
            len += 1;
        }
        if self.sampled_at.is_some() {
            len += 1;
        }
        if self.viewer_count.is_some() {
            len += 1;
        }
        if self.follower_total.is_some() {
            len += 1;
        }
        if self.subscriber_total.is_some() {
            len += 1;
        }
        if self.subscriber_points.is_some() {
            len += 1;
        }
        if self.created_at.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("stream_gauge.StreamGaugeSample", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.segment_id.is_empty() {
            struct_ser.serialize_field("segmentId", &self.segment_id)?;
        }
        if !self.session_id.is_empty() {
            struct_ser.serialize_field("sessionId", &self.session_id)?;
        }
        if let Some(v) = self.sampled_at.as_ref() {
            struct_ser.serialize_field("sampledAt", v)?;
        }
        if let Some(v) = self.viewer_count.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("viewerCount", ToString::to_string(&v).as_str())?;
        }
        if let Some(v) = self.follower_total.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("followerTotal", ToString::to_string(&v).as_str())?;
        }
        if let Some(v) = self.subscriber_total.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("subscriberTotal", ToString::to_string(&v).as_str())?;
        }
        if let Some(v) = self.subscriber_points.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("subscriberPoints", ToString::to_string(&v).as_str())?;
        }
        if let Some(v) = self.created_at.as_ref() {
            struct_ser.serialize_field("createdAt", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for StreamGaugeSample {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "segment_id",
            "segmentId",
            "session_id",
            "sessionId",
            "sampled_at",
            "sampledAt",
            "viewer_count",
            "viewerCount",
            "follower_total",
            "followerTotal",
            "subscriber_total",
            "subscriberTotal",
            "subscriber_points",
            "subscriberPoints",
            "created_at",
            "createdAt",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            SegmentId,
            SessionId,
            SampledAt,
            ViewerCount,
            FollowerTotal,
            SubscriberTotal,
            SubscriberPoints,
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
                            "segmentId" | "segment_id" => Ok(GeneratedField::SegmentId),
                            "sessionId" | "session_id" => Ok(GeneratedField::SessionId),
                            "sampledAt" | "sampled_at" => Ok(GeneratedField::SampledAt),
                            "viewerCount" | "viewer_count" => Ok(GeneratedField::ViewerCount),
                            "followerTotal" | "follower_total" => Ok(GeneratedField::FollowerTotal),
                            "subscriberTotal" | "subscriber_total" => Ok(GeneratedField::SubscriberTotal),
                            "subscriberPoints" | "subscriber_points" => Ok(GeneratedField::SubscriberPoints),
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
            type Value = StreamGaugeSample;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct stream_gauge.StreamGaugeSample")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<StreamGaugeSample, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut segment_id__ = None;
                let mut session_id__ = None;
                let mut sampled_at__ = None;
                let mut viewer_count__ = None;
                let mut follower_total__ = None;
                let mut subscriber_total__ = None;
                let mut subscriber_points__ = None;
                let mut created_at__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SegmentId => {
                            if segment_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("segmentId"));
                            }
                            segment_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SessionId => {
                            if session_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sessionId"));
                            }
                            session_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SampledAt => {
                            if sampled_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sampledAt"));
                            }
                            sampled_at__ = map_.next_value()?;
                        }
                        GeneratedField::ViewerCount => {
                            if viewer_count__.is_some() {
                                return Err(serde::de::Error::duplicate_field("viewerCount"));
                            }
                            viewer_count__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::FollowerTotal => {
                            if follower_total__.is_some() {
                                return Err(serde::de::Error::duplicate_field("followerTotal"));
                            }
                            follower_total__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::SubscriberTotal => {
                            if subscriber_total__.is_some() {
                                return Err(serde::de::Error::duplicate_field("subscriberTotal"));
                            }
                            subscriber_total__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::SubscriberPoints => {
                            if subscriber_points__.is_some() {
                                return Err(serde::de::Error::duplicate_field("subscriberPoints"));
                            }
                            subscriber_points__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::CreatedAt => {
                            if created_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdAt"));
                            }
                            created_at__ = map_.next_value()?;
                        }
                    }
                }
                Ok(StreamGaugeSample {
                    id: id__.unwrap_or_default(),
                    segment_id: segment_id__.unwrap_or_default(),
                    session_id: session_id__.unwrap_or_default(),
                    sampled_at: sampled_at__,
                    viewer_count: viewer_count__,
                    follower_total: follower_total__,
                    subscriber_total: subscriber_total__,
                    subscriber_points: subscriber_points__,
                    created_at: created_at__,
                })
            }
        }
        deserializer.deserialize_struct("stream_gauge.StreamGaugeSample", FIELDS, GeneratedVisitor)
    }
}
