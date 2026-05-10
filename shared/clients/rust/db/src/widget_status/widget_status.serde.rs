// @generated
impl serde::Serialize for DeleteWidgetStatusRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.application_id.is_empty() {
            len += 1;
        }
        if !self.instance_id.is_empty() {
            len += 1;
        }
        if !self.key.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("widget_status.DeleteWidgetStatusRequest", len)?;
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if !self.instance_id.is_empty() {
            struct_ser.serialize_field("instanceId", &self.instance_id)?;
        }
        if !self.key.is_empty() {
            struct_ser.serialize_field("key", &self.key)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DeleteWidgetStatusRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "application_id",
            "applicationId",
            "instance_id",
            "instanceId",
            "key",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ApplicationId,
            InstanceId,
            Key,
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
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            "instanceId" | "instance_id" => Ok(GeneratedField::InstanceId),
                            "key" => Ok(GeneratedField::Key),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = DeleteWidgetStatusRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct widget_status.DeleteWidgetStatusRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DeleteWidgetStatusRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut application_id__ = None;
                let mut instance_id__ = None;
                let mut key__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::InstanceId => {
                            if instance_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instanceId"));
                            }
                            instance_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Key => {
                            if key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("key"));
                            }
                            key__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(DeleteWidgetStatusRequest {
                    application_id: application_id__.unwrap_or_default(),
                    instance_id: instance_id__.unwrap_or_default(),
                    key: key__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("widget_status.DeleteWidgetStatusRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetWidgetStatusRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.application_id.is_empty() {
            len += 1;
        }
        if !self.instance_id.is_empty() {
            len += 1;
        }
        if !self.key.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("widget_status.GetWidgetStatusRequest", len)?;
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if !self.instance_id.is_empty() {
            struct_ser.serialize_field("instanceId", &self.instance_id)?;
        }
        if !self.key.is_empty() {
            struct_ser.serialize_field("key", &self.key)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetWidgetStatusRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "application_id",
            "applicationId",
            "instance_id",
            "instanceId",
            "key",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ApplicationId,
            InstanceId,
            Key,
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
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            "instanceId" | "instance_id" => Ok(GeneratedField::InstanceId),
                            "key" => Ok(GeneratedField::Key),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetWidgetStatusRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct widget_status.GetWidgetStatusRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetWidgetStatusRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut application_id__ = None;
                let mut instance_id__ = None;
                let mut key__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::InstanceId => {
                            if instance_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instanceId"));
                            }
                            instance_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Key => {
                            if key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("key"));
                            }
                            key__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(GetWidgetStatusRequest {
                    application_id: application_id__.unwrap_or_default(),
                    instance_id: instance_id__.unwrap_or_default(),
                    key: key__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("widget_status.GetWidgetStatusRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListWidgetStatusRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.application_id.is_empty() {
            len += 1;
        }
        if !self.module_id.is_empty() {
            len += 1;
        }
        if !self.instance_id.is_empty() {
            len += 1;
        }
        if self.limit != 0 {
            len += 1;
        }
        if self.offset != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("widget_status.ListWidgetStatusRequest", len)?;
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        if !self.instance_id.is_empty() {
            struct_ser.serialize_field("instanceId", &self.instance_id)?;
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
impl<'de> serde::Deserialize<'de> for ListWidgetStatusRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "application_id",
            "applicationId",
            "module_id",
            "moduleId",
            "instance_id",
            "instanceId",
            "limit",
            "offset",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ApplicationId,
            ModuleId,
            InstanceId,
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
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            "moduleId" | "module_id" => Ok(GeneratedField::ModuleId),
                            "instanceId" | "instance_id" => Ok(GeneratedField::InstanceId),
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
            type Value = ListWidgetStatusRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct widget_status.ListWidgetStatusRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListWidgetStatusRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut application_id__ = None;
                let mut module_id__ = None;
                let mut instance_id__ = None;
                let mut limit__ = None;
                let mut offset__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ModuleId => {
                            if module_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleId"));
                            }
                            module_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::InstanceId => {
                            if instance_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instanceId"));
                            }
                            instance_id__ = Some(map_.next_value()?);
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
                Ok(ListWidgetStatusRequest {
                    application_id: application_id__.unwrap_or_default(),
                    module_id: module_id__.unwrap_or_default(),
                    instance_id: instance_id__.unwrap_or_default(),
                    limit: limit__.unwrap_or_default(),
                    offset: offset__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("widget_status.ListWidgetStatusRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListWidgetStatusResponse {
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
        if !self.rows.is_empty() {
            len += 1;
        }
        if self.total_count != 0 {
            len += 1;
        }
        if self.limit != 0 {
            len += 1;
        }
        if self.offset != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("widget_status.ListWidgetStatusResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.rows.is_empty() {
            struct_ser.serialize_field("rows", &self.rows)?;
        }
        if self.total_count != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("totalCount", ToString::to_string(&self.total_count).as_str())?;
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
impl<'de> serde::Deserialize<'de> for ListWidgetStatusResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "rows",
            "total_count",
            "totalCount",
            "limit",
            "offset",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Rows,
            TotalCount,
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
                            "status" => Ok(GeneratedField::Status),
                            "rows" => Ok(GeneratedField::Rows),
                            "totalCount" | "total_count" => Ok(GeneratedField::TotalCount),
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
            type Value = ListWidgetStatusResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct widget_status.ListWidgetStatusResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListWidgetStatusResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut rows__ = None;
                let mut total_count__ = None;
                let mut limit__ = None;
                let mut offset__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Rows => {
                            if rows__.is_some() {
                                return Err(serde::de::Error::duplicate_field("rows"));
                            }
                            rows__ = Some(map_.next_value()?);
                        }
                        GeneratedField::TotalCount => {
                            if total_count__.is_some() {
                                return Err(serde::de::Error::duplicate_field("totalCount"));
                            }
                            total_count__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
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
                Ok(ListWidgetStatusResponse {
                    status: status__,
                    rows: rows__.unwrap_or_default(),
                    total_count: total_count__.unwrap_or_default(),
                    limit: limit__.unwrap_or_default(),
                    offset: offset__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("widget_status.ListWidgetStatusResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for UpsertWidgetStatusRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.application_id.is_empty() {
            len += 1;
        }
        if !self.module_id.is_empty() {
            len += 1;
        }
        if !self.instance_id.is_empty() {
            len += 1;
        }
        if !self.widget_canonical_id.is_empty() {
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
        let mut struct_ser = serializer.serialize_struct("widget_status.UpsertWidgetStatusRequest", len)?;
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        if !self.instance_id.is_empty() {
            struct_ser.serialize_field("instanceId", &self.instance_id)?;
        }
        if !self.widget_canonical_id.is_empty() {
            struct_ser.serialize_field("widgetCanonicalId", &self.widget_canonical_id)?;
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
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for UpsertWidgetStatusRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "application_id",
            "applicationId",
            "module_id",
            "moduleId",
            "instance_id",
            "instanceId",
            "widget_canonical_id",
            "widgetCanonicalId",
            "key",
            "value",
            "occurred_at",
            "occurredAt",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ApplicationId,
            ModuleId,
            InstanceId,
            WidgetCanonicalId,
            Key,
            Value,
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
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            "moduleId" | "module_id" => Ok(GeneratedField::ModuleId),
                            "instanceId" | "instance_id" => Ok(GeneratedField::InstanceId),
                            "widgetCanonicalId" | "widget_canonical_id" => Ok(GeneratedField::WidgetCanonicalId),
                            "key" => Ok(GeneratedField::Key),
                            "value" => Ok(GeneratedField::Value),
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
            type Value = UpsertWidgetStatusRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct widget_status.UpsertWidgetStatusRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<UpsertWidgetStatusRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut application_id__ = None;
                let mut module_id__ = None;
                let mut instance_id__ = None;
                let mut widget_canonical_id__ = None;
                let mut key__ = None;
                let mut value__ = None;
                let mut occurred_at__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ModuleId => {
                            if module_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleId"));
                            }
                            module_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::InstanceId => {
                            if instance_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instanceId"));
                            }
                            instance_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::WidgetCanonicalId => {
                            if widget_canonical_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("widgetCanonicalId"));
                            }
                            widget_canonical_id__ = Some(map_.next_value()?);
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
                    }
                }
                Ok(UpsertWidgetStatusRequest {
                    application_id: application_id__.unwrap_or_default(),
                    module_id: module_id__.unwrap_or_default(),
                    instance_id: instance_id__.unwrap_or_default(),
                    widget_canonical_id: widget_canonical_id__.unwrap_or_default(),
                    key: key__.unwrap_or_default(),
                    value: value__.unwrap_or_default(),
                    occurred_at: occurred_at__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("widget_status.UpsertWidgetStatusRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for WidgetStatus {
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
        if !self.application_id.is_empty() {
            len += 1;
        }
        if !self.module_id.is_empty() {
            len += 1;
        }
        if !self.instance_id.is_empty() {
            len += 1;
        }
        if !self.widget_canonical_id.is_empty() {
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
        if self.updated_at.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("widget_status.WidgetStatus", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        if !self.instance_id.is_empty() {
            struct_ser.serialize_field("instanceId", &self.instance_id)?;
        }
        if !self.widget_canonical_id.is_empty() {
            struct_ser.serialize_field("widgetCanonicalId", &self.widget_canonical_id)?;
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
        if let Some(v) = self.updated_at.as_ref() {
            struct_ser.serialize_field("updatedAt", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for WidgetStatus {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "application_id",
            "applicationId",
            "module_id",
            "moduleId",
            "instance_id",
            "instanceId",
            "widget_canonical_id",
            "widgetCanonicalId",
            "key",
            "value",
            "occurred_at",
            "occurredAt",
            "created_at",
            "createdAt",
            "updated_at",
            "updatedAt",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            ApplicationId,
            ModuleId,
            InstanceId,
            WidgetCanonicalId,
            Key,
            Value,
            OccurredAt,
            CreatedAt,
            UpdatedAt,
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
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            "moduleId" | "module_id" => Ok(GeneratedField::ModuleId),
                            "instanceId" | "instance_id" => Ok(GeneratedField::InstanceId),
                            "widgetCanonicalId" | "widget_canonical_id" => Ok(GeneratedField::WidgetCanonicalId),
                            "key" => Ok(GeneratedField::Key),
                            "value" => Ok(GeneratedField::Value),
                            "occurredAt" | "occurred_at" => Ok(GeneratedField::OccurredAt),
                            "createdAt" | "created_at" => Ok(GeneratedField::CreatedAt),
                            "updatedAt" | "updated_at" => Ok(GeneratedField::UpdatedAt),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = WidgetStatus;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct widget_status.WidgetStatus")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<WidgetStatus, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut application_id__ = None;
                let mut module_id__ = None;
                let mut instance_id__ = None;
                let mut widget_canonical_id__ = None;
                let mut key__ = None;
                let mut value__ = None;
                let mut occurred_at__ = None;
                let mut created_at__ = None;
                let mut updated_at__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ModuleId => {
                            if module_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleId"));
                            }
                            module_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::InstanceId => {
                            if instance_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instanceId"));
                            }
                            instance_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::WidgetCanonicalId => {
                            if widget_canonical_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("widgetCanonicalId"));
                            }
                            widget_canonical_id__ = Some(map_.next_value()?);
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
                        GeneratedField::UpdatedAt => {
                            if updated_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("updatedAt"));
                            }
                            updated_at__ = map_.next_value()?;
                        }
                    }
                }
                Ok(WidgetStatus {
                    id: id__.unwrap_or_default(),
                    application_id: application_id__.unwrap_or_default(),
                    module_id: module_id__.unwrap_or_default(),
                    instance_id: instance_id__.unwrap_or_default(),
                    widget_canonical_id: widget_canonical_id__.unwrap_or_default(),
                    key: key__.unwrap_or_default(),
                    value: value__.unwrap_or_default(),
                    occurred_at: occurred_at__,
                    created_at: created_at__,
                    updated_at: updated_at__,
                })
            }
        }
        deserializer.deserialize_struct("widget_status.WidgetStatus", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for WidgetStatusResponse {
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
        if self.widget_status.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("widget_status.WidgetStatusResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.widget_status.as_ref() {
            struct_ser.serialize_field("widgetStatus", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for WidgetStatusResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "widget_status",
            "widgetStatus",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            WidgetStatus,
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
                            "widgetStatus" | "widget_status" => Ok(GeneratedField::WidgetStatus),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = WidgetStatusResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct widget_status.WidgetStatusResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<WidgetStatusResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut widget_status__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::WidgetStatus => {
                            if widget_status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("widgetStatus"));
                            }
                            widget_status__ = map_.next_value()?;
                        }
                    }
                }
                Ok(WidgetStatusResponse {
                    status: status__,
                    widget_status: widget_status__,
                })
            }
        }
        deserializer.deserialize_struct("widget_status.WidgetStatusResponse", FIELDS, GeneratedVisitor)
    }
}
