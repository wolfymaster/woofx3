// @generated
impl serde::Serialize for Action {
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
        if !self.description.is_empty() {
            len += 1;
        }
        if !self.call.is_empty() {
            len += 1;
        }
        if !self.params_schema.is_empty() {
            len += 1;
        }
        if !self.created_by_type.is_empty() {
            len += 1;
        }
        if !self.created_by_ref.is_empty() {
            len += 1;
        }
        if !self.manifest_id.is_empty() {
            len += 1;
        }
        if !self.r#type.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.Action", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.call.is_empty() {
            struct_ser.serialize_field("call", &self.call)?;
        }
        if !self.params_schema.is_empty() {
            struct_ser.serialize_field("paramsSchema", &self.params_schema)?;
        }
        if !self.created_by_type.is_empty() {
            struct_ser.serialize_field("createdByType", &self.created_by_type)?;
        }
        if !self.created_by_ref.is_empty() {
            struct_ser.serialize_field("createdByRef", &self.created_by_ref)?;
        }
        if !self.manifest_id.is_empty() {
            struct_ser.serialize_field("manifestId", &self.manifest_id)?;
        }
        if !self.r#type.is_empty() {
            struct_ser.serialize_field("type", &self.r#type)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Action {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "name",
            "description",
            "call",
            "params_schema",
            "paramsSchema",
            "created_by_type",
            "createdByType",
            "created_by_ref",
            "createdByRef",
            "manifest_id",
            "manifestId",
            "type",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Name,
            Description,
            Call,
            ParamsSchema,
            CreatedByType,
            CreatedByRef,
            ManifestId,
            Type,
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
                            "description" => Ok(GeneratedField::Description),
                            "call" => Ok(GeneratedField::Call),
                            "paramsSchema" | "params_schema" => Ok(GeneratedField::ParamsSchema),
                            "createdByType" | "created_by_type" => Ok(GeneratedField::CreatedByType),
                            "createdByRef" | "created_by_ref" => Ok(GeneratedField::CreatedByRef),
                            "manifestId" | "manifest_id" => Ok(GeneratedField::ManifestId),
                            "type" => Ok(GeneratedField::Type),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = Action;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.Action")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Action, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut name__ = None;
                let mut description__ = None;
                let mut call__ = None;
                let mut params_schema__ = None;
                let mut created_by_type__ = None;
                let mut created_by_ref__ = None;
                let mut manifest_id__ = None;
                let mut r#type__ = None;
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
                        GeneratedField::Description => {
                            if description__.is_some() {
                                return Err(serde::de::Error::duplicate_field("description"));
                            }
                            description__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Call => {
                            if call__.is_some() {
                                return Err(serde::de::Error::duplicate_field("call"));
                            }
                            call__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ParamsSchema => {
                            if params_schema__.is_some() {
                                return Err(serde::de::Error::duplicate_field("paramsSchema"));
                            }
                            params_schema__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByType => {
                            if created_by_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByType"));
                            }
                            created_by_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByRef => {
                            if created_by_ref__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByRef"));
                            }
                            created_by_ref__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ManifestId => {
                            if manifest_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("manifestId"));
                            }
                            manifest_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Type => {
                            if r#type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("type"));
                            }
                            r#type__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(Action {
                    id: id__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    call: call__.unwrap_or_default(),
                    params_schema: params_schema__.unwrap_or_default(),
                    created_by_type: created_by_type__.unwrap_or_default(),
                    created_by_ref: created_by_ref__.unwrap_or_default(),
                    manifest_id: manifest_id__.unwrap_or_default(),
                    r#type: r#type__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.Action", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ActionInput {
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
        if !self.description.is_empty() {
            len += 1;
        }
        if !self.call.is_empty() {
            len += 1;
        }
        if !self.params_schema.is_empty() {
            len += 1;
        }
        if !self.manifest_id.is_empty() {
            len += 1;
        }
        if !self.r#type.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ActionInput", len)?;
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.call.is_empty() {
            struct_ser.serialize_field("call", &self.call)?;
        }
        if !self.params_schema.is_empty() {
            struct_ser.serialize_field("paramsSchema", &self.params_schema)?;
        }
        if !self.manifest_id.is_empty() {
            struct_ser.serialize_field("manifestId", &self.manifest_id)?;
        }
        if !self.r#type.is_empty() {
            struct_ser.serialize_field("type", &self.r#type)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ActionInput {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "name",
            "description",
            "call",
            "params_schema",
            "paramsSchema",
            "manifest_id",
            "manifestId",
            "type",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Name,
            Description,
            Call,
            ParamsSchema,
            ManifestId,
            Type,
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
                            "description" => Ok(GeneratedField::Description),
                            "call" => Ok(GeneratedField::Call),
                            "paramsSchema" | "params_schema" => Ok(GeneratedField::ParamsSchema),
                            "manifestId" | "manifest_id" => Ok(GeneratedField::ManifestId),
                            "type" => Ok(GeneratedField::Type),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ActionInput;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ActionInput")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ActionInput, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut name__ = None;
                let mut description__ = None;
                let mut call__ = None;
                let mut params_schema__ = None;
                let mut manifest_id__ = None;
                let mut r#type__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
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
                        GeneratedField::Call => {
                            if call__.is_some() {
                                return Err(serde::de::Error::duplicate_field("call"));
                            }
                            call__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ParamsSchema => {
                            if params_schema__.is_some() {
                                return Err(serde::de::Error::duplicate_field("paramsSchema"));
                            }
                            params_schema__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ManifestId => {
                            if manifest_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("manifestId"));
                            }
                            manifest_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Type => {
                            if r#type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("type"));
                            }
                            r#type__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ActionInput {
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    call: call__.unwrap_or_default(),
                    params_schema: params_schema__.unwrap_or_default(),
                    manifest_id: manifest_id__.unwrap_or_default(),
                    r#type: r#type__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.ActionInput", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ActionResponse {
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
        if self.action.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ActionResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.action.as_ref() {
            struct_ser.serialize_field("action", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ActionResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "action",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Action,
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
                            "action" => Ok(GeneratedField::Action),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ActionResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ActionResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ActionResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut action__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Action => {
                            if action__.is_some() {
                                return Err(serde::de::Error::duplicate_field("action"));
                            }
                            action__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ActionResponse {
                    status: status__,
                    action: action__,
                })
            }
        }
        deserializer.deserialize_struct("module.ActionResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for Asset {
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
        if !self.manifest_id.is_empty() {
            len += 1;
        }
        if !self.name.is_empty() {
            len += 1;
        }
        if !self.description.is_empty() {
            len += 1;
        }
        if !self.manifest_path.is_empty() {
            len += 1;
        }
        if !self.repository_key.is_empty() {
            len += 1;
        }
        if !self.kind.is_empty() {
            len += 1;
        }
        if !self.content_type.is_empty() {
            len += 1;
        }
        if !self.created_by_type.is_empty() {
            len += 1;
        }
        if !self.created_by_ref.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.Asset", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        if !self.manifest_id.is_empty() {
            struct_ser.serialize_field("manifestId", &self.manifest_id)?;
        }
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.manifest_path.is_empty() {
            struct_ser.serialize_field("manifestPath", &self.manifest_path)?;
        }
        if !self.repository_key.is_empty() {
            struct_ser.serialize_field("repositoryKey", &self.repository_key)?;
        }
        if !self.kind.is_empty() {
            struct_ser.serialize_field("kind", &self.kind)?;
        }
        if !self.content_type.is_empty() {
            struct_ser.serialize_field("contentType", &self.content_type)?;
        }
        if !self.created_by_type.is_empty() {
            struct_ser.serialize_field("createdByType", &self.created_by_type)?;
        }
        if !self.created_by_ref.is_empty() {
            struct_ser.serialize_field("createdByRef", &self.created_by_ref)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Asset {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "module_id",
            "moduleId",
            "manifest_id",
            "manifestId",
            "name",
            "description",
            "manifest_path",
            "manifestPath",
            "repository_key",
            "repositoryKey",
            "kind",
            "content_type",
            "contentType",
            "created_by_type",
            "createdByType",
            "created_by_ref",
            "createdByRef",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            ModuleId,
            ManifestId,
            Name,
            Description,
            ManifestPath,
            RepositoryKey,
            Kind,
            ContentType,
            CreatedByType,
            CreatedByRef,
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
                            "manifestId" | "manifest_id" => Ok(GeneratedField::ManifestId),
                            "name" => Ok(GeneratedField::Name),
                            "description" => Ok(GeneratedField::Description),
                            "manifestPath" | "manifest_path" => Ok(GeneratedField::ManifestPath),
                            "repositoryKey" | "repository_key" => Ok(GeneratedField::RepositoryKey),
                            "kind" => Ok(GeneratedField::Kind),
                            "contentType" | "content_type" => Ok(GeneratedField::ContentType),
                            "createdByType" | "created_by_type" => Ok(GeneratedField::CreatedByType),
                            "createdByRef" | "created_by_ref" => Ok(GeneratedField::CreatedByRef),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = Asset;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.Asset")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Asset, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut module_id__ = None;
                let mut manifest_id__ = None;
                let mut name__ = None;
                let mut description__ = None;
                let mut manifest_path__ = None;
                let mut repository_key__ = None;
                let mut kind__ = None;
                let mut content_type__ = None;
                let mut created_by_type__ = None;
                let mut created_by_ref__ = None;
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
                        GeneratedField::ManifestId => {
                            if manifest_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("manifestId"));
                            }
                            manifest_id__ = Some(map_.next_value()?);
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
                        GeneratedField::ManifestPath => {
                            if manifest_path__.is_some() {
                                return Err(serde::de::Error::duplicate_field("manifestPath"));
                            }
                            manifest_path__ = Some(map_.next_value()?);
                        }
                        GeneratedField::RepositoryKey => {
                            if repository_key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("repositoryKey"));
                            }
                            repository_key__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Kind => {
                            if kind__.is_some() {
                                return Err(serde::de::Error::duplicate_field("kind"));
                            }
                            kind__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ContentType => {
                            if content_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("contentType"));
                            }
                            content_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByType => {
                            if created_by_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByType"));
                            }
                            created_by_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByRef => {
                            if created_by_ref__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByRef"));
                            }
                            created_by_ref__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(Asset {
                    id: id__.unwrap_or_default(),
                    module_id: module_id__.unwrap_or_default(),
                    manifest_id: manifest_id__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    manifest_path: manifest_path__.unwrap_or_default(),
                    repository_key: repository_key__.unwrap_or_default(),
                    kind: kind__.unwrap_or_default(),
                    content_type: content_type__.unwrap_or_default(),
                    created_by_type: created_by_type__.unwrap_or_default(),
                    created_by_ref: created_by_ref__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.Asset", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for AssetInput {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.manifest_id.is_empty() {
            len += 1;
        }
        if !self.name.is_empty() {
            len += 1;
        }
        if !self.description.is_empty() {
            len += 1;
        }
        if !self.manifest_path.is_empty() {
            len += 1;
        }
        if !self.repository_key.is_empty() {
            len += 1;
        }
        if !self.kind.is_empty() {
            len += 1;
        }
        if !self.content_type.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.AssetInput", len)?;
        if !self.manifest_id.is_empty() {
            struct_ser.serialize_field("manifestId", &self.manifest_id)?;
        }
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.manifest_path.is_empty() {
            struct_ser.serialize_field("manifestPath", &self.manifest_path)?;
        }
        if !self.repository_key.is_empty() {
            struct_ser.serialize_field("repositoryKey", &self.repository_key)?;
        }
        if !self.kind.is_empty() {
            struct_ser.serialize_field("kind", &self.kind)?;
        }
        if !self.content_type.is_empty() {
            struct_ser.serialize_field("contentType", &self.content_type)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for AssetInput {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "manifest_id",
            "manifestId",
            "name",
            "description",
            "manifest_path",
            "manifestPath",
            "repository_key",
            "repositoryKey",
            "kind",
            "content_type",
            "contentType",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ManifestId,
            Name,
            Description,
            ManifestPath,
            RepositoryKey,
            Kind,
            ContentType,
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
                            "manifestId" | "manifest_id" => Ok(GeneratedField::ManifestId),
                            "name" => Ok(GeneratedField::Name),
                            "description" => Ok(GeneratedField::Description),
                            "manifestPath" | "manifest_path" => Ok(GeneratedField::ManifestPath),
                            "repositoryKey" | "repository_key" => Ok(GeneratedField::RepositoryKey),
                            "kind" => Ok(GeneratedField::Kind),
                            "contentType" | "content_type" => Ok(GeneratedField::ContentType),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = AssetInput;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.AssetInput")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<AssetInput, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut manifest_id__ = None;
                let mut name__ = None;
                let mut description__ = None;
                let mut manifest_path__ = None;
                let mut repository_key__ = None;
                let mut kind__ = None;
                let mut content_type__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ManifestId => {
                            if manifest_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("manifestId"));
                            }
                            manifest_id__ = Some(map_.next_value()?);
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
                        GeneratedField::ManifestPath => {
                            if manifest_path__.is_some() {
                                return Err(serde::de::Error::duplicate_field("manifestPath"));
                            }
                            manifest_path__ = Some(map_.next_value()?);
                        }
                        GeneratedField::RepositoryKey => {
                            if repository_key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("repositoryKey"));
                            }
                            repository_key__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Kind => {
                            if kind__.is_some() {
                                return Err(serde::de::Error::duplicate_field("kind"));
                            }
                            kind__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ContentType => {
                            if content_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("contentType"));
                            }
                            content_type__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(AssetInput {
                    manifest_id: manifest_id__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    manifest_path: manifest_path__.unwrap_or_default(),
                    repository_key: repository_key__.unwrap_or_default(),
                    kind: kind__.unwrap_or_default(),
                    content_type: content_type__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.AssetInput", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for AssetResponse {
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
        if self.asset.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.AssetResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.asset.as_ref() {
            struct_ser.serialize_field("asset", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for AssetResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "asset",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Asset,
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
                            "asset" => Ok(GeneratedField::Asset),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = AssetResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.AssetResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<AssetResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut asset__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Asset => {
                            if asset__.is_some() {
                                return Err(serde::de::Error::duplicate_field("asset"));
                            }
                            asset__ = map_.next_value()?;
                        }
                    }
                }
                Ok(AssetResponse {
                    status: status__,
                    asset: asset__,
                })
            }
        }
        deserializer.deserialize_struct("module.AssetResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for CheckModuleResourceUsageRequest {
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
        if !self.application_id.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.CheckModuleResourceUsageRequest", len)?;
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CheckModuleResourceUsageRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "module_id",
            "moduleId",
            "application_id",
            "applicationId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ModuleId,
            ApplicationId,
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
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CheckModuleResourceUsageRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.CheckModuleResourceUsageRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CheckModuleResourceUsageRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut module_id__ = None;
                let mut application_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ModuleId => {
                            if module_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleId"));
                            }
                            module_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(CheckModuleResourceUsageRequest {
                    module_id: module_id__.unwrap_or_default(),
                    application_id: application_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.CheckModuleResourceUsageRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for CheckModuleResourceUsageResponse {
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
        if !self.in_use.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.CheckModuleResourceUsageResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.in_use.is_empty() {
            struct_ser.serialize_field("inUse", &self.in_use)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CheckModuleResourceUsageResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "in_use",
            "inUse",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            InUse,
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
                            "inUse" | "in_use" => Ok(GeneratedField::InUse),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CheckModuleResourceUsageResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.CheckModuleResourceUsageResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CheckModuleResourceUsageResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut in_use__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::InUse => {
                            if in_use__.is_some() {
                                return Err(serde::de::Error::duplicate_field("inUse"));
                            }
                            in_use__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(CheckModuleResourceUsageResponse {
                    status: status__,
                    in_use: in_use__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.CheckModuleResourceUsageResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for CompleteModuleDeleteRequest {
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
        if !self.module_name.is_empty() {
            len += 1;
        }
        if !self.status.is_empty() {
            len += 1;
        }
        if !self.error.is_empty() {
            len += 1;
        }
        if !self.in_use_resources.is_empty() {
            len += 1;
        }
        if self.request_context.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.CompleteModuleDeleteRequest", len)?;
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        if !self.module_name.is_empty() {
            struct_ser.serialize_field("moduleName", &self.module_name)?;
        }
        if !self.status.is_empty() {
            struct_ser.serialize_field("status", &self.status)?;
        }
        if !self.error.is_empty() {
            struct_ser.serialize_field("error", &self.error)?;
        }
        if !self.in_use_resources.is_empty() {
            struct_ser.serialize_field("inUseResources", &self.in_use_resources)?;
        }
        if let Some(v) = self.request_context.as_ref() {
            struct_ser.serialize_field("requestContext", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CompleteModuleDeleteRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "module_id",
            "moduleId",
            "module_name",
            "moduleName",
            "status",
            "error",
            "in_use_resources",
            "inUseResources",
            "request_context",
            "requestContext",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ModuleId,
            ModuleName,
            Status,
            Error,
            InUseResources,
            RequestContext,
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
                            "moduleName" | "module_name" => Ok(GeneratedField::ModuleName),
                            "status" => Ok(GeneratedField::Status),
                            "error" => Ok(GeneratedField::Error),
                            "inUseResources" | "in_use_resources" => Ok(GeneratedField::InUseResources),
                            "requestContext" | "request_context" => Ok(GeneratedField::RequestContext),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CompleteModuleDeleteRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.CompleteModuleDeleteRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CompleteModuleDeleteRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut module_id__ = None;
                let mut module_name__ = None;
                let mut status__ = None;
                let mut error__ = None;
                let mut in_use_resources__ = None;
                let mut request_context__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
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
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Error => {
                            if error__.is_some() {
                                return Err(serde::de::Error::duplicate_field("error"));
                            }
                            error__ = Some(map_.next_value()?);
                        }
                        GeneratedField::InUseResources => {
                            if in_use_resources__.is_some() {
                                return Err(serde::de::Error::duplicate_field("inUseResources"));
                            }
                            in_use_resources__ = Some(map_.next_value()?);
                        }
                        GeneratedField::RequestContext => {
                            if request_context__.is_some() {
                                return Err(serde::de::Error::duplicate_field("requestContext"));
                            }
                            request_context__ = map_.next_value()?;
                        }
                    }
                }
                Ok(CompleteModuleDeleteRequest {
                    module_id: module_id__.unwrap_or_default(),
                    module_name: module_name__.unwrap_or_default(),
                    status: status__.unwrap_or_default(),
                    error: error__.unwrap_or_default(),
                    in_use_resources: in_use_resources__.unwrap_or_default(),
                    request_context: request_context__,
                })
            }
        }
        deserializer.deserialize_struct("module.CompleteModuleDeleteRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for CompleteModuleInstallRequest {
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
        if !self.module_name.is_empty() {
            len += 1;
        }
        if !self.version.is_empty() {
            len += 1;
        }
        if !self.status.is_empty() {
            len += 1;
        }
        if !self.error.is_empty() {
            len += 1;
        }
        if self.request_context.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.CompleteModuleInstallRequest", len)?;
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        if !self.module_name.is_empty() {
            struct_ser.serialize_field("moduleName", &self.module_name)?;
        }
        if !self.version.is_empty() {
            struct_ser.serialize_field("version", &self.version)?;
        }
        if !self.status.is_empty() {
            struct_ser.serialize_field("status", &self.status)?;
        }
        if !self.error.is_empty() {
            struct_ser.serialize_field("error", &self.error)?;
        }
        if let Some(v) = self.request_context.as_ref() {
            struct_ser.serialize_field("requestContext", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CompleteModuleInstallRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "module_id",
            "moduleId",
            "module_name",
            "moduleName",
            "version",
            "status",
            "error",
            "request_context",
            "requestContext",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ModuleId,
            ModuleName,
            Version,
            Status,
            Error,
            RequestContext,
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
                            "moduleName" | "module_name" => Ok(GeneratedField::ModuleName),
                            "version" => Ok(GeneratedField::Version),
                            "status" => Ok(GeneratedField::Status),
                            "error" => Ok(GeneratedField::Error),
                            "requestContext" | "request_context" => Ok(GeneratedField::RequestContext),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CompleteModuleInstallRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.CompleteModuleInstallRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CompleteModuleInstallRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut module_id__ = None;
                let mut module_name__ = None;
                let mut version__ = None;
                let mut status__ = None;
                let mut error__ = None;
                let mut request_context__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
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
                        GeneratedField::Version => {
                            if version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("version"));
                            }
                            version__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Error => {
                            if error__.is_some() {
                                return Err(serde::de::Error::duplicate_field("error"));
                            }
                            error__ = Some(map_.next_value()?);
                        }
                        GeneratedField::RequestContext => {
                            if request_context__.is_some() {
                                return Err(serde::de::Error::duplicate_field("requestContext"));
                            }
                            request_context__ = map_.next_value()?;
                        }
                    }
                }
                Ok(CompleteModuleInstallRequest {
                    module_id: module_id__.unwrap_or_default(),
                    module_name: module_name__.unwrap_or_default(),
                    version: version__.unwrap_or_default(),
                    status: status__.unwrap_or_default(),
                    error: error__.unwrap_or_default(),
                    request_context: request_context__,
                })
            }
        }
        deserializer.deserialize_struct("module.CompleteModuleInstallRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for CreateModuleFunctionRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.manifest_id.is_empty() {
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
        if !self.name.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.CreateModuleFunctionRequest", len)?;
        if !self.manifest_id.is_empty() {
            struct_ser.serialize_field("manifestId", &self.manifest_id)?;
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
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
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
            "manifest_id",
            "manifestId",
            "file_name",
            "fileName",
            "file_key",
            "fileKey",
            "entry_point",
            "entryPoint",
            "runtime",
            "name",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ManifestId,
            FileName,
            FileKey,
            EntryPoint,
            Runtime,
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
                            "manifestId" | "manifest_id" => Ok(GeneratedField::ManifestId),
                            "fileName" | "file_name" => Ok(GeneratedField::FileName),
                            "fileKey" | "file_key" => Ok(GeneratedField::FileKey),
                            "entryPoint" | "entry_point" => Ok(GeneratedField::EntryPoint),
                            "runtime" => Ok(GeneratedField::Runtime),
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
            type Value = CreateModuleFunctionRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.CreateModuleFunctionRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CreateModuleFunctionRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut manifest_id__ = None;
                let mut file_name__ = None;
                let mut file_key__ = None;
                let mut entry_point__ = None;
                let mut runtime__ = None;
                let mut name__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ManifestId => {
                            if manifest_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("manifestId"));
                            }
                            manifest_id__ = Some(map_.next_value()?);
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
                        GeneratedField::Name => {
                            if name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("name"));
                            }
                            name__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(CreateModuleFunctionRequest {
                    manifest_id: manifest_id__.unwrap_or_default(),
                    file_name: file_name__.unwrap_or_default(),
                    file_key: file_key__.unwrap_or_default(),
                    entry_point: entry_point__.unwrap_or_default(),
                    runtime: runtime__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
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
        if !self.created_by_type.is_empty() {
            len += 1;
        }
        if !self.created_by_ref.is_empty() {
            len += 1;
        }
        if !self.module_key.is_empty() {
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
        if !self.created_by_type.is_empty() {
            struct_ser.serialize_field("createdByType", &self.created_by_type)?;
        }
        if !self.created_by_ref.is_empty() {
            struct_ser.serialize_field("createdByRef", &self.created_by_ref)?;
        }
        if !self.module_key.is_empty() {
            struct_ser.serialize_field("moduleKey", &self.module_key)?;
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
            "created_by_type",
            "createdByType",
            "created_by_ref",
            "createdByRef",
            "module_key",
            "moduleKey",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Name,
            Version,
            Manifest,
            ArchiveKey,
            Functions,
            CreatedByType,
            CreatedByRef,
            ModuleKey,
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
                            "createdByType" | "created_by_type" => Ok(GeneratedField::CreatedByType),
                            "createdByRef" | "created_by_ref" => Ok(GeneratedField::CreatedByRef),
                            "moduleKey" | "module_key" => Ok(GeneratedField::ModuleKey),
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
                let mut created_by_type__ = None;
                let mut created_by_ref__ = None;
                let mut module_key__ = None;
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
                        GeneratedField::CreatedByType => {
                            if created_by_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByType"));
                            }
                            created_by_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByRef => {
                            if created_by_ref__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByRef"));
                            }
                            created_by_ref__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ModuleKey => {
                            if module_key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleKey"));
                            }
                            module_key__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(CreateModuleRequest {
                    name: name__.unwrap_or_default(),
                    version: version__.unwrap_or_default(),
                    manifest: manifest__.unwrap_or_default(),
                    archive_key: archive_key__.unwrap_or_default(),
                    functions: functions__.unwrap_or_default(),
                    created_by_type: created_by_type__.unwrap_or_default(),
                    created_by_ref: created_by_ref__.unwrap_or_default(),
                    module_key: module_key__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.CreateModuleRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for CreateModuleResourceRequest {
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
        if !self.resource_type.is_empty() {
            len += 1;
        }
        if !self.resource_id.is_empty() {
            len += 1;
        }
        if !self.manifest_id.is_empty() {
            len += 1;
        }
        if !self.resource_name.is_empty() {
            len += 1;
        }
        if !self.version.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.CreateModuleResourceRequest", len)?;
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        if !self.resource_type.is_empty() {
            struct_ser.serialize_field("resourceType", &self.resource_type)?;
        }
        if !self.resource_id.is_empty() {
            struct_ser.serialize_field("resourceId", &self.resource_id)?;
        }
        if !self.manifest_id.is_empty() {
            struct_ser.serialize_field("manifestId", &self.manifest_id)?;
        }
        if !self.resource_name.is_empty() {
            struct_ser.serialize_field("resourceName", &self.resource_name)?;
        }
        if !self.version.is_empty() {
            struct_ser.serialize_field("version", &self.version)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CreateModuleResourceRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "module_id",
            "moduleId",
            "resource_type",
            "resourceType",
            "resource_id",
            "resourceId",
            "manifest_id",
            "manifestId",
            "resource_name",
            "resourceName",
            "version",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ModuleId,
            ResourceType,
            ResourceId,
            ManifestId,
            ResourceName,
            Version,
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
                            "resourceType" | "resource_type" => Ok(GeneratedField::ResourceType),
                            "resourceId" | "resource_id" => Ok(GeneratedField::ResourceId),
                            "manifestId" | "manifest_id" => Ok(GeneratedField::ManifestId),
                            "resourceName" | "resource_name" => Ok(GeneratedField::ResourceName),
                            "version" => Ok(GeneratedField::Version),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CreateModuleResourceRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.CreateModuleResourceRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CreateModuleResourceRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut module_id__ = None;
                let mut resource_type__ = None;
                let mut resource_id__ = None;
                let mut manifest_id__ = None;
                let mut resource_name__ = None;
                let mut version__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ModuleId => {
                            if module_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleId"));
                            }
                            module_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ResourceType => {
                            if resource_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("resourceType"));
                            }
                            resource_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ResourceId => {
                            if resource_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("resourceId"));
                            }
                            resource_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ManifestId => {
                            if manifest_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("manifestId"));
                            }
                            manifest_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ResourceName => {
                            if resource_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("resourceName"));
                            }
                            resource_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Version => {
                            if version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("version"));
                            }
                            version__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(CreateModuleResourceRequest {
                    module_id: module_id__.unwrap_or_default(),
                    resource_type: resource_type__.unwrap_or_default(),
                    resource_id: resource_id__.unwrap_or_default(),
                    manifest_id: manifest_id__.unwrap_or_default(),
                    resource_name: resource_name__.unwrap_or_default(),
                    version: version__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.CreateModuleResourceRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for CreateResourceInstanceRequest {
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
        if !self.kind.is_empty() {
            len += 1;
        }
        if !self.instance_id.is_empty() {
            len += 1;
        }
        if !self.display_name.is_empty() {
            len += 1;
        }
        if self.request_context.is_some() {
            len += 1;
        }
        if !self.module_name.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.CreateResourceInstanceRequest", len)?;
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        if !self.kind.is_empty() {
            struct_ser.serialize_field("kind", &self.kind)?;
        }
        if !self.instance_id.is_empty() {
            struct_ser.serialize_field("instanceId", &self.instance_id)?;
        }
        if !self.display_name.is_empty() {
            struct_ser.serialize_field("displayName", &self.display_name)?;
        }
        if let Some(v) = self.request_context.as_ref() {
            struct_ser.serialize_field("requestContext", v)?;
        }
        if !self.module_name.is_empty() {
            struct_ser.serialize_field("moduleName", &self.module_name)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CreateResourceInstanceRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "module_id",
            "moduleId",
            "kind",
            "instance_id",
            "instanceId",
            "display_name",
            "displayName",
            "request_context",
            "requestContext",
            "module_name",
            "moduleName",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ModuleId,
            Kind,
            InstanceId,
            DisplayName,
            RequestContext,
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
                            "moduleId" | "module_id" => Ok(GeneratedField::ModuleId),
                            "kind" => Ok(GeneratedField::Kind),
                            "instanceId" | "instance_id" => Ok(GeneratedField::InstanceId),
                            "displayName" | "display_name" => Ok(GeneratedField::DisplayName),
                            "requestContext" | "request_context" => Ok(GeneratedField::RequestContext),
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
            type Value = CreateResourceInstanceRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.CreateResourceInstanceRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CreateResourceInstanceRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut module_id__ = None;
                let mut kind__ = None;
                let mut instance_id__ = None;
                let mut display_name__ = None;
                let mut request_context__ = None;
                let mut module_name__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ModuleId => {
                            if module_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleId"));
                            }
                            module_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Kind => {
                            if kind__.is_some() {
                                return Err(serde::de::Error::duplicate_field("kind"));
                            }
                            kind__ = Some(map_.next_value()?);
                        }
                        GeneratedField::InstanceId => {
                            if instance_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instanceId"));
                            }
                            instance_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DisplayName => {
                            if display_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("displayName"));
                            }
                            display_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::RequestContext => {
                            if request_context__.is_some() {
                                return Err(serde::de::Error::duplicate_field("requestContext"));
                            }
                            request_context__ = map_.next_value()?;
                        }
                        GeneratedField::ModuleName => {
                            if module_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleName"));
                            }
                            module_name__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(CreateResourceInstanceRequest {
                    module_id: module_id__.unwrap_or_default(),
                    kind: kind__.unwrap_or_default(),
                    instance_id: instance_id__.unwrap_or_default(),
                    display_name: display_name__.unwrap_or_default(),
                    request_context: request_context__,
                    module_name: module_name__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.CreateResourceInstanceRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DeleteByModuleIdRequest {
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
        let mut struct_ser = serializer.serialize_struct("module.DeleteByModuleIdRequest", len)?;
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DeleteByModuleIdRequest {
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
            type Value = DeleteByModuleIdRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.DeleteByModuleIdRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DeleteByModuleIdRequest, V::Error>
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
                Ok(DeleteByModuleIdRequest {
                    module_id: module_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.DeleteByModuleIdRequest", FIELDS, GeneratedVisitor)
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
impl serde::Serialize for DeleteModuleResourcesRequest {
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
        let mut struct_ser = serializer.serialize_struct("module.DeleteModuleResourcesRequest", len)?;
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DeleteModuleResourcesRequest {
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
            type Value = DeleteModuleResourcesRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.DeleteModuleResourcesRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DeleteModuleResourcesRequest, V::Error>
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
                Ok(DeleteModuleResourcesRequest {
                    module_id: module_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.DeleteModuleResourcesRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DeleteResourceInstanceRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.canonical_id.is_empty() {
            len += 1;
        }
        if self.request_context.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.DeleteResourceInstanceRequest", len)?;
        if !self.canonical_id.is_empty() {
            struct_ser.serialize_field("canonicalId", &self.canonical_id)?;
        }
        if let Some(v) = self.request_context.as_ref() {
            struct_ser.serialize_field("requestContext", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DeleteResourceInstanceRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "canonical_id",
            "canonicalId",
            "request_context",
            "requestContext",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            CanonicalId,
            RequestContext,
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
                            "canonicalId" | "canonical_id" => Ok(GeneratedField::CanonicalId),
                            "requestContext" | "request_context" => Ok(GeneratedField::RequestContext),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = DeleteResourceInstanceRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.DeleteResourceInstanceRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DeleteResourceInstanceRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut canonical_id__ = None;
                let mut request_context__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::CanonicalId => {
                            if canonical_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("canonicalId"));
                            }
                            canonical_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::RequestContext => {
                            if request_context__.is_some() {
                                return Err(serde::de::Error::duplicate_field("requestContext"));
                            }
                            request_context__ = map_.next_value()?;
                        }
                    }
                }
                Ok(DeleteResourceInstanceRequest {
                    canonical_id: canonical_id__.unwrap_or_default(),
                    request_context: request_context__,
                })
            }
        }
        deserializer.deserialize_struct("module.DeleteResourceInstanceRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetByCanonicalIdRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.canonical_id.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.GetByCanonicalIdRequest", len)?;
        if !self.canonical_id.is_empty() {
            struct_ser.serialize_field("canonicalId", &self.canonical_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetByCanonicalIdRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "canonical_id",
            "canonicalId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            CanonicalId,
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
                            "canonicalId" | "canonical_id" => Ok(GeneratedField::CanonicalId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetByCanonicalIdRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.GetByCanonicalIdRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetByCanonicalIdRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut canonical_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::CanonicalId => {
                            if canonical_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("canonicalId"));
                            }
                            canonical_id__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(GetByCanonicalIdRequest {
                    canonical_id: canonical_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.GetByCanonicalIdRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetModuleByModuleKeyRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.module_key.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.GetModuleByModuleKeyRequest", len)?;
        if !self.module_key.is_empty() {
            struct_ser.serialize_field("moduleKey", &self.module_key)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetModuleByModuleKeyRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "module_key",
            "moduleKey",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ModuleKey,
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
                            "moduleKey" | "module_key" => Ok(GeneratedField::ModuleKey),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetModuleByModuleKeyRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.GetModuleByModuleKeyRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetModuleByModuleKeyRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut module_key__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ModuleKey => {
                            if module_key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleKey"));
                            }
                            module_key__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(GetModuleByModuleKeyRequest {
                    module_key: module_key__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.GetModuleByModuleKeyRequest", FIELDS, GeneratedVisitor)
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
impl serde::Serialize for GetResourceInstanceRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.canonical_id.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.GetResourceInstanceRequest", len)?;
        if !self.canonical_id.is_empty() {
            struct_ser.serialize_field("canonicalId", &self.canonical_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetResourceInstanceRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "canonical_id",
            "canonicalId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            CanonicalId,
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
                            "canonicalId" | "canonical_id" => Ok(GeneratedField::CanonicalId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetResourceInstanceRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.GetResourceInstanceRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetResourceInstanceRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut canonical_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::CanonicalId => {
                            if canonical_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("canonicalId"));
                            }
                            canonical_id__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(GetResourceInstanceRequest {
                    canonical_id: canonical_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.GetResourceInstanceRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListActionsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.created_by_type.is_empty() {
            len += 1;
        }
        if !self.created_by_ref.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ListActionsRequest", len)?;
        if !self.created_by_type.is_empty() {
            struct_ser.serialize_field("createdByType", &self.created_by_type)?;
        }
        if !self.created_by_ref.is_empty() {
            struct_ser.serialize_field("createdByRef", &self.created_by_ref)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListActionsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "created_by_type",
            "createdByType",
            "created_by_ref",
            "createdByRef",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            CreatedByType,
            CreatedByRef,
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
                            "createdByType" | "created_by_type" => Ok(GeneratedField::CreatedByType),
                            "createdByRef" | "created_by_ref" => Ok(GeneratedField::CreatedByRef),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListActionsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ListActionsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListActionsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut created_by_type__ = None;
                let mut created_by_ref__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::CreatedByType => {
                            if created_by_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByType"));
                            }
                            created_by_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByRef => {
                            if created_by_ref__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByRef"));
                            }
                            created_by_ref__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListActionsRequest {
                    created_by_type: created_by_type__.unwrap_or_default(),
                    created_by_ref: created_by_ref__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.ListActionsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListActionsResponse {
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
        if !self.actions.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ListActionsResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.actions.is_empty() {
            struct_ser.serialize_field("actions", &self.actions)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListActionsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "actions",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Actions,
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
                            "actions" => Ok(GeneratedField::Actions),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListActionsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ListActionsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListActionsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut actions__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Actions => {
                            if actions__.is_some() {
                                return Err(serde::de::Error::duplicate_field("actions"));
                            }
                            actions__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListActionsResponse {
                    status: status__,
                    actions: actions__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.ListActionsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListAssetsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.created_by_type.is_empty() {
            len += 1;
        }
        if !self.created_by_ref.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ListAssetsRequest", len)?;
        if !self.created_by_type.is_empty() {
            struct_ser.serialize_field("createdByType", &self.created_by_type)?;
        }
        if !self.created_by_ref.is_empty() {
            struct_ser.serialize_field("createdByRef", &self.created_by_ref)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListAssetsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "created_by_type",
            "createdByType",
            "created_by_ref",
            "createdByRef",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            CreatedByType,
            CreatedByRef,
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
                            "createdByType" | "created_by_type" => Ok(GeneratedField::CreatedByType),
                            "createdByRef" | "created_by_ref" => Ok(GeneratedField::CreatedByRef),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListAssetsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ListAssetsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListAssetsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut created_by_type__ = None;
                let mut created_by_ref__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::CreatedByType => {
                            if created_by_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByType"));
                            }
                            created_by_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByRef => {
                            if created_by_ref__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByRef"));
                            }
                            created_by_ref__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListAssetsRequest {
                    created_by_type: created_by_type__.unwrap_or_default(),
                    created_by_ref: created_by_ref__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.ListAssetsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListAssetsResponse {
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
        if !self.assets.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ListAssetsResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.assets.is_empty() {
            struct_ser.serialize_field("assets", &self.assets)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListAssetsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "assets",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Assets,
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
                            "assets" => Ok(GeneratedField::Assets),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListAssetsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ListAssetsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListAssetsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut assets__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Assets => {
                            if assets__.is_some() {
                                return Err(serde::de::Error::duplicate_field("assets"));
                            }
                            assets__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListAssetsResponse {
                    status: status__,
                    assets: assets__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.ListAssetsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListModuleResourcesRequest {
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
        if !self.resource_type.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ListModuleResourcesRequest", len)?;
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        if !self.resource_type.is_empty() {
            struct_ser.serialize_field("resourceType", &self.resource_type)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListModuleResourcesRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "module_id",
            "moduleId",
            "resource_type",
            "resourceType",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ModuleId,
            ResourceType,
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
                            "resourceType" | "resource_type" => Ok(GeneratedField::ResourceType),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListModuleResourcesRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ListModuleResourcesRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListModuleResourcesRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut module_id__ = None;
                let mut resource_type__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ModuleId => {
                            if module_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleId"));
                            }
                            module_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ResourceType => {
                            if resource_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("resourceType"));
                            }
                            resource_type__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListModuleResourcesRequest {
                    module_id: module_id__.unwrap_or_default(),
                    resource_type: resource_type__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.ListModuleResourcesRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListModuleResourcesResponse {
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
        if !self.resources.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ListModuleResourcesResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.resources.is_empty() {
            struct_ser.serialize_field("resources", &self.resources)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListModuleResourcesResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "resources",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Resources,
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
                            "resources" => Ok(GeneratedField::Resources),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListModuleResourcesResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ListModuleResourcesResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListModuleResourcesResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut resources__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Resources => {
                            if resources__.is_some() {
                                return Err(serde::de::Error::duplicate_field("resources"));
                            }
                            resources__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListModuleResourcesResponse {
                    status: status__,
                    resources: resources__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.ListModuleResourcesResponse", FIELDS, GeneratedVisitor)
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
impl serde::Serialize for ListResourceInstancesByKindRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.kind.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ListResourceInstancesByKindRequest", len)?;
        if !self.kind.is_empty() {
            struct_ser.serialize_field("kind", &self.kind)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListResourceInstancesByKindRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "kind",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Kind,
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
                            "kind" => Ok(GeneratedField::Kind),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListResourceInstancesByKindRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ListResourceInstancesByKindRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListResourceInstancesByKindRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut kind__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Kind => {
                            if kind__.is_some() {
                                return Err(serde::de::Error::duplicate_field("kind"));
                            }
                            kind__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListResourceInstancesByKindRequest {
                    kind: kind__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.ListResourceInstancesByKindRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListResourceInstancesByModuleRequest {
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
        let mut struct_ser = serializer.serialize_struct("module.ListResourceInstancesByModuleRequest", len)?;
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListResourceInstancesByModuleRequest {
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
            type Value = ListResourceInstancesByModuleRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ListResourceInstancesByModuleRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListResourceInstancesByModuleRequest, V::Error>
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
                Ok(ListResourceInstancesByModuleRequest {
                    module_id: module_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.ListResourceInstancesByModuleRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListResourceInstancesResponse {
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
        if !self.instances.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ListResourceInstancesResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.instances.is_empty() {
            struct_ser.serialize_field("instances", &self.instances)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListResourceInstancesResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "instances",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Instances,
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
                            "instances" => Ok(GeneratedField::Instances),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListResourceInstancesResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ListResourceInstancesResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListResourceInstancesResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut instances__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Instances => {
                            if instances__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instances"));
                            }
                            instances__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListResourceInstancesResponse {
                    status: status__,
                    instances: instances__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.ListResourceInstancesResponse", FIELDS, GeneratedVisitor)
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
        if !self.created_by_type.is_empty() {
            len += 1;
        }
        if !self.created_by_ref.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ListTriggersRequest", len)?;
        if !self.created_by_type.is_empty() {
            struct_ser.serialize_field("createdByType", &self.created_by_type)?;
        }
        if !self.created_by_ref.is_empty() {
            struct_ser.serialize_field("createdByRef", &self.created_by_ref)?;
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
            "created_by_type",
            "createdByType",
            "created_by_ref",
            "createdByRef",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            CreatedByType,
            CreatedByRef,
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
                            "createdByType" | "created_by_type" => Ok(GeneratedField::CreatedByType),
                            "createdByRef" | "created_by_ref" => Ok(GeneratedField::CreatedByRef),
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
                let mut created_by_type__ = None;
                let mut created_by_ref__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::CreatedByType => {
                            if created_by_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByType"));
                            }
                            created_by_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByRef => {
                            if created_by_ref__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByRef"));
                            }
                            created_by_ref__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListTriggersRequest {
                    created_by_type: created_by_type__.unwrap_or_default(),
                    created_by_ref: created_by_ref__.unwrap_or_default(),
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
impl serde::Serialize for ListWidgetsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.created_by_type.is_empty() {
            len += 1;
        }
        if !self.created_by_ref.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ListWidgetsRequest", len)?;
        if !self.created_by_type.is_empty() {
            struct_ser.serialize_field("createdByType", &self.created_by_type)?;
        }
        if !self.created_by_ref.is_empty() {
            struct_ser.serialize_field("createdByRef", &self.created_by_ref)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListWidgetsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "created_by_type",
            "createdByType",
            "created_by_ref",
            "createdByRef",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            CreatedByType,
            CreatedByRef,
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
                            "createdByType" | "created_by_type" => Ok(GeneratedField::CreatedByType),
                            "createdByRef" | "created_by_ref" => Ok(GeneratedField::CreatedByRef),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListWidgetsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ListWidgetsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListWidgetsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut created_by_type__ = None;
                let mut created_by_ref__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::CreatedByType => {
                            if created_by_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByType"));
                            }
                            created_by_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByRef => {
                            if created_by_ref__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByRef"));
                            }
                            created_by_ref__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListWidgetsRequest {
                    created_by_type: created_by_type__.unwrap_or_default(),
                    created_by_ref: created_by_ref__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.ListWidgetsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListWidgetsResponse {
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
        if !self.widgets.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ListWidgetsResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.widgets.is_empty() {
            struct_ser.serialize_field("widgets", &self.widgets)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListWidgetsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "widgets",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Widgets,
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
                            "widgets" => Ok(GeneratedField::Widgets),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListWidgetsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ListWidgetsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListWidgetsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut widgets__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Widgets => {
                            if widgets__.is_some() {
                                return Err(serde::de::Error::duplicate_field("widgets"));
                            }
                            widgets__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListWidgetsResponse {
                    status: status__,
                    widgets: widgets__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.ListWidgetsResponse", FIELDS, GeneratedVisitor)
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
        if !self.created_by_type.is_empty() {
            len += 1;
        }
        if !self.created_by_ref.is_empty() {
            len += 1;
        }
        if !self.module_key.is_empty() {
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
        if !self.created_by_type.is_empty() {
            struct_ser.serialize_field("createdByType", &self.created_by_type)?;
        }
        if !self.created_by_ref.is_empty() {
            struct_ser.serialize_field("createdByRef", &self.created_by_ref)?;
        }
        if !self.module_key.is_empty() {
            struct_ser.serialize_field("moduleKey", &self.module_key)?;
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
            "created_by_type",
            "createdByType",
            "created_by_ref",
            "createdByRef",
            "module_key",
            "moduleKey",
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
            CreatedByType,
            CreatedByRef,
            ModuleKey,
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
                            "createdByType" | "created_by_type" => Ok(GeneratedField::CreatedByType),
                            "createdByRef" | "created_by_ref" => Ok(GeneratedField::CreatedByRef),
                            "moduleKey" | "module_key" => Ok(GeneratedField::ModuleKey),
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
                let mut created_by_type__ = None;
                let mut created_by_ref__ = None;
                let mut module_key__ = None;
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
                        GeneratedField::CreatedByType => {
                            if created_by_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByType"));
                            }
                            created_by_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByRef => {
                            if created_by_ref__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByRef"));
                            }
                            created_by_ref__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ModuleKey => {
                            if module_key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleKey"));
                            }
                            module_key__ = Some(map_.next_value()?);
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
                    created_by_type: created_by_type__.unwrap_or_default(),
                    created_by_ref: created_by_ref__.unwrap_or_default(),
                    module_key: module_key__.unwrap_or_default(),
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
        if !self.manifest_id.is_empty() {
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
        if !self.name.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ModuleFunction", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        if !self.manifest_id.is_empty() {
            struct_ser.serialize_field("manifestId", &self.manifest_id)?;
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
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
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
            "manifest_id",
            "manifestId",
            "file_name",
            "fileName",
            "file_key",
            "fileKey",
            "entry_point",
            "entryPoint",
            "runtime",
            "name",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            ModuleId,
            ManifestId,
            FileName,
            FileKey,
            EntryPoint,
            Runtime,
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
                            "id" => Ok(GeneratedField::Id),
                            "moduleId" | "module_id" => Ok(GeneratedField::ModuleId),
                            "manifestId" | "manifest_id" => Ok(GeneratedField::ManifestId),
                            "fileName" | "file_name" => Ok(GeneratedField::FileName),
                            "fileKey" | "file_key" => Ok(GeneratedField::FileKey),
                            "entryPoint" | "entry_point" => Ok(GeneratedField::EntryPoint),
                            "runtime" => Ok(GeneratedField::Runtime),
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
                let mut manifest_id__ = None;
                let mut file_name__ = None;
                let mut file_key__ = None;
                let mut entry_point__ = None;
                let mut runtime__ = None;
                let mut name__ = None;
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
                        GeneratedField::ManifestId => {
                            if manifest_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("manifestId"));
                            }
                            manifest_id__ = Some(map_.next_value()?);
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
                        GeneratedField::Name => {
                            if name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("name"));
                            }
                            name__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ModuleFunction {
                    id: id__.unwrap_or_default(),
                    module_id: module_id__.unwrap_or_default(),
                    manifest_id: manifest_id__.unwrap_or_default(),
                    file_name: file_name__.unwrap_or_default(),
                    file_key: file_key__.unwrap_or_default(),
                    entry_point: entry_point__.unwrap_or_default(),
                    runtime: runtime__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.ModuleFunction", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ModuleResource {
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
        if !self.resource_type.is_empty() {
            len += 1;
        }
        if !self.resource_id.is_empty() {
            len += 1;
        }
        if !self.manifest_id.is_empty() {
            len += 1;
        }
        if !self.resource_name.is_empty() {
            len += 1;
        }
        if !self.original_version.is_empty() {
            len += 1;
        }
        if !self.current_version.is_empty() {
            len += 1;
        }
        if self.installed_at.is_some() {
            len += 1;
        }
        if self.updated_at.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ModuleResource", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        if !self.resource_type.is_empty() {
            struct_ser.serialize_field("resourceType", &self.resource_type)?;
        }
        if !self.resource_id.is_empty() {
            struct_ser.serialize_field("resourceId", &self.resource_id)?;
        }
        if !self.manifest_id.is_empty() {
            struct_ser.serialize_field("manifestId", &self.manifest_id)?;
        }
        if !self.resource_name.is_empty() {
            struct_ser.serialize_field("resourceName", &self.resource_name)?;
        }
        if !self.original_version.is_empty() {
            struct_ser.serialize_field("originalVersion", &self.original_version)?;
        }
        if !self.current_version.is_empty() {
            struct_ser.serialize_field("currentVersion", &self.current_version)?;
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
impl<'de> serde::Deserialize<'de> for ModuleResource {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "module_id",
            "moduleId",
            "resource_type",
            "resourceType",
            "resource_id",
            "resourceId",
            "manifest_id",
            "manifestId",
            "resource_name",
            "resourceName",
            "original_version",
            "originalVersion",
            "current_version",
            "currentVersion",
            "installed_at",
            "installedAt",
            "updated_at",
            "updatedAt",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            ModuleId,
            ResourceType,
            ResourceId,
            ManifestId,
            ResourceName,
            OriginalVersion,
            CurrentVersion,
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
                            "moduleId" | "module_id" => Ok(GeneratedField::ModuleId),
                            "resourceType" | "resource_type" => Ok(GeneratedField::ResourceType),
                            "resourceId" | "resource_id" => Ok(GeneratedField::ResourceId),
                            "manifestId" | "manifest_id" => Ok(GeneratedField::ManifestId),
                            "resourceName" | "resource_name" => Ok(GeneratedField::ResourceName),
                            "originalVersion" | "original_version" => Ok(GeneratedField::OriginalVersion),
                            "currentVersion" | "current_version" => Ok(GeneratedField::CurrentVersion),
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
            type Value = ModuleResource;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ModuleResource")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ModuleResource, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut module_id__ = None;
                let mut resource_type__ = None;
                let mut resource_id__ = None;
                let mut manifest_id__ = None;
                let mut resource_name__ = None;
                let mut original_version__ = None;
                let mut current_version__ = None;
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
                        GeneratedField::ModuleId => {
                            if module_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleId"));
                            }
                            module_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ResourceType => {
                            if resource_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("resourceType"));
                            }
                            resource_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ResourceId => {
                            if resource_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("resourceId"));
                            }
                            resource_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ManifestId => {
                            if manifest_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("manifestId"));
                            }
                            manifest_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ResourceName => {
                            if resource_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("resourceName"));
                            }
                            resource_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::OriginalVersion => {
                            if original_version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("originalVersion"));
                            }
                            original_version__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CurrentVersion => {
                            if current_version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("currentVersion"));
                            }
                            current_version__ = Some(map_.next_value()?);
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
                Ok(ModuleResource {
                    id: id__.unwrap_or_default(),
                    module_id: module_id__.unwrap_or_default(),
                    resource_type: resource_type__.unwrap_or_default(),
                    resource_id: resource_id__.unwrap_or_default(),
                    manifest_id: manifest_id__.unwrap_or_default(),
                    resource_name: resource_name__.unwrap_or_default(),
                    original_version: original_version__.unwrap_or_default(),
                    current_version: current_version__.unwrap_or_default(),
                    installed_at: installed_at__,
                    updated_at: updated_at__,
                })
            }
        }
        deserializer.deserialize_struct("module.ModuleResource", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ModuleResourceInstance {
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
        if !self.kind.is_empty() {
            len += 1;
        }
        if !self.instance_id.is_empty() {
            len += 1;
        }
        if !self.display_name.is_empty() {
            len += 1;
        }
        if !self.canonical_id.is_empty() {
            len += 1;
        }
        if self.created_at.is_some() {
            len += 1;
        }
        if self.updated_at.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ModuleResourceInstance", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        if !self.module_name.is_empty() {
            struct_ser.serialize_field("moduleName", &self.module_name)?;
        }
        if !self.kind.is_empty() {
            struct_ser.serialize_field("kind", &self.kind)?;
        }
        if !self.instance_id.is_empty() {
            struct_ser.serialize_field("instanceId", &self.instance_id)?;
        }
        if !self.display_name.is_empty() {
            struct_ser.serialize_field("displayName", &self.display_name)?;
        }
        if !self.canonical_id.is_empty() {
            struct_ser.serialize_field("canonicalId", &self.canonical_id)?;
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
impl<'de> serde::Deserialize<'de> for ModuleResourceInstance {
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
            "kind",
            "instance_id",
            "instanceId",
            "display_name",
            "displayName",
            "canonical_id",
            "canonicalId",
            "created_at",
            "createdAt",
            "updated_at",
            "updatedAt",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            ModuleId,
            ModuleName,
            Kind,
            InstanceId,
            DisplayName,
            CanonicalId,
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
                            "moduleId" | "module_id" => Ok(GeneratedField::ModuleId),
                            "moduleName" | "module_name" => Ok(GeneratedField::ModuleName),
                            "kind" => Ok(GeneratedField::Kind),
                            "instanceId" | "instance_id" => Ok(GeneratedField::InstanceId),
                            "displayName" | "display_name" => Ok(GeneratedField::DisplayName),
                            "canonicalId" | "canonical_id" => Ok(GeneratedField::CanonicalId),
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
            type Value = ModuleResourceInstance;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ModuleResourceInstance")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ModuleResourceInstance, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut module_id__ = None;
                let mut module_name__ = None;
                let mut kind__ = None;
                let mut instance_id__ = None;
                let mut display_name__ = None;
                let mut canonical_id__ = None;
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
                        GeneratedField::Kind => {
                            if kind__.is_some() {
                                return Err(serde::de::Error::duplicate_field("kind"));
                            }
                            kind__ = Some(map_.next_value()?);
                        }
                        GeneratedField::InstanceId => {
                            if instance_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instanceId"));
                            }
                            instance_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DisplayName => {
                            if display_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("displayName"));
                            }
                            display_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CanonicalId => {
                            if canonical_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("canonicalId"));
                            }
                            canonical_id__ = Some(map_.next_value()?);
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
                Ok(ModuleResourceInstance {
                    id: id__.unwrap_or_default(),
                    module_id: module_id__.unwrap_or_default(),
                    module_name: module_name__.unwrap_or_default(),
                    kind: kind__.unwrap_or_default(),
                    instance_id: instance_id__.unwrap_or_default(),
                    display_name: display_name__.unwrap_or_default(),
                    canonical_id: canonical_id__.unwrap_or_default(),
                    created_at: created_at__,
                    updated_at: updated_at__,
                })
            }
        }
        deserializer.deserialize_struct("module.ModuleResourceInstance", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ModuleResourceResponse {
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
        if self.resource.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ModuleResourceResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.resource.as_ref() {
            struct_ser.serialize_field("resource", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ModuleResourceResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "resource",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Resource,
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
                            "resource" => Ok(GeneratedField::Resource),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ModuleResourceResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ModuleResourceResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ModuleResourceResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut resource__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Resource => {
                            if resource__.is_some() {
                                return Err(serde::de::Error::duplicate_field("resource"));
                            }
                            resource__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ModuleResourceResponse {
                    status: status__,
                    resource: resource__,
                })
            }
        }
        deserializer.deserialize_struct("module.ModuleResourceResponse", FIELDS, GeneratedVisitor)
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
impl serde::Serialize for RegisterActionsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.module_key.is_empty() {
            len += 1;
        }
        if !self.module_name.is_empty() {
            len += 1;
        }
        if !self.version.is_empty() {
            len += 1;
        }
        if !self.actions.is_empty() {
            len += 1;
        }
        if !self.created_by_type.is_empty() {
            len += 1;
        }
        if !self.created_by_ref.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.RegisterActionsRequest", len)?;
        if !self.module_key.is_empty() {
            struct_ser.serialize_field("moduleKey", &self.module_key)?;
        }
        if !self.module_name.is_empty() {
            struct_ser.serialize_field("moduleName", &self.module_name)?;
        }
        if !self.version.is_empty() {
            struct_ser.serialize_field("version", &self.version)?;
        }
        if !self.actions.is_empty() {
            struct_ser.serialize_field("actions", &self.actions)?;
        }
        if !self.created_by_type.is_empty() {
            struct_ser.serialize_field("createdByType", &self.created_by_type)?;
        }
        if !self.created_by_ref.is_empty() {
            struct_ser.serialize_field("createdByRef", &self.created_by_ref)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RegisterActionsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "module_key",
            "moduleKey",
            "module_name",
            "moduleName",
            "version",
            "actions",
            "created_by_type",
            "createdByType",
            "created_by_ref",
            "createdByRef",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ModuleKey,
            ModuleName,
            Version,
            Actions,
            CreatedByType,
            CreatedByRef,
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
                            "moduleKey" | "module_key" => Ok(GeneratedField::ModuleKey),
                            "moduleName" | "module_name" => Ok(GeneratedField::ModuleName),
                            "version" => Ok(GeneratedField::Version),
                            "actions" => Ok(GeneratedField::Actions),
                            "createdByType" | "created_by_type" => Ok(GeneratedField::CreatedByType),
                            "createdByRef" | "created_by_ref" => Ok(GeneratedField::CreatedByRef),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RegisterActionsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.RegisterActionsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RegisterActionsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut module_key__ = None;
                let mut module_name__ = None;
                let mut version__ = None;
                let mut actions__ = None;
                let mut created_by_type__ = None;
                let mut created_by_ref__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ModuleKey => {
                            if module_key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleKey"));
                            }
                            module_key__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ModuleName => {
                            if module_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleName"));
                            }
                            module_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Version => {
                            if version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("version"));
                            }
                            version__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Actions => {
                            if actions__.is_some() {
                                return Err(serde::de::Error::duplicate_field("actions"));
                            }
                            actions__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByType => {
                            if created_by_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByType"));
                            }
                            created_by_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByRef => {
                            if created_by_ref__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByRef"));
                            }
                            created_by_ref__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RegisterActionsRequest {
                    module_key: module_key__.unwrap_or_default(),
                    module_name: module_name__.unwrap_or_default(),
                    version: version__.unwrap_or_default(),
                    actions: actions__.unwrap_or_default(),
                    created_by_type: created_by_type__.unwrap_or_default(),
                    created_by_ref: created_by_ref__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.RegisterActionsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RegisterAssetsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.module_key.is_empty() {
            len += 1;
        }
        if !self.module_name.is_empty() {
            len += 1;
        }
        if !self.version.is_empty() {
            len += 1;
        }
        if !self.assets.is_empty() {
            len += 1;
        }
        if !self.created_by_type.is_empty() {
            len += 1;
        }
        if !self.created_by_ref.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.RegisterAssetsRequest", len)?;
        if !self.module_key.is_empty() {
            struct_ser.serialize_field("moduleKey", &self.module_key)?;
        }
        if !self.module_name.is_empty() {
            struct_ser.serialize_field("moduleName", &self.module_name)?;
        }
        if !self.version.is_empty() {
            struct_ser.serialize_field("version", &self.version)?;
        }
        if !self.assets.is_empty() {
            struct_ser.serialize_field("assets", &self.assets)?;
        }
        if !self.created_by_type.is_empty() {
            struct_ser.serialize_field("createdByType", &self.created_by_type)?;
        }
        if !self.created_by_ref.is_empty() {
            struct_ser.serialize_field("createdByRef", &self.created_by_ref)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RegisterAssetsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "module_key",
            "moduleKey",
            "module_name",
            "moduleName",
            "version",
            "assets",
            "created_by_type",
            "createdByType",
            "created_by_ref",
            "createdByRef",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ModuleKey,
            ModuleName,
            Version,
            Assets,
            CreatedByType,
            CreatedByRef,
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
                            "moduleKey" | "module_key" => Ok(GeneratedField::ModuleKey),
                            "moduleName" | "module_name" => Ok(GeneratedField::ModuleName),
                            "version" => Ok(GeneratedField::Version),
                            "assets" => Ok(GeneratedField::Assets),
                            "createdByType" | "created_by_type" => Ok(GeneratedField::CreatedByType),
                            "createdByRef" | "created_by_ref" => Ok(GeneratedField::CreatedByRef),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RegisterAssetsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.RegisterAssetsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RegisterAssetsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut module_key__ = None;
                let mut module_name__ = None;
                let mut version__ = None;
                let mut assets__ = None;
                let mut created_by_type__ = None;
                let mut created_by_ref__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ModuleKey => {
                            if module_key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleKey"));
                            }
                            module_key__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ModuleName => {
                            if module_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleName"));
                            }
                            module_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Version => {
                            if version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("version"));
                            }
                            version__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Assets => {
                            if assets__.is_some() {
                                return Err(serde::de::Error::duplicate_field("assets"));
                            }
                            assets__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByType => {
                            if created_by_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByType"));
                            }
                            created_by_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByRef => {
                            if created_by_ref__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByRef"));
                            }
                            created_by_ref__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RegisterAssetsRequest {
                    module_key: module_key__.unwrap_or_default(),
                    module_name: module_name__.unwrap_or_default(),
                    version: version__.unwrap_or_default(),
                    assets: assets__.unwrap_or_default(),
                    created_by_type: created_by_type__.unwrap_or_default(),
                    created_by_ref: created_by_ref__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.RegisterAssetsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RegisterTriggersRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.module_key.is_empty() {
            len += 1;
        }
        if !self.module_name.is_empty() {
            len += 1;
        }
        if !self.version.is_empty() {
            len += 1;
        }
        if !self.triggers.is_empty() {
            len += 1;
        }
        if !self.created_by_type.is_empty() {
            len += 1;
        }
        if !self.created_by_ref.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.RegisterTriggersRequest", len)?;
        if !self.module_key.is_empty() {
            struct_ser.serialize_field("moduleKey", &self.module_key)?;
        }
        if !self.module_name.is_empty() {
            struct_ser.serialize_field("moduleName", &self.module_name)?;
        }
        if !self.version.is_empty() {
            struct_ser.serialize_field("version", &self.version)?;
        }
        if !self.triggers.is_empty() {
            struct_ser.serialize_field("triggers", &self.triggers)?;
        }
        if !self.created_by_type.is_empty() {
            struct_ser.serialize_field("createdByType", &self.created_by_type)?;
        }
        if !self.created_by_ref.is_empty() {
            struct_ser.serialize_field("createdByRef", &self.created_by_ref)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RegisterTriggersRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "module_key",
            "moduleKey",
            "module_name",
            "moduleName",
            "version",
            "triggers",
            "created_by_type",
            "createdByType",
            "created_by_ref",
            "createdByRef",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ModuleKey,
            ModuleName,
            Version,
            Triggers,
            CreatedByType,
            CreatedByRef,
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
                            "moduleKey" | "module_key" => Ok(GeneratedField::ModuleKey),
                            "moduleName" | "module_name" => Ok(GeneratedField::ModuleName),
                            "version" => Ok(GeneratedField::Version),
                            "triggers" => Ok(GeneratedField::Triggers),
                            "createdByType" | "created_by_type" => Ok(GeneratedField::CreatedByType),
                            "createdByRef" | "created_by_ref" => Ok(GeneratedField::CreatedByRef),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RegisterTriggersRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.RegisterTriggersRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RegisterTriggersRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut module_key__ = None;
                let mut module_name__ = None;
                let mut version__ = None;
                let mut triggers__ = None;
                let mut created_by_type__ = None;
                let mut created_by_ref__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ModuleKey => {
                            if module_key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleKey"));
                            }
                            module_key__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ModuleName => {
                            if module_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleName"));
                            }
                            module_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Version => {
                            if version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("version"));
                            }
                            version__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Triggers => {
                            if triggers__.is_some() {
                                return Err(serde::de::Error::duplicate_field("triggers"));
                            }
                            triggers__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByType => {
                            if created_by_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByType"));
                            }
                            created_by_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByRef => {
                            if created_by_ref__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByRef"));
                            }
                            created_by_ref__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RegisterTriggersRequest {
                    module_key: module_key__.unwrap_or_default(),
                    module_name: module_name__.unwrap_or_default(),
                    version: version__.unwrap_or_default(),
                    triggers: triggers__.unwrap_or_default(),
                    created_by_type: created_by_type__.unwrap_or_default(),
                    created_by_ref: created_by_ref__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.RegisterTriggersRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RegisterWidgetsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.module_key.is_empty() {
            len += 1;
        }
        if !self.module_name.is_empty() {
            len += 1;
        }
        if !self.version.is_empty() {
            len += 1;
        }
        if !self.widgets.is_empty() {
            len += 1;
        }
        if !self.created_by_type.is_empty() {
            len += 1;
        }
        if !self.created_by_ref.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.RegisterWidgetsRequest", len)?;
        if !self.module_key.is_empty() {
            struct_ser.serialize_field("moduleKey", &self.module_key)?;
        }
        if !self.module_name.is_empty() {
            struct_ser.serialize_field("moduleName", &self.module_name)?;
        }
        if !self.version.is_empty() {
            struct_ser.serialize_field("version", &self.version)?;
        }
        if !self.widgets.is_empty() {
            struct_ser.serialize_field("widgets", &self.widgets)?;
        }
        if !self.created_by_type.is_empty() {
            struct_ser.serialize_field("createdByType", &self.created_by_type)?;
        }
        if !self.created_by_ref.is_empty() {
            struct_ser.serialize_field("createdByRef", &self.created_by_ref)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RegisterWidgetsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "module_key",
            "moduleKey",
            "module_name",
            "moduleName",
            "version",
            "widgets",
            "created_by_type",
            "createdByType",
            "created_by_ref",
            "createdByRef",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ModuleKey,
            ModuleName,
            Version,
            Widgets,
            CreatedByType,
            CreatedByRef,
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
                            "moduleKey" | "module_key" => Ok(GeneratedField::ModuleKey),
                            "moduleName" | "module_name" => Ok(GeneratedField::ModuleName),
                            "version" => Ok(GeneratedField::Version),
                            "widgets" => Ok(GeneratedField::Widgets),
                            "createdByType" | "created_by_type" => Ok(GeneratedField::CreatedByType),
                            "createdByRef" | "created_by_ref" => Ok(GeneratedField::CreatedByRef),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RegisterWidgetsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.RegisterWidgetsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RegisterWidgetsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut module_key__ = None;
                let mut module_name__ = None;
                let mut version__ = None;
                let mut widgets__ = None;
                let mut created_by_type__ = None;
                let mut created_by_ref__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ModuleKey => {
                            if module_key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleKey"));
                            }
                            module_key__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ModuleName => {
                            if module_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("moduleName"));
                            }
                            module_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Version => {
                            if version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("version"));
                            }
                            version__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Widgets => {
                            if widgets__.is_some() {
                                return Err(serde::de::Error::duplicate_field("widgets"));
                            }
                            widgets__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByType => {
                            if created_by_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByType"));
                            }
                            created_by_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByRef => {
                            if created_by_ref__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByRef"));
                            }
                            created_by_ref__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RegisterWidgetsRequest {
                    module_key: module_key__.unwrap_or_default(),
                    module_name: module_name__.unwrap_or_default(),
                    version: version__.unwrap_or_default(),
                    widgets: widgets__.unwrap_or_default(),
                    created_by_type: created_by_type__.unwrap_or_default(),
                    created_by_ref: created_by_ref__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.RegisterWidgetsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ResourceInstanceResponse {
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
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ResourceInstanceResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ResourceInstanceResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "instance",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Instance,
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
                            "instance" => Ok(GeneratedField::Instance),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ResourceInstanceResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ResourceInstanceResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ResourceInstanceResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut instance__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ResourceInstanceResponse {
                    status: status__,
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("module.ResourceInstanceResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ResourceUsage {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.resource_id.is_empty() {
            len += 1;
        }
        if !self.resource_type.is_empty() {
            len += 1;
        }
        if !self.resource_name.is_empty() {
            len += 1;
        }
        if !self.used_by.is_empty() {
            len += 1;
        }
        if !self.resource_display_name.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.ResourceUsage", len)?;
        if !self.resource_id.is_empty() {
            struct_ser.serialize_field("resourceId", &self.resource_id)?;
        }
        if !self.resource_type.is_empty() {
            struct_ser.serialize_field("resourceType", &self.resource_type)?;
        }
        if !self.resource_name.is_empty() {
            struct_ser.serialize_field("resourceName", &self.resource_name)?;
        }
        if !self.used_by.is_empty() {
            struct_ser.serialize_field("usedBy", &self.used_by)?;
        }
        if !self.resource_display_name.is_empty() {
            struct_ser.serialize_field("resourceDisplayName", &self.resource_display_name)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ResourceUsage {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "resource_id",
            "resourceId",
            "resource_type",
            "resourceType",
            "resource_name",
            "resourceName",
            "used_by",
            "usedBy",
            "resource_display_name",
            "resourceDisplayName",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ResourceId,
            ResourceType,
            ResourceName,
            UsedBy,
            ResourceDisplayName,
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
                            "resourceId" | "resource_id" => Ok(GeneratedField::ResourceId),
                            "resourceType" | "resource_type" => Ok(GeneratedField::ResourceType),
                            "resourceName" | "resource_name" => Ok(GeneratedField::ResourceName),
                            "usedBy" | "used_by" => Ok(GeneratedField::UsedBy),
                            "resourceDisplayName" | "resource_display_name" => Ok(GeneratedField::ResourceDisplayName),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ResourceUsage;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.ResourceUsage")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ResourceUsage, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut resource_id__ = None;
                let mut resource_type__ = None;
                let mut resource_name__ = None;
                let mut used_by__ = None;
                let mut resource_display_name__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ResourceId => {
                            if resource_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("resourceId"));
                            }
                            resource_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ResourceType => {
                            if resource_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("resourceType"));
                            }
                            resource_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ResourceName => {
                            if resource_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("resourceName"));
                            }
                            resource_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::UsedBy => {
                            if used_by__.is_some() {
                                return Err(serde::de::Error::duplicate_field("usedBy"));
                            }
                            used_by__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ResourceDisplayName => {
                            if resource_display_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("resourceDisplayName"));
                            }
                            resource_display_name__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ResourceUsage {
                    resource_id: resource_id__.unwrap_or_default(),
                    resource_type: resource_type__.unwrap_or_default(),
                    resource_name: resource_name__.unwrap_or_default(),
                    used_by: used_by__.unwrap_or_default(),
                    resource_display_name: resource_display_name__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.ResourceUsage", FIELDS, GeneratedVisitor)
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
impl serde::Serialize for Trigger {
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
        if !self.created_by_type.is_empty() {
            len += 1;
        }
        if !self.created_by_ref.is_empty() {
            len += 1;
        }
        if !self.manifest_id.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.Trigger", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
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
        if !self.created_by_type.is_empty() {
            struct_ser.serialize_field("createdByType", &self.created_by_type)?;
        }
        if !self.created_by_ref.is_empty() {
            struct_ser.serialize_field("createdByRef", &self.created_by_ref)?;
        }
        if !self.manifest_id.is_empty() {
            struct_ser.serialize_field("manifestId", &self.manifest_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Trigger {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "category",
            "name",
            "description",
            "event",
            "config_schema",
            "configSchema",
            "allow_variants",
            "allowVariants",
            "created_by_type",
            "createdByType",
            "created_by_ref",
            "createdByRef",
            "manifest_id",
            "manifestId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Category,
            Name,
            Description,
            Event,
            ConfigSchema,
            AllowVariants,
            CreatedByType,
            CreatedByRef,
            ManifestId,
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
                            "category" => Ok(GeneratedField::Category),
                            "name" => Ok(GeneratedField::Name),
                            "description" => Ok(GeneratedField::Description),
                            "event" => Ok(GeneratedField::Event),
                            "configSchema" | "config_schema" => Ok(GeneratedField::ConfigSchema),
                            "allowVariants" | "allow_variants" => Ok(GeneratedField::AllowVariants),
                            "createdByType" | "created_by_type" => Ok(GeneratedField::CreatedByType),
                            "createdByRef" | "created_by_ref" => Ok(GeneratedField::CreatedByRef),
                            "manifestId" | "manifest_id" => Ok(GeneratedField::ManifestId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = Trigger;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.Trigger")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Trigger, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut category__ = None;
                let mut name__ = None;
                let mut description__ = None;
                let mut event__ = None;
                let mut config_schema__ = None;
                let mut allow_variants__ = None;
                let mut created_by_type__ = None;
                let mut created_by_ref__ = None;
                let mut manifest_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map_.next_value()?);
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
                        GeneratedField::CreatedByType => {
                            if created_by_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByType"));
                            }
                            created_by_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByRef => {
                            if created_by_ref__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByRef"));
                            }
                            created_by_ref__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ManifestId => {
                            if manifest_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("manifestId"));
                            }
                            manifest_id__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(Trigger {
                    id: id__.unwrap_or_default(),
                    category: category__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    event: event__.unwrap_or_default(),
                    config_schema: config_schema__.unwrap_or_default(),
                    allow_variants: allow_variants__.unwrap_or_default(),
                    created_by_type: created_by_type__.unwrap_or_default(),
                    created_by_ref: created_by_ref__.unwrap_or_default(),
                    manifest_id: manifest_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.Trigger", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for TriggerInput {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
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
        if !self.manifest_id.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.TriggerInput", len)?;
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
        if !self.manifest_id.is_empty() {
            struct_ser.serialize_field("manifestId", &self.manifest_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for TriggerInput {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "category",
            "name",
            "description",
            "event",
            "config_schema",
            "configSchema",
            "allow_variants",
            "allowVariants",
            "manifest_id",
            "manifestId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Category,
            Name,
            Description,
            Event,
            ConfigSchema,
            AllowVariants,
            ManifestId,
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
                            "category" => Ok(GeneratedField::Category),
                            "name" => Ok(GeneratedField::Name),
                            "description" => Ok(GeneratedField::Description),
                            "event" => Ok(GeneratedField::Event),
                            "configSchema" | "config_schema" => Ok(GeneratedField::ConfigSchema),
                            "allowVariants" | "allow_variants" => Ok(GeneratedField::AllowVariants),
                            "manifestId" | "manifest_id" => Ok(GeneratedField::ManifestId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = TriggerInput;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.TriggerInput")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<TriggerInput, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut category__ = None;
                let mut name__ = None;
                let mut description__ = None;
                let mut event__ = None;
                let mut config_schema__ = None;
                let mut allow_variants__ = None;
                let mut manifest_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
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
                        GeneratedField::ManifestId => {
                            if manifest_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("manifestId"));
                            }
                            manifest_id__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(TriggerInput {
                    category: category__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    event: event__.unwrap_or_default(),
                    config_schema: config_schema__.unwrap_or_default(),
                    allow_variants: allow_variants__.unwrap_or_default(),
                    manifest_id: manifest_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.TriggerInput", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for TriggerResponse {
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
        let mut struct_ser = serializer.serialize_struct("module.TriggerResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.trigger.as_ref() {
            struct_ser.serialize_field("trigger", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for TriggerResponse {
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
            type Value = TriggerResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.TriggerResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<TriggerResponse, V::Error>
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
                Ok(TriggerResponse {
                    status: status__,
                    trigger: trigger__,
                })
            }
        }
        deserializer.deserialize_struct("module.TriggerResponse", FIELDS, GeneratedVisitor)
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
impl serde::Serialize for UpdateModuleResourceVersionRequest {
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
        let mut struct_ser = serializer.serialize_struct("module.UpdateModuleResourceVersionRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.version.is_empty() {
            struct_ser.serialize_field("version", &self.version)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for UpdateModuleResourceVersionRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "version",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Version,
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
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = UpdateModuleResourceVersionRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.UpdateModuleResourceVersionRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<UpdateModuleResourceVersionRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut version__ = None;
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
                    }
                }
                Ok(UpdateModuleResourceVersionRequest {
                    id: id__.unwrap_or_default(),
                    version: version__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.UpdateModuleResourceVersionRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for UsageRef {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.source_type.is_empty() {
            len += 1;
        }
        if !self.source_id.is_empty() {
            len += 1;
        }
        if !self.source_name.is_empty() {
            len += 1;
        }
        if !self.context.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.UsageRef", len)?;
        if !self.source_type.is_empty() {
            struct_ser.serialize_field("sourceType", &self.source_type)?;
        }
        if !self.source_id.is_empty() {
            struct_ser.serialize_field("sourceId", &self.source_id)?;
        }
        if !self.source_name.is_empty() {
            struct_ser.serialize_field("sourceName", &self.source_name)?;
        }
        if !self.context.is_empty() {
            struct_ser.serialize_field("context", &self.context)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for UsageRef {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "source_type",
            "sourceType",
            "source_id",
            "sourceId",
            "source_name",
            "sourceName",
            "context",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            SourceType,
            SourceId,
            SourceName,
            Context,
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
                            "sourceType" | "source_type" => Ok(GeneratedField::SourceType),
                            "sourceId" | "source_id" => Ok(GeneratedField::SourceId),
                            "sourceName" | "source_name" => Ok(GeneratedField::SourceName),
                            "context" => Ok(GeneratedField::Context),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = UsageRef;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.UsageRef")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<UsageRef, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut source_type__ = None;
                let mut source_id__ = None;
                let mut source_name__ = None;
                let mut context__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::SourceType => {
                            if source_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sourceType"));
                            }
                            source_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SourceId => {
                            if source_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sourceId"));
                            }
                            source_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SourceName => {
                            if source_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sourceName"));
                            }
                            source_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Context => {
                            if context__.is_some() {
                                return Err(serde::de::Error::duplicate_field("context"));
                            }
                            context__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(UsageRef {
                    source_type: source_type__.unwrap_or_default(),
                    source_id: source_id__.unwrap_or_default(),
                    source_name: source_name__.unwrap_or_default(),
                    context: context__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.UsageRef", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for Widget {
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
        if !self.manifest_id.is_empty() {
            len += 1;
        }
        if !self.name.is_empty() {
            len += 1;
        }
        if !self.description.is_empty() {
            len += 1;
        }
        if !self.directory.is_empty() {
            len += 1;
        }
        if !self.alert_types.is_empty() {
            len += 1;
        }
        if !self.settings_schema.is_empty() {
            len += 1;
        }
        if !self.created_by_type.is_empty() {
            len += 1;
        }
        if !self.created_by_ref.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.Widget", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.module_id.is_empty() {
            struct_ser.serialize_field("moduleId", &self.module_id)?;
        }
        if !self.manifest_id.is_empty() {
            struct_ser.serialize_field("manifestId", &self.manifest_id)?;
        }
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.directory.is_empty() {
            struct_ser.serialize_field("directory", &self.directory)?;
        }
        if !self.alert_types.is_empty() {
            struct_ser.serialize_field("alertTypes", &self.alert_types)?;
        }
        if !self.settings_schema.is_empty() {
            struct_ser.serialize_field("settingsSchema", &self.settings_schema)?;
        }
        if !self.created_by_type.is_empty() {
            struct_ser.serialize_field("createdByType", &self.created_by_type)?;
        }
        if !self.created_by_ref.is_empty() {
            struct_ser.serialize_field("createdByRef", &self.created_by_ref)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Widget {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "module_id",
            "moduleId",
            "manifest_id",
            "manifestId",
            "name",
            "description",
            "directory",
            "alert_types",
            "alertTypes",
            "settings_schema",
            "settingsSchema",
            "created_by_type",
            "createdByType",
            "created_by_ref",
            "createdByRef",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            ModuleId,
            ManifestId,
            Name,
            Description,
            Directory,
            AlertTypes,
            SettingsSchema,
            CreatedByType,
            CreatedByRef,
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
                            "manifestId" | "manifest_id" => Ok(GeneratedField::ManifestId),
                            "name" => Ok(GeneratedField::Name),
                            "description" => Ok(GeneratedField::Description),
                            "directory" => Ok(GeneratedField::Directory),
                            "alertTypes" | "alert_types" => Ok(GeneratedField::AlertTypes),
                            "settingsSchema" | "settings_schema" => Ok(GeneratedField::SettingsSchema),
                            "createdByType" | "created_by_type" => Ok(GeneratedField::CreatedByType),
                            "createdByRef" | "created_by_ref" => Ok(GeneratedField::CreatedByRef),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = Widget;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.Widget")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Widget, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut module_id__ = None;
                let mut manifest_id__ = None;
                let mut name__ = None;
                let mut description__ = None;
                let mut directory__ = None;
                let mut alert_types__ = None;
                let mut settings_schema__ = None;
                let mut created_by_type__ = None;
                let mut created_by_ref__ = None;
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
                        GeneratedField::ManifestId => {
                            if manifest_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("manifestId"));
                            }
                            manifest_id__ = Some(map_.next_value()?);
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
                        GeneratedField::Directory => {
                            if directory__.is_some() {
                                return Err(serde::de::Error::duplicate_field("directory"));
                            }
                            directory__ = Some(map_.next_value()?);
                        }
                        GeneratedField::AlertTypes => {
                            if alert_types__.is_some() {
                                return Err(serde::de::Error::duplicate_field("alertTypes"));
                            }
                            alert_types__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SettingsSchema => {
                            if settings_schema__.is_some() {
                                return Err(serde::de::Error::duplicate_field("settingsSchema"));
                            }
                            settings_schema__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByType => {
                            if created_by_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByType"));
                            }
                            created_by_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedByRef => {
                            if created_by_ref__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdByRef"));
                            }
                            created_by_ref__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(Widget {
                    id: id__.unwrap_or_default(),
                    module_id: module_id__.unwrap_or_default(),
                    manifest_id: manifest_id__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    directory: directory__.unwrap_or_default(),
                    alert_types: alert_types__.unwrap_or_default(),
                    settings_schema: settings_schema__.unwrap_or_default(),
                    created_by_type: created_by_type__.unwrap_or_default(),
                    created_by_ref: created_by_ref__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.Widget", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for WidgetInput {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.manifest_id.is_empty() {
            len += 1;
        }
        if !self.name.is_empty() {
            len += 1;
        }
        if !self.description.is_empty() {
            len += 1;
        }
        if !self.directory.is_empty() {
            len += 1;
        }
        if !self.alert_types.is_empty() {
            len += 1;
        }
        if !self.settings_schema.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.WidgetInput", len)?;
        if !self.manifest_id.is_empty() {
            struct_ser.serialize_field("manifestId", &self.manifest_id)?;
        }
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.directory.is_empty() {
            struct_ser.serialize_field("directory", &self.directory)?;
        }
        if !self.alert_types.is_empty() {
            struct_ser.serialize_field("alertTypes", &self.alert_types)?;
        }
        if !self.settings_schema.is_empty() {
            struct_ser.serialize_field("settingsSchema", &self.settings_schema)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for WidgetInput {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "manifest_id",
            "manifestId",
            "name",
            "description",
            "directory",
            "alert_types",
            "alertTypes",
            "settings_schema",
            "settingsSchema",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ManifestId,
            Name,
            Description,
            Directory,
            AlertTypes,
            SettingsSchema,
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
                            "manifestId" | "manifest_id" => Ok(GeneratedField::ManifestId),
                            "name" => Ok(GeneratedField::Name),
                            "description" => Ok(GeneratedField::Description),
                            "directory" => Ok(GeneratedField::Directory),
                            "alertTypes" | "alert_types" => Ok(GeneratedField::AlertTypes),
                            "settingsSchema" | "settings_schema" => Ok(GeneratedField::SettingsSchema),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = WidgetInput;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.WidgetInput")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<WidgetInput, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut manifest_id__ = None;
                let mut name__ = None;
                let mut description__ = None;
                let mut directory__ = None;
                let mut alert_types__ = None;
                let mut settings_schema__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ManifestId => {
                            if manifest_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("manifestId"));
                            }
                            manifest_id__ = Some(map_.next_value()?);
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
                        GeneratedField::Directory => {
                            if directory__.is_some() {
                                return Err(serde::de::Error::duplicate_field("directory"));
                            }
                            directory__ = Some(map_.next_value()?);
                        }
                        GeneratedField::AlertTypes => {
                            if alert_types__.is_some() {
                                return Err(serde::de::Error::duplicate_field("alertTypes"));
                            }
                            alert_types__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SettingsSchema => {
                            if settings_schema__.is_some() {
                                return Err(serde::de::Error::duplicate_field("settingsSchema"));
                            }
                            settings_schema__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(WidgetInput {
                    manifest_id: manifest_id__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    directory: directory__.unwrap_or_default(),
                    alert_types: alert_types__.unwrap_or_default(),
                    settings_schema: settings_schema__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("module.WidgetInput", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for WidgetResponse {
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
        if self.widget.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("module.WidgetResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.widget.as_ref() {
            struct_ser.serialize_field("widget", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for WidgetResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "widget",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Widget,
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
                            "widget" => Ok(GeneratedField::Widget),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = WidgetResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct module.WidgetResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<WidgetResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut widget__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Widget => {
                            if widget__.is_some() {
                                return Err(serde::de::Error::duplicate_field("widget"));
                            }
                            widget__ = map_.next_value()?;
                        }
                    }
                }
                Ok(WidgetResponse {
                    status: status__,
                    widget: widget__,
                })
            }
        }
        deserializer.deserialize_struct("module.WidgetResponse", FIELDS, GeneratedVisitor)
    }
}
