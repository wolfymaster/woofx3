// @generated
impl serde::Serialize for DeleteLocalUiSettingRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.namespace.is_empty() {
            len += 1;
        }
        if !self.key.is_empty() {
            len += 1;
        }
        if self.expected_revision.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("local_ui_setting.DeleteLocalUISettingRequest", len)?;
        if !self.namespace.is_empty() {
            struct_ser.serialize_field("namespace", &self.namespace)?;
        }
        if !self.key.is_empty() {
            struct_ser.serialize_field("key", &self.key)?;
        }
        if let Some(v) = self.expected_revision.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("expectedRevision", ToString::to_string(&v).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DeleteLocalUiSettingRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "namespace",
            "key",
            "expected_revision",
            "expectedRevision",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Namespace,
            Key,
            ExpectedRevision,
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
                            "namespace" => Ok(GeneratedField::Namespace),
                            "key" => Ok(GeneratedField::Key),
                            "expectedRevision" | "expected_revision" => Ok(GeneratedField::ExpectedRevision),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = DeleteLocalUiSettingRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct local_ui_setting.DeleteLocalUISettingRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DeleteLocalUiSettingRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut namespace__ = None;
                let mut key__ = None;
                let mut expected_revision__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Namespace => {
                            if namespace__.is_some() {
                                return Err(serde::de::Error::duplicate_field("namespace"));
                            }
                            namespace__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Key => {
                            if key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("key"));
                            }
                            key__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ExpectedRevision => {
                            if expected_revision__.is_some() {
                                return Err(serde::de::Error::duplicate_field("expectedRevision"));
                            }
                            expected_revision__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                    }
                }
                Ok(DeleteLocalUiSettingRequest {
                    namespace: namespace__.unwrap_or_default(),
                    key: key__.unwrap_or_default(),
                    expected_revision: expected_revision__,
                })
            }
        }
        deserializer.deserialize_struct("local_ui_setting.DeleteLocalUISettingRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetLocalUiSettingRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.namespace.is_empty() {
            len += 1;
        }
        if !self.key.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("local_ui_setting.GetLocalUISettingRequest", len)?;
        if !self.namespace.is_empty() {
            struct_ser.serialize_field("namespace", &self.namespace)?;
        }
        if !self.key.is_empty() {
            struct_ser.serialize_field("key", &self.key)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetLocalUiSettingRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "namespace",
            "key",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Namespace,
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
                            "namespace" => Ok(GeneratedField::Namespace),
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
            type Value = GetLocalUiSettingRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct local_ui_setting.GetLocalUISettingRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetLocalUiSettingRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut namespace__ = None;
                let mut key__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Namespace => {
                            if namespace__.is_some() {
                                return Err(serde::de::Error::duplicate_field("namespace"));
                            }
                            namespace__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Key => {
                            if key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("key"));
                            }
                            key__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(GetLocalUiSettingRequest {
                    namespace: namespace__.unwrap_or_default(),
                    key: key__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("local_ui_setting.GetLocalUISettingRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetLocalUiSettingResponse {
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
        if self.setting.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("local_ui_setting.GetLocalUISettingResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.setting.as_ref() {
            struct_ser.serialize_field("setting", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetLocalUiSettingResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "setting",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Setting,
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
                            "setting" => Ok(GeneratedField::Setting),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetLocalUiSettingResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct local_ui_setting.GetLocalUISettingResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetLocalUiSettingResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut setting__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Setting => {
                            if setting__.is_some() {
                                return Err(serde::de::Error::duplicate_field("setting"));
                            }
                            setting__ = map_.next_value()?;
                        }
                    }
                }
                Ok(GetLocalUiSettingResponse {
                    status: status__,
                    setting: setting__,
                })
            }
        }
        deserializer.deserialize_struct("local_ui_setting.GetLocalUISettingResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListLocalUiSettingChangesRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.after_revision != 0 {
            len += 1;
        }
        if self.limit != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("local_ui_setting.ListLocalUISettingChangesRequest", len)?;
        if self.after_revision != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("afterRevision", ToString::to_string(&self.after_revision).as_str())?;
        }
        if self.limit != 0 {
            struct_ser.serialize_field("limit", &self.limit)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListLocalUiSettingChangesRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "after_revision",
            "afterRevision",
            "limit",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            AfterRevision,
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
                            "afterRevision" | "after_revision" => Ok(GeneratedField::AfterRevision),
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
            type Value = ListLocalUiSettingChangesRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct local_ui_setting.ListLocalUISettingChangesRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListLocalUiSettingChangesRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut after_revision__ = None;
                let mut limit__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::AfterRevision => {
                            if after_revision__.is_some() {
                                return Err(serde::de::Error::duplicate_field("afterRevision"));
                            }
                            after_revision__ = 
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
                    }
                }
                Ok(ListLocalUiSettingChangesRequest {
                    after_revision: after_revision__.unwrap_or_default(),
                    limit: limit__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("local_ui_setting.ListLocalUISettingChangesRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListLocalUiSettingChangesResponse {
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
        if !self.settings.is_empty() {
            len += 1;
        }
        if self.has_more {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("local_ui_setting.ListLocalUISettingChangesResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.settings.is_empty() {
            struct_ser.serialize_field("settings", &self.settings)?;
        }
        if self.has_more {
            struct_ser.serialize_field("hasMore", &self.has_more)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListLocalUiSettingChangesResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "settings",
            "has_more",
            "hasMore",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Settings,
            HasMore,
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
                            "settings" => Ok(GeneratedField::Settings),
                            "hasMore" | "has_more" => Ok(GeneratedField::HasMore),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListLocalUiSettingChangesResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct local_ui_setting.ListLocalUISettingChangesResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListLocalUiSettingChangesResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut settings__ = None;
                let mut has_more__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Settings => {
                            if settings__.is_some() {
                                return Err(serde::de::Error::duplicate_field("settings"));
                            }
                            settings__ = Some(map_.next_value()?);
                        }
                        GeneratedField::HasMore => {
                            if has_more__.is_some() {
                                return Err(serde::de::Error::duplicate_field("hasMore"));
                            }
                            has_more__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListLocalUiSettingChangesResponse {
                    status: status__,
                    settings: settings__.unwrap_or_default(),
                    has_more: has_more__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("local_ui_setting.ListLocalUISettingChangesResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListLocalUiSettingsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.namespace.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("local_ui_setting.ListLocalUISettingsRequest", len)?;
        if !self.namespace.is_empty() {
            struct_ser.serialize_field("namespace", &self.namespace)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListLocalUiSettingsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "namespace",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Namespace,
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
                            "namespace" => Ok(GeneratedField::Namespace),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListLocalUiSettingsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct local_ui_setting.ListLocalUISettingsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListLocalUiSettingsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut namespace__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Namespace => {
                            if namespace__.is_some() {
                                return Err(serde::de::Error::duplicate_field("namespace"));
                            }
                            namespace__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListLocalUiSettingsRequest {
                    namespace: namespace__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("local_ui_setting.ListLocalUISettingsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListLocalUiSettingsResponse {
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
        if !self.settings.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("local_ui_setting.ListLocalUISettingsResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.settings.is_empty() {
            struct_ser.serialize_field("settings", &self.settings)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListLocalUiSettingsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "settings",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Settings,
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
                            "settings" => Ok(GeneratedField::Settings),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListLocalUiSettingsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct local_ui_setting.ListLocalUISettingsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListLocalUiSettingsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut settings__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Settings => {
                            if settings__.is_some() {
                                return Err(serde::de::Error::duplicate_field("settings"));
                            }
                            settings__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListLocalUiSettingsResponse {
                    status: status__,
                    settings: settings__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("local_ui_setting.ListLocalUISettingsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for LocalUiSetting {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.namespace.is_empty() {
            len += 1;
        }
        if !self.key.is_empty() {
            len += 1;
        }
        if !self.value_json.is_empty() {
            len += 1;
        }
        if self.revision != 0 {
            len += 1;
        }
        if self.updated_at.is_some() {
            len += 1;
        }
        if self.deleted {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("local_ui_setting.LocalUISetting", len)?;
        if !self.namespace.is_empty() {
            struct_ser.serialize_field("namespace", &self.namespace)?;
        }
        if !self.key.is_empty() {
            struct_ser.serialize_field("key", &self.key)?;
        }
        if !self.value_json.is_empty() {
            struct_ser.serialize_field("valueJson", &self.value_json)?;
        }
        if self.revision != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("revision", ToString::to_string(&self.revision).as_str())?;
        }
        if let Some(v) = self.updated_at.as_ref() {
            struct_ser.serialize_field("updatedAt", v)?;
        }
        if self.deleted {
            struct_ser.serialize_field("deleted", &self.deleted)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for LocalUiSetting {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "namespace",
            "key",
            "value_json",
            "valueJson",
            "revision",
            "updated_at",
            "updatedAt",
            "deleted",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Namespace,
            Key,
            ValueJson,
            Revision,
            UpdatedAt,
            Deleted,
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
                            "namespace" => Ok(GeneratedField::Namespace),
                            "key" => Ok(GeneratedField::Key),
                            "valueJson" | "value_json" => Ok(GeneratedField::ValueJson),
                            "revision" => Ok(GeneratedField::Revision),
                            "updatedAt" | "updated_at" => Ok(GeneratedField::UpdatedAt),
                            "deleted" => Ok(GeneratedField::Deleted),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = LocalUiSetting;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct local_ui_setting.LocalUISetting")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<LocalUiSetting, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut namespace__ = None;
                let mut key__ = None;
                let mut value_json__ = None;
                let mut revision__ = None;
                let mut updated_at__ = None;
                let mut deleted__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Namespace => {
                            if namespace__.is_some() {
                                return Err(serde::de::Error::duplicate_field("namespace"));
                            }
                            namespace__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Key => {
                            if key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("key"));
                            }
                            key__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ValueJson => {
                            if value_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("valueJson"));
                            }
                            value_json__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Revision => {
                            if revision__.is_some() {
                                return Err(serde::de::Error::duplicate_field("revision"));
                            }
                            revision__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::UpdatedAt => {
                            if updated_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("updatedAt"));
                            }
                            updated_at__ = map_.next_value()?;
                        }
                        GeneratedField::Deleted => {
                            if deleted__.is_some() {
                                return Err(serde::de::Error::duplicate_field("deleted"));
                            }
                            deleted__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(LocalUiSetting {
                    namespace: namespace__.unwrap_or_default(),
                    key: key__.unwrap_or_default(),
                    value_json: value_json__.unwrap_or_default(),
                    revision: revision__.unwrap_or_default(),
                    updated_at: updated_at__,
                    deleted: deleted__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("local_ui_setting.LocalUISetting", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SetLocalUiSettingRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.namespace.is_empty() {
            len += 1;
        }
        if !self.key.is_empty() {
            len += 1;
        }
        if !self.value_json.is_empty() {
            len += 1;
        }
        if self.expected_revision.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("local_ui_setting.SetLocalUISettingRequest", len)?;
        if !self.namespace.is_empty() {
            struct_ser.serialize_field("namespace", &self.namespace)?;
        }
        if !self.key.is_empty() {
            struct_ser.serialize_field("key", &self.key)?;
        }
        if !self.value_json.is_empty() {
            struct_ser.serialize_field("valueJson", &self.value_json)?;
        }
        if let Some(v) = self.expected_revision.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("expectedRevision", ToString::to_string(&v).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SetLocalUiSettingRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "namespace",
            "key",
            "value_json",
            "valueJson",
            "expected_revision",
            "expectedRevision",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Namespace,
            Key,
            ValueJson,
            ExpectedRevision,
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
                            "namespace" => Ok(GeneratedField::Namespace),
                            "key" => Ok(GeneratedField::Key),
                            "valueJson" | "value_json" => Ok(GeneratedField::ValueJson),
                            "expectedRevision" | "expected_revision" => Ok(GeneratedField::ExpectedRevision),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = SetLocalUiSettingRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct local_ui_setting.SetLocalUISettingRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SetLocalUiSettingRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut namespace__ = None;
                let mut key__ = None;
                let mut value_json__ = None;
                let mut expected_revision__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Namespace => {
                            if namespace__.is_some() {
                                return Err(serde::de::Error::duplicate_field("namespace"));
                            }
                            namespace__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Key => {
                            if key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("key"));
                            }
                            key__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ValueJson => {
                            if value_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("valueJson"));
                            }
                            value_json__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ExpectedRevision => {
                            if expected_revision__.is_some() {
                                return Err(serde::de::Error::duplicate_field("expectedRevision"));
                            }
                            expected_revision__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                    }
                }
                Ok(SetLocalUiSettingRequest {
                    namespace: namespace__.unwrap_or_default(),
                    key: key__.unwrap_or_default(),
                    value_json: value_json__.unwrap_or_default(),
                    expected_revision: expected_revision__,
                })
            }
        }
        deserializer.deserialize_struct("local_ui_setting.SetLocalUISettingRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for WriteLocalUiSettingResponse {
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
        if self.setting.is_some() {
            len += 1;
        }
        if self.conflict {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("local_ui_setting.WriteLocalUISettingResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.setting.as_ref() {
            struct_ser.serialize_field("setting", v)?;
        }
        if self.conflict {
            struct_ser.serialize_field("conflict", &self.conflict)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for WriteLocalUiSettingResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "setting",
            "conflict",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Setting,
            Conflict,
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
                            "setting" => Ok(GeneratedField::Setting),
                            "conflict" => Ok(GeneratedField::Conflict),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = WriteLocalUiSettingResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct local_ui_setting.WriteLocalUISettingResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<WriteLocalUiSettingResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut setting__ = None;
                let mut conflict__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Setting => {
                            if setting__.is_some() {
                                return Err(serde::de::Error::duplicate_field("setting"));
                            }
                            setting__ = map_.next_value()?;
                        }
                        GeneratedField::Conflict => {
                            if conflict__.is_some() {
                                return Err(serde::de::Error::duplicate_field("conflict"));
                            }
                            conflict__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(WriteLocalUiSettingResponse {
                    status: status__,
                    setting: setting__,
                    conflict: conflict__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("local_ui_setting.WriteLocalUISettingResponse", FIELDS, GeneratedVisitor)
    }
}
