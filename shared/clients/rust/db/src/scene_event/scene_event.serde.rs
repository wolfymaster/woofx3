// @generated
impl serde::Serialize for GetSceneEventRequest {
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
        let mut struct_ser = serializer.serialize_struct("scene_event.GetSceneEventRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetSceneEventRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
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
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetSceneEventRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene_event.GetSceneEventRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetSceneEventRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(GetSceneEventRequest {
                    id: id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("scene_event.GetSceneEventRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListOpenSceneEventDeliveriesRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.scene_id.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene_event.ListOpenSceneEventDeliveriesRequest", len)?;
        if !self.scene_id.is_empty() {
            struct_ser.serialize_field("sceneId", &self.scene_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListOpenSceneEventDeliveriesRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "scene_id",
            "sceneId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            SceneId,
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
                            "sceneId" | "scene_id" => Ok(GeneratedField::SceneId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListOpenSceneEventDeliveriesRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene_event.ListOpenSceneEventDeliveriesRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListOpenSceneEventDeliveriesRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut scene_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::SceneId => {
                            if scene_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sceneId"));
                            }
                            scene_id__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListOpenSceneEventDeliveriesRequest {
                    scene_id: scene_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("scene_event.ListOpenSceneEventDeliveriesRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListOpenSceneEventDeliveriesResponse {
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
        if !self.deliveries.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene_event.ListOpenSceneEventDeliveriesResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.deliveries.is_empty() {
            struct_ser.serialize_field("deliveries", &self.deliveries)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListOpenSceneEventDeliveriesResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "deliveries",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Deliveries,
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
                            "deliveries" => Ok(GeneratedField::Deliveries),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListOpenSceneEventDeliveriesResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene_event.ListOpenSceneEventDeliveriesResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListOpenSceneEventDeliveriesResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut deliveries__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Deliveries => {
                            if deliveries__.is_some() {
                                return Err(serde::de::Error::duplicate_field("deliveries"));
                            }
                            deliveries__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListOpenSceneEventDeliveriesResponse {
                    status: status__,
                    deliveries: deliveries__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("scene_event.ListOpenSceneEventDeliveriesResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListSceneEventLogRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.scene_event_id.is_empty() {
            len += 1;
        }
        if !self.scene_id.is_empty() {
            len += 1;
        }
        if self.limit != 0 {
            len += 1;
        }
        if self.offset != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene_event.ListSceneEventLogRequest", len)?;
        if !self.scene_event_id.is_empty() {
            struct_ser.serialize_field("sceneEventId", &self.scene_event_id)?;
        }
        if !self.scene_id.is_empty() {
            struct_ser.serialize_field("sceneId", &self.scene_id)?;
        }
        if self.limit != 0 {
            struct_ser.serialize_field("limit", &self.limit)?;
        }
        if self.offset != 0 {
            struct_ser.serialize_field("offset", &self.offset)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListSceneEventLogRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "scene_event_id",
            "sceneEventId",
            "scene_id",
            "sceneId",
            "limit",
            "offset",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            SceneEventId,
            SceneId,
            Limit,
            Offset,
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
                            "sceneEventId" | "scene_event_id" => Ok(GeneratedField::SceneEventId),
                            "sceneId" | "scene_id" => Ok(GeneratedField::SceneId),
                            "limit" => Ok(GeneratedField::Limit),
                            "offset" => Ok(GeneratedField::Offset),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListSceneEventLogRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene_event.ListSceneEventLogRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListSceneEventLogRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut scene_event_id__ = None;
                let mut scene_id__ = None;
                let mut limit__ = None;
                let mut offset__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::SceneEventId => {
                            if scene_event_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sceneEventId"));
                            }
                            scene_event_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SceneId => {
                            if scene_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sceneId"));
                            }
                            scene_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Limit => {
                            if limit__.is_some() {
                                return Err(serde::de::Error::duplicate_field("limit"));
                            }
                            limit__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Offset => {
                            if offset__.is_some() {
                                return Err(serde::de::Error::duplicate_field("offset"));
                            }
                            offset__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(ListSceneEventLogRequest {
                    scene_event_id: scene_event_id__.unwrap_or_default(),
                    scene_id: scene_id__.unwrap_or_default(),
                    limit: limit__.unwrap_or_default(),
                    offset: offset__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("scene_event.ListSceneEventLogRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListSceneEventLogResponse {
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
        if self.total_count != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene_event.ListSceneEventLogResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.entries.is_empty() {
            struct_ser.serialize_field("entries", &self.entries)?;
        }
        if self.total_count != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("totalCount", ToString::to_string(&self.total_count).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListSceneEventLogResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "entries",
            "total_count",
            "totalCount",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Entries,
            TotalCount,
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
                            "totalCount" | "total_count" => Ok(GeneratedField::TotalCount),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListSceneEventLogResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene_event.ListSceneEventLogResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListSceneEventLogResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut entries__ = None;
                let mut total_count__ = None;
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
                        GeneratedField::TotalCount => {
                            if total_count__.is_some() {
                                return Err(serde::de::Error::duplicate_field("totalCount"));
                            }
                            total_count__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(ListSceneEventLogResponse {
                    status: status__,
                    entries: entries__.unwrap_or_default(),
                    total_count: total_count__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("scene_event.ListSceneEventLogResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RecordCompletionRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.scene_event_id.is_empty() {
            len += 1;
        }
        if !self.instance_id.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene_event.RecordCompletionRequest", len)?;
        if !self.scene_event_id.is_empty() {
            struct_ser.serialize_field("sceneEventId", &self.scene_event_id)?;
        }
        if !self.instance_id.is_empty() {
            struct_ser.serialize_field("instanceId", &self.instance_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RecordCompletionRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "scene_event_id",
            "sceneEventId",
            "instance_id",
            "instanceId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            SceneEventId,
            InstanceId,
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
                            "sceneEventId" | "scene_event_id" => Ok(GeneratedField::SceneEventId),
                            "instanceId" | "instance_id" => Ok(GeneratedField::InstanceId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RecordCompletionRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene_event.RecordCompletionRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RecordCompletionRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut scene_event_id__ = None;
                let mut instance_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::SceneEventId => {
                            if scene_event_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sceneEventId"));
                            }
                            scene_event_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::InstanceId => {
                            if instance_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instanceId"));
                            }
                            instance_id__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RecordCompletionRequest {
                    scene_event_id: scene_event_id__.unwrap_or_default(),
                    instance_id: instance_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("scene_event.RecordCompletionRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RecordDeliveryRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.scene_event_id.is_empty() {
            len += 1;
        }
        if !self.instance_id.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene_event.RecordDeliveryRequest", len)?;
        if !self.scene_event_id.is_empty() {
            struct_ser.serialize_field("sceneEventId", &self.scene_event_id)?;
        }
        if !self.instance_id.is_empty() {
            struct_ser.serialize_field("instanceId", &self.instance_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RecordDeliveryRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "scene_event_id",
            "sceneEventId",
            "instance_id",
            "instanceId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            SceneEventId,
            InstanceId,
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
                            "sceneEventId" | "scene_event_id" => Ok(GeneratedField::SceneEventId),
                            "instanceId" | "instance_id" => Ok(GeneratedField::InstanceId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RecordDeliveryRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene_event.RecordDeliveryRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RecordDeliveryRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut scene_event_id__ = None;
                let mut instance_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::SceneEventId => {
                            if scene_event_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sceneEventId"));
                            }
                            scene_event_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::InstanceId => {
                            if instance_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instanceId"));
                            }
                            instance_id__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RecordDeliveryRequest {
                    scene_event_id: scene_event_id__.unwrap_or_default(),
                    instance_id: instance_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("scene_event.RecordDeliveryRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RecordSceneEventRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.scene_id.is_empty() {
            len += 1;
        }
        if !self.application_id.is_empty() {
            len += 1;
        }
        if !self.r#type.is_empty() {
            len += 1;
        }
        if !self.key.is_empty() {
            len += 1;
        }
        if !self.value.is_empty() {
            len += 1;
        }
        if !self.occurred_at.is_empty() {
            len += 1;
        }
        if !self.target_instance_ids.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene_event.RecordSceneEventRequest", len)?;
        if !self.scene_id.is_empty() {
            struct_ser.serialize_field("sceneId", &self.scene_id)?;
        }
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if !self.r#type.is_empty() {
            struct_ser.serialize_field("type", &self.r#type)?;
        }
        if !self.key.is_empty() {
            struct_ser.serialize_field("key", &self.key)?;
        }
        if !self.value.is_empty() {
            struct_ser.serialize_field("value", &self.value)?;
        }
        if !self.occurred_at.is_empty() {
            struct_ser.serialize_field("occurredAt", &self.occurred_at)?;
        }
        if !self.target_instance_ids.is_empty() {
            struct_ser.serialize_field("targetInstanceIds", &self.target_instance_ids)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RecordSceneEventRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "scene_id",
            "sceneId",
            "application_id",
            "applicationId",
            "type",
            "key",
            "value",
            "occurred_at",
            "occurredAt",
            "target_instance_ids",
            "targetInstanceIds",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            SceneId,
            ApplicationId,
            Type,
            Key,
            Value,
            OccurredAt,
            TargetInstanceIds,
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
                            "sceneId" | "scene_id" => Ok(GeneratedField::SceneId),
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            "type" => Ok(GeneratedField::Type),
                            "key" => Ok(GeneratedField::Key),
                            "value" => Ok(GeneratedField::Value),
                            "occurredAt" | "occurred_at" => Ok(GeneratedField::OccurredAt),
                            "targetInstanceIds" | "target_instance_ids" => Ok(GeneratedField::TargetInstanceIds),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RecordSceneEventRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene_event.RecordSceneEventRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RecordSceneEventRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut scene_id__ = None;
                let mut application_id__ = None;
                let mut r#type__ = None;
                let mut key__ = None;
                let mut value__ = None;
                let mut occurred_at__ = None;
                let mut target_instance_ids__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::SceneId => {
                            if scene_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sceneId"));
                            }
                            scene_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Type => {
                            if r#type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("type"));
                            }
                            r#type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Key => {
                            if key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("key"));
                            }
                            key__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Value => {
                            if value__.is_some() {
                                return Err(serde::de::Error::duplicate_field("value"));
                            }
                            value__ = Some(map_.next_value()?);
                        }
                        GeneratedField::OccurredAt => {
                            if occurred_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("occurredAt"));
                            }
                            occurred_at__ = Some(map_.next_value()?);
                        }
                        GeneratedField::TargetInstanceIds => {
                            if target_instance_ids__.is_some() {
                                return Err(serde::de::Error::duplicate_field("targetInstanceIds"));
                            }
                            target_instance_ids__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RecordSceneEventRequest {
                    scene_id: scene_id__.unwrap_or_default(),
                    application_id: application_id__.unwrap_or_default(),
                    r#type: r#type__.unwrap_or_default(),
                    key: key__.unwrap_or_default(),
                    value: value__.unwrap_or_default(),
                    occurred_at: occurred_at__.unwrap_or_default(),
                    target_instance_ids: target_instance_ids__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("scene_event.RecordSceneEventRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SceneEvent {
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
        if !self.scene_id.is_empty() {
            len += 1;
        }
        if !self.application_id.is_empty() {
            len += 1;
        }
        if !self.r#type.is_empty() {
            len += 1;
        }
        if !self.key.is_empty() {
            len += 1;
        }
        if !self.value.is_empty() {
            len += 1;
        }
        if self.occurred_at.is_some() {
            len += 1;
        }
        if self.created_at.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene_event.SceneEvent", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.scene_id.is_empty() {
            struct_ser.serialize_field("sceneId", &self.scene_id)?;
        }
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if !self.r#type.is_empty() {
            struct_ser.serialize_field("type", &self.r#type)?;
        }
        if !self.key.is_empty() {
            struct_ser.serialize_field("key", &self.key)?;
        }
        if !self.value.is_empty() {
            struct_ser.serialize_field("value", &self.value)?;
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
impl<'de> serde::Deserialize<'de> for SceneEvent {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "scene_id",
            "sceneId",
            "application_id",
            "applicationId",
            "type",
            "key",
            "value",
            "occurred_at",
            "occurredAt",
            "created_at",
            "createdAt",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            SceneId,
            ApplicationId,
            Type,
            Key,
            Value,
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
                            "sceneId" | "scene_id" => Ok(GeneratedField::SceneId),
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            "type" => Ok(GeneratedField::Type),
                            "key" => Ok(GeneratedField::Key),
                            "value" => Ok(GeneratedField::Value),
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
            type Value = SceneEvent;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene_event.SceneEvent")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SceneEvent, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut scene_id__ = None;
                let mut application_id__ = None;
                let mut r#type__ = None;
                let mut key__ = None;
                let mut value__ = None;
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
                        GeneratedField::SceneId => {
                            if scene_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sceneId"));
                            }
                            scene_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Type => {
                            if r#type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("type"));
                            }
                            r#type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Key => {
                            if key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("key"));
                            }
                            key__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Value => {
                            if value__.is_some() {
                                return Err(serde::de::Error::duplicate_field("value"));
                            }
                            value__ = Some(map_.next_value()?);
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
                Ok(SceneEvent {
                    id: id__.unwrap_or_default(),
                    scene_id: scene_id__.unwrap_or_default(),
                    application_id: application_id__.unwrap_or_default(),
                    r#type: r#type__.unwrap_or_default(),
                    key: key__.unwrap_or_default(),
                    value: value__.unwrap_or_default(),
                    occurred_at: occurred_at__,
                    created_at: created_at__,
                })
            }
        }
        deserializer.deserialize_struct("scene_event.SceneEvent", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SceneEventDelivery {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.scene_event_id.is_empty() {
            len += 1;
        }
        if !self.scene_id.is_empty() {
            len += 1;
        }
        if !self.instance_id.is_empty() {
            len += 1;
        }
        if self.delivered_at.is_some() {
            len += 1;
        }
        if self.completed_at.is_some() {
            len += 1;
        }
        if self.last_attempt_at.is_some() {
            len += 1;
        }
        if self.created_at.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene_event.SceneEventDelivery", len)?;
        if !self.scene_event_id.is_empty() {
            struct_ser.serialize_field("sceneEventId", &self.scene_event_id)?;
        }
        if !self.scene_id.is_empty() {
            struct_ser.serialize_field("sceneId", &self.scene_id)?;
        }
        if !self.instance_id.is_empty() {
            struct_ser.serialize_field("instanceId", &self.instance_id)?;
        }
        if let Some(v) = self.delivered_at.as_ref() {
            struct_ser.serialize_field("deliveredAt", v)?;
        }
        if let Some(v) = self.completed_at.as_ref() {
            struct_ser.serialize_field("completedAt", v)?;
        }
        if let Some(v) = self.last_attempt_at.as_ref() {
            struct_ser.serialize_field("lastAttemptAt", v)?;
        }
        if let Some(v) = self.created_at.as_ref() {
            struct_ser.serialize_field("createdAt", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SceneEventDelivery {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "scene_event_id",
            "sceneEventId",
            "scene_id",
            "sceneId",
            "instance_id",
            "instanceId",
            "delivered_at",
            "deliveredAt",
            "completed_at",
            "completedAt",
            "last_attempt_at",
            "lastAttemptAt",
            "created_at",
            "createdAt",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            SceneEventId,
            SceneId,
            InstanceId,
            DeliveredAt,
            CompletedAt,
            LastAttemptAt,
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
                            "sceneEventId" | "scene_event_id" => Ok(GeneratedField::SceneEventId),
                            "sceneId" | "scene_id" => Ok(GeneratedField::SceneId),
                            "instanceId" | "instance_id" => Ok(GeneratedField::InstanceId),
                            "deliveredAt" | "delivered_at" => Ok(GeneratedField::DeliveredAt),
                            "completedAt" | "completed_at" => Ok(GeneratedField::CompletedAt),
                            "lastAttemptAt" | "last_attempt_at" => Ok(GeneratedField::LastAttemptAt),
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
            type Value = SceneEventDelivery;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene_event.SceneEventDelivery")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SceneEventDelivery, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut scene_event_id__ = None;
                let mut scene_id__ = None;
                let mut instance_id__ = None;
                let mut delivered_at__ = None;
                let mut completed_at__ = None;
                let mut last_attempt_at__ = None;
                let mut created_at__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::SceneEventId => {
                            if scene_event_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sceneEventId"));
                            }
                            scene_event_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SceneId => {
                            if scene_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sceneId"));
                            }
                            scene_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::InstanceId => {
                            if instance_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instanceId"));
                            }
                            instance_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DeliveredAt => {
                            if delivered_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("deliveredAt"));
                            }
                            delivered_at__ = map_.next_value()?;
                        }
                        GeneratedField::CompletedAt => {
                            if completed_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("completedAt"));
                            }
                            completed_at__ = map_.next_value()?;
                        }
                        GeneratedField::LastAttemptAt => {
                            if last_attempt_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("lastAttemptAt"));
                            }
                            last_attempt_at__ = map_.next_value()?;
                        }
                        GeneratedField::CreatedAt => {
                            if created_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdAt"));
                            }
                            created_at__ = map_.next_value()?;
                        }
                    }
                }
                Ok(SceneEventDelivery {
                    scene_event_id: scene_event_id__.unwrap_or_default(),
                    scene_id: scene_id__.unwrap_or_default(),
                    instance_id: instance_id__.unwrap_or_default(),
                    delivered_at: delivered_at__,
                    completed_at: completed_at__,
                    last_attempt_at: last_attempt_at__,
                    created_at: created_at__,
                })
            }
        }
        deserializer.deserialize_struct("scene_event.SceneEventDelivery", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SceneEventLogEntry {
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
        if !self.scene_event_id.is_empty() {
            len += 1;
        }
        if !self.scene_id.is_empty() {
            len += 1;
        }
        if !self.instance_id.is_empty() {
            len += 1;
        }
        if !self.kind.is_empty() {
            len += 1;
        }
        if self.occurred_at.is_some() {
            len += 1;
        }
        if self.created_at.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene_event.SceneEventLogEntry", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.scene_event_id.is_empty() {
            struct_ser.serialize_field("sceneEventId", &self.scene_event_id)?;
        }
        if !self.scene_id.is_empty() {
            struct_ser.serialize_field("sceneId", &self.scene_id)?;
        }
        if !self.instance_id.is_empty() {
            struct_ser.serialize_field("instanceId", &self.instance_id)?;
        }
        if !self.kind.is_empty() {
            struct_ser.serialize_field("kind", &self.kind)?;
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
impl<'de> serde::Deserialize<'de> for SceneEventLogEntry {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "scene_event_id",
            "sceneEventId",
            "scene_id",
            "sceneId",
            "instance_id",
            "instanceId",
            "kind",
            "occurred_at",
            "occurredAt",
            "created_at",
            "createdAt",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            SceneEventId,
            SceneId,
            InstanceId,
            Kind,
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
                            "sceneEventId" | "scene_event_id" => Ok(GeneratedField::SceneEventId),
                            "sceneId" | "scene_id" => Ok(GeneratedField::SceneId),
                            "instanceId" | "instance_id" => Ok(GeneratedField::InstanceId),
                            "kind" => Ok(GeneratedField::Kind),
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
            type Value = SceneEventLogEntry;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene_event.SceneEventLogEntry")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SceneEventLogEntry, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut scene_event_id__ = None;
                let mut scene_id__ = None;
                let mut instance_id__ = None;
                let mut kind__ = None;
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
                        GeneratedField::SceneEventId => {
                            if scene_event_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sceneEventId"));
                            }
                            scene_event_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SceneId => {
                            if scene_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sceneId"));
                            }
                            scene_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::InstanceId => {
                            if instance_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instanceId"));
                            }
                            instance_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Kind => {
                            if kind__.is_some() {
                                return Err(serde::de::Error::duplicate_field("kind"));
                            }
                            kind__ = Some(map_.next_value()?);
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
                Ok(SceneEventLogEntry {
                    id: id__.unwrap_or_default(),
                    scene_event_id: scene_event_id__.unwrap_or_default(),
                    scene_id: scene_id__.unwrap_or_default(),
                    instance_id: instance_id__.unwrap_or_default(),
                    kind: kind__.unwrap_or_default(),
                    occurred_at: occurred_at__,
                    created_at: created_at__,
                })
            }
        }
        deserializer.deserialize_struct("scene_event.SceneEventLogEntry", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SceneEventResponse {
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
        if self.scene_event.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene_event.SceneEventResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.scene_event.as_ref() {
            struct_ser.serialize_field("sceneEvent", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SceneEventResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "scene_event",
            "sceneEvent",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            SceneEvent,
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
                            "sceneEvent" | "scene_event" => Ok(GeneratedField::SceneEvent),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = SceneEventResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene_event.SceneEventResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SceneEventResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut scene_event__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::SceneEvent => {
                            if scene_event__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sceneEvent"));
                            }
                            scene_event__ = map_.next_value()?;
                        }
                    }
                }
                Ok(SceneEventResponse {
                    status: status__,
                    scene_event: scene_event__,
                })
            }
        }
        deserializer.deserialize_struct("scene_event.SceneEventResponse", FIELDS, GeneratedVisitor)
    }
}
