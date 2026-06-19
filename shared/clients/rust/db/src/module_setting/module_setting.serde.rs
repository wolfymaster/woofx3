// @generated
impl serde::Serialize for ListModuleSettingsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.module_id.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module_setting.ListModuleSettingsRequest", len)?;
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListModuleSettingsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "module_id",
            "moduleId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ModuleId,
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
                            "moduleId" | "module_id" => Ok(GeneratedField::ModuleId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListModuleSettingsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module_setting.ListModuleSettingsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListModuleSettingsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut module_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ModuleId => {
                            if module_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleId"));
                            }
                            module_id__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListModuleSettingsRequest {
                    module_id: module_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module_setting.ListModuleSettingsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListModuleSettingsResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.settings.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module_setting.ListModuleSettingsResponse", len)?;
        if !self.settings.is_empty() {
            struct_ser.serialize_field("settings", &self.settings)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListModuleSettingsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "settings",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
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
            type Value = ListModuleSettingsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module_setting.ListModuleSettingsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListModuleSettingsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut settings__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Settings => {
                            if settings__.is_some() {
                                return Err(serde::de::Error::duplicate_field("settings"));
                            }
                            settings__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListModuleSettingsResponse {
                    settings: settings__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module_setting.ListModuleSettingsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ManifestSettingInput {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.key.is_empty() {
            len += 1;
        }
        if !self.value.is_empty() {
            len += 1;
        }
        if !self.value_type.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module_setting.ManifestSettingInput", len)?;
        if !self.key.is_empty() {
            struct_ser.serialize_field("key", &self.key)?;
        }
        if !self.value.is_empty() {
            struct_ser.serialize_field("value", &self.value)?;
        }
        if !self.value_type.is_empty() {
            struct_ser.serialize_field("valueType", &self.value_type)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ManifestSettingInput {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "key",
            "value",
            "value_type",
            "valueType",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Key,
            Value,
            ValueType,
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
                            "key" => Ok(GeneratedField::Key),
                            "value" => Ok(GeneratedField::Value),
                            "valueType" | "value_type" => Ok(GeneratedField::ValueType),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ManifestSettingInput;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module_setting.ManifestSettingInput")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ManifestSettingInput, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut key__ = None;
                let mut value__ = None;
                let mut value_type__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
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
                        GeneratedField::ValueType => {
                            if value_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("valueType"));
                            }
                            value_type__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ManifestSettingInput {
                    key: key__.unwrap_or_default(),
                    value: value__.unwrap_or_default(),
                    value_type: value_type__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module_setting.ManifestSettingInput", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ModuleSettingRecord {
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
        if !self.module_id.is_empty() {
            len += 1;
        }
        if !self.key.is_empty() {
            len += 1;
        }
        if !self.value.is_empty() {
            len += 1;
        }
        if !self.value_type.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module_setting.ModuleSettingRecord", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        if !self.key.is_empty() {
            struct_ser.serialize_field("key", &self.key)?;
        }
        if !self.value.is_empty() {
            struct_ser.serialize_field("value", &self.value)?;
        }
        if !self.value_type.is_empty() {
            struct_ser.serialize_field("valueType", &self.value_type)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ModuleSettingRecord {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "module_id",
            "moduleId",
            "key",
            "value",
            "value_type",
            "valueType",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            ModuleId,
            Key,
            Value,
            ValueType,
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
                            "moduleId" | "module_id" => Ok(GeneratedField::ModuleId),
                            "key" => Ok(GeneratedField::Key),
                            "value" => Ok(GeneratedField::Value),
                            "valueType" | "value_type" => Ok(GeneratedField::ValueType),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ModuleSettingRecord;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module_setting.ModuleSettingRecord")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ModuleSettingRecord, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut module_id__ = None;
                let mut key__ = None;
                let mut value__ = None;
                let mut value_type__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ModuleId => {
                            if module_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleId"));
                            }
                            module_id__ = Some(map_.next_value()?);
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
                        GeneratedField::ValueType => {
                            if value_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("valueType"));
                            }
                            value_type__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ModuleSettingRecord {
                    id: id__.unwrap_or_default(),
                    module_id: module_id__.unwrap_or_default(),
                    key: key__.unwrap_or_default(),
                    value: value__.unwrap_or_default(),
                    value_type: value_type__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module_setting.ModuleSettingRecord", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RegisterModuleSettingsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.module_id.is_empty() {
            len += 1;
        }
        if !self.settings.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module_setting.RegisterModuleSettingsRequest", len)?;
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        if !self.settings.is_empty() {
            struct_ser.serialize_field("settings", &self.settings)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RegisterModuleSettingsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "module_id",
            "moduleId",
            "settings",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ModuleId,
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
                            "moduleId" | "module_id" => Ok(GeneratedField::ModuleId),
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
            type Value = RegisterModuleSettingsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module_setting.RegisterModuleSettingsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RegisterModuleSettingsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut module_id__ = None;
                let mut settings__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ModuleId => {
                            if module_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleId"));
                            }
                            module_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Settings => {
                            if settings__.is_some() {
                                return Err(serde::de::Error::duplicate_field("settings"));
                            }
                            settings__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RegisterModuleSettingsRequest {
                    module_id: module_id__.unwrap_or_default(),
                    settings: settings__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module_setting.RegisterModuleSettingsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RegisterModuleSettingsResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.registered != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module_setting.RegisterModuleSettingsResponse", len)?;
        if self.registered != 0 {
            struct_ser.serialize_field("registered", &self.registered)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RegisterModuleSettingsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "registered",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Registered,
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
                            "registered" => Ok(GeneratedField::Registered),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RegisterModuleSettingsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module_setting.RegisterModuleSettingsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RegisterModuleSettingsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut registered__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Registered => {
                            if registered__.is_some() {
                                return Err(serde::de::Error::duplicate_field("registered"));
                            }
                            registered__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(RegisterModuleSettingsResponse {
                    registered: registered__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module_setting.RegisterModuleSettingsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SetModuleSettingRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.module_id.is_empty() {
            len += 1;
        }
        if !self.key.is_empty() {
            len += 1;
        }
        if !self.value.is_empty() {
            len += 1;
        }
        if !self.value_type.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module_setting.SetModuleSettingRequest", len)?;
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        if !self.key.is_empty() {
            struct_ser.serialize_field("key", &self.key)?;
        }
        if !self.value.is_empty() {
            struct_ser.serialize_field("value", &self.value)?;
        }
        if !self.value_type.is_empty() {
            struct_ser.serialize_field("valueType", &self.value_type)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SetModuleSettingRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "module_id",
            "moduleId",
            "key",
            "value",
            "value_type",
            "valueType",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ModuleId,
            Key,
            Value,
            ValueType,
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
                            "moduleId" | "module_id" => Ok(GeneratedField::ModuleId),
                            "key" => Ok(GeneratedField::Key),
                            "value" => Ok(GeneratedField::Value),
                            "valueType" | "value_type" => Ok(GeneratedField::ValueType),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = SetModuleSettingRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module_setting.SetModuleSettingRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SetModuleSettingRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut module_id__ = None;
                let mut key__ = None;
                let mut value__ = None;
                let mut value_type__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ModuleId => {
                            if module_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleId"));
                            }
                            module_id__ = Some(map_.next_value()?);
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
                        GeneratedField::ValueType => {
                            if value_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("valueType"));
                            }
                            value_type__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(SetModuleSettingRequest {
                    module_id: module_id__.unwrap_or_default(),
                    key: key__.unwrap_or_default(),
                    value: value__.unwrap_or_default(),
                    value_type: value_type__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module_setting.SetModuleSettingRequest", FIELDS, GeneratedVisitor)
    }
}
