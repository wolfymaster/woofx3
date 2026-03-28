// @generated
impl serde::Serialize for CreateModuleFunctionRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.function_name.is_empty() {
            len += 1;
        }
        if !self.file_name.is_empty() {
            len += 1;
        }
        if !self.file_key.is_empty() {
            len += 1;
        }
        if !self.entry_point.is_empty() {
            len += 1;
        }
        if !self.runtime.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.CreateModuleFunctionRequest", len)?;
        if !self.function_name.is_empty() {
            struct_ser.serialize_field("functionName", &self.function_name)?;
        }
        if !self.file_name.is_empty() {
            struct_ser.serialize_field("fileName", &self.file_name)?;
        }
        if !self.file_key.is_empty() {
            struct_ser.serialize_field("fileKey", &self.file_key)?;
        }
        if !self.entry_point.is_empty() {
            struct_ser.serialize_field("entryPoint", &self.entry_point)?;
        }
        if !self.runtime.is_empty() {
            struct_ser.serialize_field("runtime", &self.runtime)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CreateModuleFunctionRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "function_name",
            "functionName",
            "file_name",
            "fileName",
            "file_key",
            "fileKey",
            "entry_point",
            "entryPoint",
            "runtime",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            FunctionName,
            FileName,
            FileKey,
            EntryPoint,
            Runtime,
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
                            "functionName" | "function_name" => Ok(GeneratedField::FunctionName),
                            "fileName" | "file_name" => Ok(GeneratedField::FileName),
                            "fileKey" | "file_key" => Ok(GeneratedField::FileKey),
                            "entryPoint" | "entry_point" => Ok(GeneratedField::EntryPoint),
                            "runtime" => Ok(GeneratedField::Runtime),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CreateModuleFunctionRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.CreateModuleFunctionRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CreateModuleFunctionRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut function_name__ = None;
                let mut file_name__ = None;
                let mut file_key__ = None;
                let mut entry_point__ = None;
                let mut runtime__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::FunctionName => {
                            if function_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("functionName"));
                            }
                            function_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::FileName => {
                            if file_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("fileName"));
                            }
                            file_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::FileKey => {
                            if file_key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("fileKey"));
                            }
                            file_key__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EntryPoint => {
                            if entry_point__.is_some() {
                                return Err(serde::de::Error::duplicate_field("entryPoint"));
                            }
                            entry_point__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Runtime => {
                            if runtime__.is_some() {
                                return Err(serde::de::Error::duplicate_field("runtime"));
                            }
                            runtime__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(CreateModuleFunctionRequest {
                    function_name: function_name__.unwrap_or_default(),
                    file_name: file_name__.unwrap_or_default(),
                    file_key: file_key__.unwrap_or_default(),
                    entry_point: entry_point__.unwrap_or_default(),
                    runtime: runtime__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.CreateModuleFunctionRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for CreateModuleRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.name.is_empty() {
            len += 1;
        }
        if !self.version.is_empty() {
            len += 1;
        }
        if !self.manifest.is_empty() {
            len += 1;
        }
        if !self.archive_key.is_empty() {
            len += 1;
        }
        if !self.functions.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.CreateModuleRequest", len)?;
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.version.is_empty() {
            struct_ser.serialize_field("version", &self.version)?;
        }
        if !self.manifest.is_empty() {
            struct_ser.serialize_field("manifest", &self.manifest)?;
        }
        if !self.archive_key.is_empty() {
            struct_ser.serialize_field("archiveKey", &self.archive_key)?;
        }
        if !self.functions.is_empty() {
            struct_ser.serialize_field("functions", &self.functions)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CreateModuleRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "name",
            "version",
            "manifest",
            "archive_key",
            "archiveKey",
            "functions",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Name,
            Version,
            Manifest,
            ArchiveKey,
            Functions,
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
                            "name" => Ok(GeneratedField::Name),
                            "version" => Ok(GeneratedField::Version),
                            "manifest" => Ok(GeneratedField::Manifest),
                            "archiveKey" | "archive_key" => Ok(GeneratedField::ArchiveKey),
                            "functions" => Ok(GeneratedField::Functions),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CreateModuleRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.CreateModuleRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CreateModuleRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut name__ = None;
                let mut version__ = None;
                let mut manifest__ = None;
                let mut archive_key__ = None;
                let mut functions__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Name => {
                            if name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("name"));
                            }
                            name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Version => {
                            if version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("version"));
                            }
                            version__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Manifest => {
                            if manifest__.is_some() {
                                return Err(serde::de::Error::duplicate_field("manifest"));
                            }
                            manifest__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ArchiveKey => {
                            if archive_key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("archiveKey"));
                            }
                            archive_key__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Functions => {
                            if functions__.is_some() {
                                return Err(serde::de::Error::duplicate_field("functions"));
                            }
                            functions__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(CreateModuleRequest {
                    name: name__.unwrap_or_default(),
                    version: version__.unwrap_or_default(),
                    manifest: manifest__.unwrap_or_default(),
                    archive_key: archive_key__.unwrap_or_default(),
                    functions: functions__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.CreateModuleRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DeleteModuleRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.name.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.DeleteModuleRequest", len)?;
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DeleteModuleRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "name",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Name,
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
                            "name" => Ok(GeneratedField::Name),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = DeleteModuleRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.DeleteModuleRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DeleteModuleRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut name__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Name => {
                            if name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("name"));
                            }
                            name__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(DeleteModuleRequest {
                    name: name__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.DeleteModuleRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DeleteTriggersByModuleRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.module_name.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.DeleteTriggersByModuleRequest", len)?;
        if !self.module_name.is_empty() {
            struct_ser.serialize_field("moduleName", &self.module_name)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DeleteTriggersByModuleRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "module_name",
            "moduleName",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ModuleName,
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
                            "moduleName" | "module_name" => Ok(GeneratedField::ModuleName),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = DeleteTriggersByModuleRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.DeleteTriggersByModuleRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DeleteTriggersByModuleRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut module_name__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ModuleName => {
                            if module_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleName"));
                            }
                            module_name__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(DeleteTriggersByModuleRequest {
                    module_name: module_name__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.DeleteTriggersByModuleRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetModuleByNameRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.name.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.GetModuleByNameRequest", len)?;
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetModuleByNameRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "name",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Name,
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
                            "name" => Ok(GeneratedField::Name),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetModuleByNameRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.GetModuleByNameRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetModuleByNameRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut name__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Name => {
                            if name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("name"));
                            }
                            name__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(GetModuleByNameRequest {
                    name: name__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.GetModuleByNameRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetModuleRequest {
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
        let mut struct_ser = serializer.serialize_struct("module.GetModuleRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetModuleRequest {
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
            type Value = GetModuleRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.GetModuleRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetModuleRequest, V::Error>
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
                Ok(GetModuleRequest {
                    id: id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.GetModuleRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListModulesRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.state.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ListModulesRequest", len)?;
        if !self.state.is_empty() {
            struct_ser.serialize_field("state", &self.state)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListModulesRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "state",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            State,
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
                            "state" => Ok(GeneratedField::State),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListModulesRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ListModulesRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListModulesRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut state__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::State => {
                            if state__.is_some() {
                                return Err(serde::de::Error::duplicate_field("state"));
                            }
                            state__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListModulesRequest {
                    state: state__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.ListModulesRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListModulesResponse {
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
        if !self.modules.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ListModulesResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.modules.is_empty() {
            struct_ser.serialize_field("modules", &self.modules)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListModulesResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "modules",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Modules,
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
                            "modules" => Ok(GeneratedField::Modules),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListModulesResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ListModulesResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListModulesResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut modules__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Modules => {
                            if modules__.is_some() {
                                return Err(serde::de::Error::duplicate_field("modules"));
                            }
                            modules__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListModulesResponse {
                    status: status__,
                    modules: modules__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.ListModulesResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListTriggersRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.module_name.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ListTriggersRequest", len)?;
        if !self.module_name.is_empty() {
            struct_ser.serialize_field("moduleName", &self.module_name)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListTriggersRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "module_name",
            "moduleName",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ModuleName,
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
                            "moduleName" | "module_name" => Ok(GeneratedField::ModuleName),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListTriggersRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ListTriggersRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListTriggersRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut module_name__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ModuleName => {
                            if module_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleName"));
                            }
                            module_name__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListTriggersRequest {
                    module_name: module_name__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.ListTriggersRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListTriggersResponse {
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
        if !self.triggers.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ListTriggersResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.triggers.is_empty() {
            struct_ser.serialize_field("triggers", &self.triggers)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListTriggersResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "triggers",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Triggers,
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
                            "triggers" => Ok(GeneratedField::Triggers),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListTriggersResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ListTriggersResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListTriggersResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut triggers__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Triggers => {
                            if triggers__.is_some() {
                                return Err(serde::de::Error::duplicate_field("triggers"));
                            }
                            triggers__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListTriggersResponse {
                    status: status__,
                    triggers: triggers__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.ListTriggersResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for Module {
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
        if !self.name.is_empty() {
            len += 1;
        }
        if !self.version.is_empty() {
            len += 1;
        }
        if !self.manifest.is_empty() {
            len += 1;
        }
        if !self.state.is_empty() {
            len += 1;
        }
        if !self.archive_key.is_empty() {
            len += 1;
        }
        if !self.functions.is_empty() {
            len += 1;
        }
        if self.installed_at.is_some() {
            len += 1;
        }
        if self.updated_at.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.Module", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.version.is_empty() {
            struct_ser.serialize_field("version", &self.version)?;
        }
        if !self.manifest.is_empty() {
            struct_ser.serialize_field("manifest", &self.manifest)?;
        }
        if !self.state.is_empty() {
            struct_ser.serialize_field("state", &self.state)?;
        }
        if !self.archive_key.is_empty() {
            struct_ser.serialize_field("archiveKey", &self.archive_key)?;
        }
        if !self.functions.is_empty() {
            struct_ser.serialize_field("functions", &self.functions)?;
        }
        if let Some(v) = self.installed_at.as_ref() {
            struct_ser.serialize_field("installedAt", v)?;
        }
        if let Some(v) = self.updated_at.as_ref() {
            struct_ser.serialize_field("updatedAt", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Module {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "name",
            "version",
            "manifest",
            "state",
            "archive_key",
            "archiveKey",
            "functions",
            "installed_at",
            "installedAt",
            "updated_at",
            "updatedAt",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Name,
            Version,
            Manifest,
            State,
            ArchiveKey,
            Functions,
            InstalledAt,
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
                            "name" => Ok(GeneratedField::Name),
                            "version" => Ok(GeneratedField::Version),
                            "manifest" => Ok(GeneratedField::Manifest),
                            "state" => Ok(GeneratedField::State),
                            "archiveKey" | "archive_key" => Ok(GeneratedField::ArchiveKey),
                            "functions" => Ok(GeneratedField::Functions),
                            "installedAt" | "installed_at" => Ok(GeneratedField::InstalledAt),
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
            type Value = Module;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.Module")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Module, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut name__ = None;
                let mut version__ = None;
                let mut manifest__ = None;
                let mut state__ = None;
                let mut archive_key__ = None;
                let mut functions__ = None;
                let mut installed_at__ = None;
                let mut updated_at__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Name => {
                            if name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("name"));
                            }
                            name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Version => {
                            if version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("version"));
                            }
                            version__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Manifest => {
                            if manifest__.is_some() {
                                return Err(serde::de::Error::duplicate_field("manifest"));
                            }
                            manifest__ = Some(map_.next_value()?);
                        }
                        GeneratedField::State => {
                            if state__.is_some() {
                                return Err(serde::de::Error::duplicate_field("state"));
                            }
                            state__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ArchiveKey => {
                            if archive_key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("archiveKey"));
                            }
                            archive_key__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Functions => {
                            if functions__.is_some() {
                                return Err(serde::de::Error::duplicate_field("functions"));
                            }
                            functions__ = Some(map_.next_value()?);
                        }
                        GeneratedField::InstalledAt => {
                            if installed_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("installedAt"));
                            }
                            installed_at__ = map_.next_value()?;
                        }
                        GeneratedField::UpdatedAt => {
                            if updated_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("updatedAt"));
                            }
                            updated_at__ = map_.next_value()?;
                        }
                    }
                }
                Ok(Module {
                    id: id__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                    version: version__.unwrap_or_default(),
                    manifest: manifest__.unwrap_or_default(),
                    state: state__.unwrap_or_default(),
                    archive_key: archive_key__.unwrap_or_default(),
                    functions: functions__.unwrap_or_default(),
                    installed_at: installed_at__,
                    updated_at: updated_at__,
                })
            }
        }
        deserializer.deserialize_struct("module.Module", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ModuleFunction {
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
        if !self.function_name.is_empty() {
            len += 1;
        }
        if !self.file_name.is_empty() {
            len += 1;
        }
        if !self.file_key.is_empty() {
            len += 1;
        }
        if !self.entry_point.is_empty() {
            len += 1;
        }
        if !self.runtime.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ModuleFunction", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        if !self.function_name.is_empty() {
            struct_ser.serialize_field("functionName", &self.function_name)?;
        }
        if !self.file_name.is_empty() {
            struct_ser.serialize_field("fileName", &self.file_name)?;
        }
        if !self.file_key.is_empty() {
            struct_ser.serialize_field("fileKey", &self.file_key)?;
        }
        if !self.entry_point.is_empty() {
            struct_ser.serialize_field("entryPoint", &self.entry_point)?;
        }
        if !self.runtime.is_empty() {
            struct_ser.serialize_field("runtime", &self.runtime)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ModuleFunction {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "module_id",
            "moduleId",
            "function_name",
            "functionName",
            "file_name",
            "fileName",
            "file_key",
            "fileKey",
            "entry_point",
            "entryPoint",
            "runtime",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            ModuleId,
            FunctionName,
            FileName,
            FileKey,
            EntryPoint,
            Runtime,
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
                            "functionName" | "function_name" => Ok(GeneratedField::FunctionName),
                            "fileName" | "file_name" => Ok(GeneratedField::FileName),
                            "fileKey" | "file_key" => Ok(GeneratedField::FileKey),
                            "entryPoint" | "entry_point" => Ok(GeneratedField::EntryPoint),
                            "runtime" => Ok(GeneratedField::Runtime),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ModuleFunction;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ModuleFunction")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ModuleFunction, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut module_id__ = None;
                let mut function_name__ = None;
                let mut file_name__ = None;
                let mut file_key__ = None;
                let mut entry_point__ = None;
                let mut runtime__ = None;
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
                        GeneratedField::FunctionName => {
                            if function_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("functionName"));
                            }
                            function_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::FileName => {
                            if file_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("fileName"));
                            }
                            file_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::FileKey => {
                            if file_key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("fileKey"));
                            }
                            file_key__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EntryPoint => {
                            if entry_point__.is_some() {
                                return Err(serde::de::Error::duplicate_field("entryPoint"));
                            }
                            entry_point__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Runtime => {
                            if runtime__.is_some() {
                                return Err(serde::de::Error::duplicate_field("runtime"));
                            }
                            runtime__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ModuleFunction {
                    id: id__.unwrap_or_default(),
                    module_id: module_id__.unwrap_or_default(),
                    function_name: function_name__.unwrap_or_default(),
                    file_name: file_name__.unwrap_or_default(),
                    file_key: file_key__.unwrap_or_default(),
                    entry_point: entry_point__.unwrap_or_default(),
                    runtime: runtime__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.ModuleFunction", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ModuleResponse {
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
        if self.module.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ModuleResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.module.as_ref() {
            struct_ser.serialize_field("module", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ModuleResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "module",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Module,
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
                            "module" => Ok(GeneratedField::Module),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ModuleResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ModuleResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ModuleResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut module__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Module => {
                            if module__.is_some() {
                                return Err(serde::de::Error::duplicate_field("module"));
                            }
                            module__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ModuleResponse {
                    status: status__,
                    module: module__,
                })
            }
        }
        deserializer.deserialize_struct("module.ModuleResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ModuleTrigger {
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
        if !self.module_name.is_empty() {
            len += 1;
        }
        if !self.category.is_empty() {
            len += 1;
        }
        if !self.name.is_empty() {
            len += 1;
        }
        if !self.description.is_empty() {
            len += 1;
        }
        if !self.event.is_empty() {
            len += 1;
        }
        if !self.config_schema.is_empty() {
            len += 1;
        }
        if self.allow_variants {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ModuleTrigger", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        if !self.module_name.is_empty() {
            struct_ser.serialize_field("moduleName", &self.module_name)?;
        }
        if !self.category.is_empty() {
            struct_ser.serialize_field("category", &self.category)?;
        }
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.event.is_empty() {
            struct_ser.serialize_field("event", &self.event)?;
        }
        if !self.config_schema.is_empty() {
            struct_ser.serialize_field("configSchema", &self.config_schema)?;
        }
        if self.allow_variants {
            struct_ser.serialize_field("allowVariants", &self.allow_variants)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ModuleTrigger {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "module_id",
            "moduleId",
            "module_name",
            "moduleName",
            "category",
            "name",
            "description",
            "event",
            "config_schema",
            "configSchema",
            "allow_variants",
            "allowVariants",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            ModuleId,
            ModuleName,
            Category,
            Name,
            Description,
            Event,
            ConfigSchema,
            AllowVariants,
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
                            "moduleName" | "module_name" => Ok(GeneratedField::ModuleName),
                            "category" => Ok(GeneratedField::Category),
                            "name" => Ok(GeneratedField::Name),
                            "description" => Ok(GeneratedField::Description),
                            "event" => Ok(GeneratedField::Event),
                            "configSchema" | "config_schema" => Ok(GeneratedField::ConfigSchema),
                            "allowVariants" | "allow_variants" => Ok(GeneratedField::AllowVariants),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ModuleTrigger;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ModuleTrigger")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ModuleTrigger, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut module_id__ = None;
                let mut module_name__ = None;
                let mut category__ = None;
                let mut name__ = None;
                let mut description__ = None;
                let mut event__ = None;
                let mut config_schema__ = None;
                let mut allow_variants__ = None;
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
                        GeneratedField::ModuleName => {
                            if module_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleName"));
                            }
                            module_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Category => {
                            if category__.is_some() {
                                return Err(serde::de::Error::duplicate_field("category"));
                            }
                            category__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Name => {
                            if name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("name"));
                            }
                            name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Description => {
                            if description__.is_some() {
                                return Err(serde::de::Error::duplicate_field("description"));
                            }
                            description__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Event => {
                            if event__.is_some() {
                                return Err(serde::de::Error::duplicate_field("event"));
                            }
                            event__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ConfigSchema => {
                            if config_schema__.is_some() {
                                return Err(serde::de::Error::duplicate_field("configSchema"));
                            }
                            config_schema__ = Some(map_.next_value()?);
                        }
                        GeneratedField::AllowVariants => {
                            if allow_variants__.is_some() {
                                return Err(serde::de::Error::duplicate_field("allowVariants"));
                            }
                            allow_variants__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ModuleTrigger {
                    id: id__.unwrap_or_default(),
                    module_id: module_id__.unwrap_or_default(),
                    module_name: module_name__.unwrap_or_default(),
                    category: category__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    event: event__.unwrap_or_default(),
                    config_schema: config_schema__.unwrap_or_default(),
                    allow_variants: allow_variants__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.ModuleTrigger", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ModuleTriggerResponse {
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
        if self.trigger.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ModuleTriggerResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.trigger.as_ref() {
            struct_ser.serialize_field("trigger", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ModuleTriggerResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "trigger",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Trigger,
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
                            "trigger" => Ok(GeneratedField::Trigger),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ModuleTriggerResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ModuleTriggerResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ModuleTriggerResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut trigger__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Trigger => {
                            if trigger__.is_some() {
                                return Err(serde::de::Error::duplicate_field("trigger"));
                            }
                            trigger__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ModuleTriggerResponse {
                    status: status__,
                    trigger: trigger__,
                })
            }
        }
        deserializer.deserialize_struct("module.ModuleTriggerResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RegisterTriggerRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.module_name.is_empty() {
            len += 1;
        }
        if !self.category.is_empty() {
            len += 1;
        }
        if !self.name.is_empty() {
            len += 1;
        }
        if !self.description.is_empty() {
            len += 1;
        }
        if !self.event.is_empty() {
            len += 1;
        }
        if !self.config_schema.is_empty() {
            len += 1;
        }
        if self.allow_variants {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.RegisterTriggerRequest", len)?;
        if !self.module_name.is_empty() {
            struct_ser.serialize_field("moduleName", &self.module_name)?;
        }
        if !self.category.is_empty() {
            struct_ser.serialize_field("category", &self.category)?;
        }
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.event.is_empty() {
            struct_ser.serialize_field("event", &self.event)?;
        }
        if !self.config_schema.is_empty() {
            struct_ser.serialize_field("configSchema", &self.config_schema)?;
        }
        if self.allow_variants {
            struct_ser.serialize_field("allowVariants", &self.allow_variants)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RegisterTriggerRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "module_name",
            "moduleName",
            "category",
            "name",
            "description",
            "event",
            "config_schema",
            "configSchema",
            "allow_variants",
            "allowVariants",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ModuleName,
            Category,
            Name,
            Description,
            Event,
            ConfigSchema,
            AllowVariants,
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
                            "moduleName" | "module_name" => Ok(GeneratedField::ModuleName),
                            "category" => Ok(GeneratedField::Category),
                            "name" => Ok(GeneratedField::Name),
                            "description" => Ok(GeneratedField::Description),
                            "event" => Ok(GeneratedField::Event),
                            "configSchema" | "config_schema" => Ok(GeneratedField::ConfigSchema),
                            "allowVariants" | "allow_variants" => Ok(GeneratedField::AllowVariants),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RegisterTriggerRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.RegisterTriggerRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RegisterTriggerRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut module_name__ = None;
                let mut category__ = None;
                let mut name__ = None;
                let mut description__ = None;
                let mut event__ = None;
                let mut config_schema__ = None;
                let mut allow_variants__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ModuleName => {
                            if module_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleName"));
                            }
                            module_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Category => {
                            if category__.is_some() {
                                return Err(serde::de::Error::duplicate_field("category"));
                            }
                            category__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Name => {
                            if name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("name"));
                            }
                            name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Description => {
                            if description__.is_some() {
                                return Err(serde::de::Error::duplicate_field("description"));
                            }
                            description__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Event => {
                            if event__.is_some() {
                                return Err(serde::de::Error::duplicate_field("event"));
                            }
                            event__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ConfigSchema => {
                            if config_schema__.is_some() {
                                return Err(serde::de::Error::duplicate_field("configSchema"));
                            }
                            config_schema__ = Some(map_.next_value()?);
                        }
                        GeneratedField::AllowVariants => {
                            if allow_variants__.is_some() {
                                return Err(serde::de::Error::duplicate_field("allowVariants"));
                            }
                            allow_variants__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RegisterTriggerRequest {
                    module_name: module_name__.unwrap_or_default(),
                    category: category__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    event: event__.unwrap_or_default(),
                    config_schema: config_schema__.unwrap_or_default(),
                    allow_variants: allow_variants__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.RegisterTriggerRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SetModuleStateRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.name.is_empty() {
            len += 1;
        }
        if !self.state.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.SetModuleStateRequest", len)?;
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.state.is_empty() {
            struct_ser.serialize_field("state", &self.state)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SetModuleStateRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "name",
            "state",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Name,
            State,
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
                            "name" => Ok(GeneratedField::Name),
                            "state" => Ok(GeneratedField::State),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = SetModuleStateRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.SetModuleStateRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SetModuleStateRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut name__ = None;
                let mut state__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Name => {
                            if name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("name"));
                            }
                            name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::State => {
                            if state__.is_some() {
                                return Err(serde::de::Error::duplicate_field("state"));
                            }
                            state__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(SetModuleStateRequest {
                    name: name__.unwrap_or_default(),
                    state: state__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.SetModuleStateRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for UpdateModuleRequest {
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
        if !self.version.is_empty() {
            len += 1;
        }
        if !self.manifest.is_empty() {
            len += 1;
        }
        if !self.archive_key.is_empty() {
            len += 1;
        }
        if !self.functions.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.UpdateModuleRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.version.is_empty() {
            struct_ser.serialize_field("version", &self.version)?;
        }
        if !self.manifest.is_empty() {
            struct_ser.serialize_field("manifest", &self.manifest)?;
        }
        if !self.archive_key.is_empty() {
            struct_ser.serialize_field("archiveKey", &self.archive_key)?;
        }
        if !self.functions.is_empty() {
            struct_ser.serialize_field("functions", &self.functions)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for UpdateModuleRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "version",
            "manifest",
            "archive_key",
            "archiveKey",
            "functions",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Version,
            Manifest,
            ArchiveKey,
            Functions,
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
                            "version" => Ok(GeneratedField::Version),
                            "manifest" => Ok(GeneratedField::Manifest),
                            "archiveKey" | "archive_key" => Ok(GeneratedField::ArchiveKey),
                            "functions" => Ok(GeneratedField::Functions),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = UpdateModuleRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.UpdateModuleRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<UpdateModuleRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut version__ = None;
                let mut manifest__ = None;
                let mut archive_key__ = None;
                let mut functions__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Version => {
                            if version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("version"));
                            }
                            version__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Manifest => {
                            if manifest__.is_some() {
                                return Err(serde::de::Error::duplicate_field("manifest"));
                            }
                            manifest__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ArchiveKey => {
                            if archive_key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("archiveKey"));
                            }
                            archive_key__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Functions => {
                            if functions__.is_some() {
                                return Err(serde::de::Error::duplicate_field("functions"));
                            }
                            functions__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(UpdateModuleRequest {
                    id: id__.unwrap_or_default(),
                    version: version__.unwrap_or_default(),
                    manifest: manifest__.unwrap_or_default(),
                    archive_key: archive_key__.unwrap_or_default(),
                    functions: functions__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.UpdateModuleRequest", FIELDS, GeneratedVisitor)
    }
}
