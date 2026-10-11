// @generated
impl serde::Serialize for CompositionLink {
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
        if !self.composition_id.is_empty() {
            len += 1;
        }
        if !self.owner_kind.is_empty() {
            len += 1;
        }
        if !self.owner_id.is_empty() {
            len += 1;
        }
        if !self.step_id.is_empty() {
            len += 1;
        }
        if self.created_at.is_some() {
            len += 1;
        }
        if self.updated_at.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene.CompositionLink", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.composition_id.is_empty() {
            struct_ser.serialize_field("compositionId", &self.composition_id)?;
        }
        if !self.owner_kind.is_empty() {
            struct_ser.serialize_field("ownerKind", &self.owner_kind)?;
        }
        if !self.owner_id.is_empty() {
            struct_ser.serialize_field("ownerId", &self.owner_id)?;
        }
        if !self.step_id.is_empty() {
            struct_ser.serialize_field("stepId", &self.step_id)?;
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
impl<'de> serde::Deserialize<'de> for CompositionLink {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "composition_id",
            "compositionId",
            "owner_kind",
            "ownerKind",
            "owner_id",
            "ownerId",
            "step_id",
            "stepId",
            "created_at",
            "createdAt",
            "updated_at",
            "updatedAt",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            CompositionId,
            OwnerKind,
            OwnerId,
            StepId,
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
                            "compositionId" | "composition_id" => Ok(GeneratedField::CompositionId),
                            "ownerKind" | "owner_kind" => Ok(GeneratedField::OwnerKind),
                            "ownerId" | "owner_id" => Ok(GeneratedField::OwnerId),
                            "stepId" | "step_id" => Ok(GeneratedField::StepId),
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
            type Value = CompositionLink;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene.CompositionLink")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CompositionLink, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut composition_id__ = None;
                let mut owner_kind__ = None;
                let mut owner_id__ = None;
                let mut step_id__ = None;
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
                        GeneratedField::CompositionId => {
                            if composition_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("compositionId"));
                            }
                            composition_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::OwnerKind => {
                            if owner_kind__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ownerKind"));
                            }
                            owner_kind__ = Some(map_.next_value()?);
                        }
                        GeneratedField::OwnerId => {
                            if owner_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ownerId"));
                            }
                            owner_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::StepId => {
                            if step_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("stepId"));
                            }
                            step_id__ = Some(map_.next_value()?);
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
                Ok(CompositionLink {
                    id: id__.unwrap_or_default(),
                    composition_id: composition_id__.unwrap_or_default(),
                    owner_kind: owner_kind__.unwrap_or_default(),
                    owner_id: owner_id__.unwrap_or_default(),
                    step_id: step_id__.unwrap_or_default(),
                    created_at: created_at__,
                    updated_at: updated_at__,
                })
            }
        }
        deserializer.deserialize_struct("scene.CompositionLink", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for CompositionLinksResponse {
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
        if !self.links.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene.CompositionLinksResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.links.is_empty() {
            struct_ser.serialize_field("links", &self.links)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CompositionLinksResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "links",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Links,
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
                            "links" => Ok(GeneratedField::Links),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CompositionLinksResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene.CompositionLinksResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CompositionLinksResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut links__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Links => {
                            if links__.is_some() {
                                return Err(serde::de::Error::duplicate_field("links"));
                            }
                            links__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(CompositionLinksResponse {
                    status: status__,
                    links: links__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("scene.CompositionLinksResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for CountCompositionLinksRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.composition_id.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene.CountCompositionLinksRequest", len)?;
        if !self.composition_id.is_empty() {
            struct_ser.serialize_field("compositionId", &self.composition_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CountCompositionLinksRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "composition_id",
            "compositionId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            CompositionId,
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
                            "compositionId" | "composition_id" => Ok(GeneratedField::CompositionId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CountCompositionLinksRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene.CountCompositionLinksRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CountCompositionLinksRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut composition_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::CompositionId => {
                            if composition_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("compositionId"));
                            }
                            composition_id__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(CountCompositionLinksRequest {
                    composition_id: composition_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("scene.CountCompositionLinksRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for CountCompositionLinksResponse {
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
        if self.count != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene.CountCompositionLinksResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if self.count != 0 {
            struct_ser.serialize_field("count", &self.count)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CountCompositionLinksResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "count",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Count,
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
                            "count" => Ok(GeneratedField::Count),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CountCompositionLinksResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene.CountCompositionLinksResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CountCompositionLinksResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut count__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Count => {
                            if count__.is_some() {
                                return Err(serde::de::Error::duplicate_field("count"));
                            }
                            count__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(CountCompositionLinksResponse {
                    status: status__,
                    count: count__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("scene.CountCompositionLinksResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for CreateSceneRequest {
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
        if !self.widgets_json.is_empty() {
            len += 1;
        }
        if !self.layout_json.is_empty() {
            len += 1;
        }
        if !self.created_by_type.is_empty() {
            len += 1;
        }
        if !self.created_by_ref.is_empty() {
            len += 1;
        }
        if !self.kind.is_empty() {
            len += 1;
        }
        if !self.behaviors_json.is_empty() {
            len += 1;
        }
        if !self.inputs_json.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene.CreateSceneRequest", len)?;
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.widgets_json.is_empty() {
            struct_ser.serialize_field("widgetsJson", &self.widgets_json)?;
        }
        if !self.layout_json.is_empty() {
            struct_ser.serialize_field("layoutJson", &self.layout_json)?;
        }
        if !self.created_by_type.is_empty() {
            struct_ser.serialize_field("createdByType", &self.created_by_type)?;
        }
        if !self.created_by_ref.is_empty() {
            struct_ser.serialize_field("createdByRef", &self.created_by_ref)?;
        }
        if !self.kind.is_empty() {
            struct_ser.serialize_field("kind", &self.kind)?;
        }
        if !self.behaviors_json.is_empty() {
            struct_ser.serialize_field("behaviorsJson", &self.behaviors_json)?;
        }
        if !self.inputs_json.is_empty() {
            struct_ser.serialize_field("inputsJson", &self.inputs_json)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CreateSceneRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "name",
            "description",
            "widgets_json",
            "widgetsJson",
            "layout_json",
            "layoutJson",
            "created_by_type",
            "createdByType",
            "created_by_ref",
            "createdByRef",
            "kind",
            "behaviors_json",
            "behaviorsJson",
            "inputs_json",
            "inputsJson",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Name,
            Description,
            WidgetsJson,
            LayoutJson,
            CreatedByType,
            CreatedByRef,
            Kind,
            BehaviorsJson,
            InputsJson,
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
                            "widgetsJson" | "widgets_json" => Ok(GeneratedField::WidgetsJson),
                            "layoutJson" | "layout_json" => Ok(GeneratedField::LayoutJson),
                            "createdByType" | "created_by_type" => Ok(GeneratedField::CreatedByType),
                            "createdByRef" | "created_by_ref" => Ok(GeneratedField::CreatedByRef),
                            "kind" => Ok(GeneratedField::Kind),
                            "behaviorsJson" | "behaviors_json" => Ok(GeneratedField::BehaviorsJson),
                            "inputsJson" | "inputs_json" => Ok(GeneratedField::InputsJson),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CreateSceneRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene.CreateSceneRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CreateSceneRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut name__ = None;
                let mut description__ = None;
                let mut widgets_json__ = None;
                let mut layout_json__ = None;
                let mut created_by_type__ = None;
                let mut created_by_ref__ = None;
                let mut kind__ = None;
                let mut behaviors_json__ = None;
                let mut inputs_json__ = None;
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
                        GeneratedField::WidgetsJson => {
                            if widgets_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("widgetsJson"));
                            }
                            widgets_json__ = Some(map_.next_value()?);
                        }
                        GeneratedField::LayoutJson => {
                            if layout_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("layoutJson"));
                            }
                            layout_json__ = Some(map_.next_value()?);
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
                        GeneratedField::Kind => {
                            if kind__.is_some() {
                                return Err(serde::de::Error::duplicate_field("kind"));
                            }
                            kind__ = Some(map_.next_value()?);
                        }
                        GeneratedField::BehaviorsJson => {
                            if behaviors_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("behaviorsJson"));
                            }
                            behaviors_json__ = Some(map_.next_value()?);
                        }
                        GeneratedField::InputsJson => {
                            if inputs_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("inputsJson"));
                            }
                            inputs_json__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(CreateSceneRequest {
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    widgets_json: widgets_json__.unwrap_or_default(),
                    layout_json: layout_json__.unwrap_or_default(),
                    created_by_type: created_by_type__.unwrap_or_default(),
                    created_by_ref: created_by_ref__.unwrap_or_default(),
                    kind: kind__.unwrap_or_default(),
                    behaviors_json: behaviors_json__.unwrap_or_default(),
                    inputs_json: inputs_json__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("scene.CreateSceneRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DeleteSceneRequest {
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
        let mut struct_ser = serializer.serialize_struct("scene.DeleteSceneRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DeleteSceneRequest {
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
            type Value = DeleteSceneRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene.DeleteSceneRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DeleteSceneRequest, V::Error>
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
                Ok(DeleteSceneRequest {
                    id: id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("scene.DeleteSceneRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetSceneRequest {
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
        let mut struct_ser = serializer.serialize_struct("scene.GetSceneRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetSceneRequest {
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
            type Value = GetSceneRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene.GetSceneRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetSceneRequest, V::Error>
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
                Ok(GetSceneRequest {
                    id: id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("scene.GetSceneRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListCompositionLinksRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.composition_id.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene.ListCompositionLinksRequest", len)?;
        if !self.composition_id.is_empty() {
            struct_ser.serialize_field("compositionId", &self.composition_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListCompositionLinksRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "composition_id",
            "compositionId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            CompositionId,
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
                            "compositionId" | "composition_id" => Ok(GeneratedField::CompositionId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListCompositionLinksRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene.ListCompositionLinksRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListCompositionLinksRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut composition_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::CompositionId => {
                            if composition_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("compositionId"));
                            }
                            composition_id__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListCompositionLinksRequest {
                    composition_id: composition_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("scene.ListCompositionLinksRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListScenesRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.page != 0 {
            len += 1;
        }
        if self.page_size != 0 {
            len += 1;
        }
        if !self.sort_by.is_empty() {
            len += 1;
        }
        if self.sort_desc {
            len += 1;
        }
        if !self.kind.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene.ListScenesRequest", len)?;
        if self.page != 0 {
            struct_ser.serialize_field("page", &self.page)?;
        }
        if self.page_size != 0 {
            struct_ser.serialize_field("pageSize", &self.page_size)?;
        }
        if !self.sort_by.is_empty() {
            struct_ser.serialize_field("sortBy", &self.sort_by)?;
        }
        if self.sort_desc {
            struct_ser.serialize_field("sortDesc", &self.sort_desc)?;
        }
        if !self.kind.is_empty() {
            struct_ser.serialize_field("kind", &self.kind)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListScenesRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "page",
            "page_size",
            "pageSize",
            "sort_by",
            "sortBy",
            "sort_desc",
            "sortDesc",
            "kind",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Page,
            PageSize,
            SortBy,
            SortDesc,
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
                            "page" => Ok(GeneratedField::Page),
                            "pageSize" | "page_size" => Ok(GeneratedField::PageSize),
                            "sortBy" | "sort_by" => Ok(GeneratedField::SortBy),
                            "sortDesc" | "sort_desc" => Ok(GeneratedField::SortDesc),
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
            type Value = ListScenesRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene.ListScenesRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListScenesRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut page__ = None;
                let mut page_size__ = None;
                let mut sort_by__ = None;
                let mut sort_desc__ = None;
                let mut kind__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Page => {
                            if page__.is_some() {
                                return Err(serde::de::Error::duplicate_field("page"));
                            }
                            page__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::PageSize => {
                            if page_size__.is_some() {
                                return Err(serde::de::Error::duplicate_field("pageSize"));
                            }
                            page_size__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::SortBy => {
                            if sort_by__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sortBy"));
                            }
                            sort_by__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SortDesc => {
                            if sort_desc__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sortDesc"));
                            }
                            sort_desc__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Kind => {
                            if kind__.is_some() {
                                return Err(serde::de::Error::duplicate_field("kind"));
                            }
                            kind__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListScenesRequest {
                    page: page__.unwrap_or_default(),
                    page_size: page_size__.unwrap_or_default(),
                    sort_by: sort_by__.unwrap_or_default(),
                    sort_desc: sort_desc__.unwrap_or_default(),
                    kind: kind__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("scene.ListScenesRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListScenesResponse {
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
        if !self.scenes.is_empty() {
            len += 1;
        }
        if self.total_count != 0 {
            len += 1;
        }
        if self.page != 0 {
            len += 1;
        }
        if self.page_size != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene.ListScenesResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.scenes.is_empty() {
            struct_ser.serialize_field("scenes", &self.scenes)?;
        }
        if self.total_count != 0 {
            struct_ser.serialize_field("totalCount", &self.total_count)?;
        }
        if self.page != 0 {
            struct_ser.serialize_field("page", &self.page)?;
        }
        if self.page_size != 0 {
            struct_ser.serialize_field("pageSize", &self.page_size)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListScenesResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "scenes",
            "total_count",
            "totalCount",
            "page",
            "page_size",
            "pageSize",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Scenes,
            TotalCount,
            Page,
            PageSize,
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
                            "scenes" => Ok(GeneratedField::Scenes),
                            "totalCount" | "total_count" => Ok(GeneratedField::TotalCount),
                            "page" => Ok(GeneratedField::Page),
                            "pageSize" | "page_size" => Ok(GeneratedField::PageSize),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListScenesResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene.ListScenesResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListScenesResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut scenes__ = None;
                let mut total_count__ = None;
                let mut page__ = None;
                let mut page_size__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Scenes => {
                            if scenes__.is_some() {
                                return Err(serde::de::Error::duplicate_field("scenes"));
                            }
                            scenes__ = Some(map_.next_value()?);
                        }
                        GeneratedField::TotalCount => {
                            if total_count__.is_some() {
                                return Err(serde::de::Error::duplicate_field("totalCount"));
                            }
                            total_count__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Page => {
                            if page__.is_some() {
                                return Err(serde::de::Error::duplicate_field("page"));
                            }
                            page__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::PageSize => {
                            if page_size__.is_some() {
                                return Err(serde::de::Error::duplicate_field("pageSize"));
                            }
                            page_size__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(ListScenesResponse {
                    status: status__,
                    scenes: scenes__.unwrap_or_default(),
                    total_count: total_count__.unwrap_or_default(),
                    page: page__.unwrap_or_default(),
                    page_size: page_size__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("scene.ListScenesResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for Scene {
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
        if !self.widgets_json.is_empty() {
            len += 1;
        }
        if !self.layout_json.is_empty() {
            len += 1;
        }
        if !self.created_by_type.is_empty() {
            len += 1;
        }
        if !self.created_by_ref.is_empty() {
            len += 1;
        }
        if self.created_at.is_some() {
            len += 1;
        }
        if self.updated_at.is_some() {
            len += 1;
        }
        if !self.draft_widgets_json.is_empty() {
            len += 1;
        }
        if !self.draft_layout_json.is_empty() {
            len += 1;
        }
        if self.has_draft {
            len += 1;
        }
        if !self.editor_state_json.is_empty() {
            len += 1;
        }
        if !self.kind.is_empty() {
            len += 1;
        }
        if !self.behaviors_json.is_empty() {
            len += 1;
        }
        if !self.draft_behaviors_json.is_empty() {
            len += 1;
        }
        if !self.inputs_json.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene.Scene", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.widgets_json.is_empty() {
            struct_ser.serialize_field("widgetsJson", &self.widgets_json)?;
        }
        if !self.layout_json.is_empty() {
            struct_ser.serialize_field("layoutJson", &self.layout_json)?;
        }
        if !self.created_by_type.is_empty() {
            struct_ser.serialize_field("createdByType", &self.created_by_type)?;
        }
        if !self.created_by_ref.is_empty() {
            struct_ser.serialize_field("createdByRef", &self.created_by_ref)?;
        }
        if let Some(v) = self.created_at.as_ref() {
            struct_ser.serialize_field("createdAt", v)?;
        }
        if let Some(v) = self.updated_at.as_ref() {
            struct_ser.serialize_field("updatedAt", v)?;
        }
        if !self.draft_widgets_json.is_empty() {
            struct_ser.serialize_field("draftWidgetsJson", &self.draft_widgets_json)?;
        }
        if !self.draft_layout_json.is_empty() {
            struct_ser.serialize_field("draftLayoutJson", &self.draft_layout_json)?;
        }
        if self.has_draft {
            struct_ser.serialize_field("hasDraft", &self.has_draft)?;
        }
        if !self.editor_state_json.is_empty() {
            struct_ser.serialize_field("editorStateJson", &self.editor_state_json)?;
        }
        if !self.kind.is_empty() {
            struct_ser.serialize_field("kind", &self.kind)?;
        }
        if !self.behaviors_json.is_empty() {
            struct_ser.serialize_field("behaviorsJson", &self.behaviors_json)?;
        }
        if !self.draft_behaviors_json.is_empty() {
            struct_ser.serialize_field("draftBehaviorsJson", &self.draft_behaviors_json)?;
        }
        if !self.inputs_json.is_empty() {
            struct_ser.serialize_field("inputsJson", &self.inputs_json)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Scene {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "name",
            "description",
            "widgets_json",
            "widgetsJson",
            "layout_json",
            "layoutJson",
            "created_by_type",
            "createdByType",
            "created_by_ref",
            "createdByRef",
            "created_at",
            "createdAt",
            "updated_at",
            "updatedAt",
            "draft_widgets_json",
            "draftWidgetsJson",
            "draft_layout_json",
            "draftLayoutJson",
            "has_draft",
            "hasDraft",
            "editor_state_json",
            "editorStateJson",
            "kind",
            "behaviors_json",
            "behaviorsJson",
            "draft_behaviors_json",
            "draftBehaviorsJson",
            "inputs_json",
            "inputsJson",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Name,
            Description,
            WidgetsJson,
            LayoutJson,
            CreatedByType,
            CreatedByRef,
            CreatedAt,
            UpdatedAt,
            DraftWidgetsJson,
            DraftLayoutJson,
            HasDraft,
            EditorStateJson,
            Kind,
            BehaviorsJson,
            DraftBehaviorsJson,
            InputsJson,
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
                            "widgetsJson" | "widgets_json" => Ok(GeneratedField::WidgetsJson),
                            "layoutJson" | "layout_json" => Ok(GeneratedField::LayoutJson),
                            "createdByType" | "created_by_type" => Ok(GeneratedField::CreatedByType),
                            "createdByRef" | "created_by_ref" => Ok(GeneratedField::CreatedByRef),
                            "createdAt" | "created_at" => Ok(GeneratedField::CreatedAt),
                            "updatedAt" | "updated_at" => Ok(GeneratedField::UpdatedAt),
                            "draftWidgetsJson" | "draft_widgets_json" => Ok(GeneratedField::DraftWidgetsJson),
                            "draftLayoutJson" | "draft_layout_json" => Ok(GeneratedField::DraftLayoutJson),
                            "hasDraft" | "has_draft" => Ok(GeneratedField::HasDraft),
                            "editorStateJson" | "editor_state_json" => Ok(GeneratedField::EditorStateJson),
                            "kind" => Ok(GeneratedField::Kind),
                            "behaviorsJson" | "behaviors_json" => Ok(GeneratedField::BehaviorsJson),
                            "draftBehaviorsJson" | "draft_behaviors_json" => Ok(GeneratedField::DraftBehaviorsJson),
                            "inputsJson" | "inputs_json" => Ok(GeneratedField::InputsJson),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = Scene;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene.Scene")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Scene, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut name__ = None;
                let mut description__ = None;
                let mut widgets_json__ = None;
                let mut layout_json__ = None;
                let mut created_by_type__ = None;
                let mut created_by_ref__ = None;
                let mut created_at__ = None;
                let mut updated_at__ = None;
                let mut draft_widgets_json__ = None;
                let mut draft_layout_json__ = None;
                let mut has_draft__ = None;
                let mut editor_state_json__ = None;
                let mut kind__ = None;
                let mut behaviors_json__ = None;
                let mut draft_behaviors_json__ = None;
                let mut inputs_json__ = None;
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
                        GeneratedField::WidgetsJson => {
                            if widgets_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("widgetsJson"));
                            }
                            widgets_json__ = Some(map_.next_value()?);
                        }
                        GeneratedField::LayoutJson => {
                            if layout_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("layoutJson"));
                            }
                            layout_json__ = Some(map_.next_value()?);
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
                        GeneratedField::DraftWidgetsJson => {
                            if draft_widgets_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("draftWidgetsJson"));
                            }
                            draft_widgets_json__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DraftLayoutJson => {
                            if draft_layout_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("draftLayoutJson"));
                            }
                            draft_layout_json__ = Some(map_.next_value()?);
                        }
                        GeneratedField::HasDraft => {
                            if has_draft__.is_some() {
                                return Err(serde::de::Error::duplicate_field("hasDraft"));
                            }
                            has_draft__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EditorStateJson => {
                            if editor_state_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("editorStateJson"));
                            }
                            editor_state_json__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Kind => {
                            if kind__.is_some() {
                                return Err(serde::de::Error::duplicate_field("kind"));
                            }
                            kind__ = Some(map_.next_value()?);
                        }
                        GeneratedField::BehaviorsJson => {
                            if behaviors_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("behaviorsJson"));
                            }
                            behaviors_json__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DraftBehaviorsJson => {
                            if draft_behaviors_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("draftBehaviorsJson"));
                            }
                            draft_behaviors_json__ = Some(map_.next_value()?);
                        }
                        GeneratedField::InputsJson => {
                            if inputs_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("inputsJson"));
                            }
                            inputs_json__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(Scene {
                    id: id__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    widgets_json: widgets_json__.unwrap_or_default(),
                    layout_json: layout_json__.unwrap_or_default(),
                    created_by_type: created_by_type__.unwrap_or_default(),
                    created_by_ref: created_by_ref__.unwrap_or_default(),
                    created_at: created_at__,
                    updated_at: updated_at__,
                    draft_widgets_json: draft_widgets_json__.unwrap_or_default(),
                    draft_layout_json: draft_layout_json__.unwrap_or_default(),
                    has_draft: has_draft__.unwrap_or_default(),
                    editor_state_json: editor_state_json__.unwrap_or_default(),
                    kind: kind__.unwrap_or_default(),
                    behaviors_json: behaviors_json__.unwrap_or_default(),
                    draft_behaviors_json: draft_behaviors_json__.unwrap_or_default(),
                    inputs_json: inputs_json__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("scene.Scene", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SceneResponse {
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
        if self.scene.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene.SceneResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.scene.as_ref() {
            struct_ser.serialize_field("scene", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SceneResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "scene",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Scene,
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
                            "scene" => Ok(GeneratedField::Scene),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = SceneResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene.SceneResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SceneResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut scene__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Scene => {
                            if scene__.is_some() {
                                return Err(serde::de::Error::duplicate_field("scene"));
                            }
                            scene__ = map_.next_value()?;
                        }
                    }
                }
                Ok(SceneResponse {
                    status: status__,
                    scene: scene__,
                })
            }
        }
        deserializer.deserialize_struct("scene.SceneResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for UpdateSceneRequest {
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
        if !self.widgets_json.is_empty() {
            len += 1;
        }
        if !self.layout_json.is_empty() {
            len += 1;
        }
        if !self.draft_widgets_json.is_empty() {
            len += 1;
        }
        if !self.draft_layout_json.is_empty() {
            len += 1;
        }
        if self.clear_draft {
            len += 1;
        }
        if !self.editor_state_json.is_empty() {
            len += 1;
        }
        if self.clear_editor_state {
            len += 1;
        }
        if !self.behaviors_json.is_empty() {
            len += 1;
        }
        if !self.draft_behaviors_json.is_empty() {
            len += 1;
        }
        if !self.inputs_json.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("scene.UpdateSceneRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.widgets_json.is_empty() {
            struct_ser.serialize_field("widgetsJson", &self.widgets_json)?;
        }
        if !self.layout_json.is_empty() {
            struct_ser.serialize_field("layoutJson", &self.layout_json)?;
        }
        if !self.draft_widgets_json.is_empty() {
            struct_ser.serialize_field("draftWidgetsJson", &self.draft_widgets_json)?;
        }
        if !self.draft_layout_json.is_empty() {
            struct_ser.serialize_field("draftLayoutJson", &self.draft_layout_json)?;
        }
        if self.clear_draft {
            struct_ser.serialize_field("clearDraft", &self.clear_draft)?;
        }
        if !self.editor_state_json.is_empty() {
            struct_ser.serialize_field("editorStateJson", &self.editor_state_json)?;
        }
        if self.clear_editor_state {
            struct_ser.serialize_field("clearEditorState", &self.clear_editor_state)?;
        }
        if !self.behaviors_json.is_empty() {
            struct_ser.serialize_field("behaviorsJson", &self.behaviors_json)?;
        }
        if !self.draft_behaviors_json.is_empty() {
            struct_ser.serialize_field("draftBehaviorsJson", &self.draft_behaviors_json)?;
        }
        if !self.inputs_json.is_empty() {
            struct_ser.serialize_field("inputsJson", &self.inputs_json)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for UpdateSceneRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "name",
            "description",
            "widgets_json",
            "widgetsJson",
            "layout_json",
            "layoutJson",
            "draft_widgets_json",
            "draftWidgetsJson",
            "draft_layout_json",
            "draftLayoutJson",
            "clear_draft",
            "clearDraft",
            "editor_state_json",
            "editorStateJson",
            "clear_editor_state",
            "clearEditorState",
            "behaviors_json",
            "behaviorsJson",
            "draft_behaviors_json",
            "draftBehaviorsJson",
            "inputs_json",
            "inputsJson",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Name,
            Description,
            WidgetsJson,
            LayoutJson,
            DraftWidgetsJson,
            DraftLayoutJson,
            ClearDraft,
            EditorStateJson,
            ClearEditorState,
            BehaviorsJson,
            DraftBehaviorsJson,
            InputsJson,
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
                            "widgetsJson" | "widgets_json" => Ok(GeneratedField::WidgetsJson),
                            "layoutJson" | "layout_json" => Ok(GeneratedField::LayoutJson),
                            "draftWidgetsJson" | "draft_widgets_json" => Ok(GeneratedField::DraftWidgetsJson),
                            "draftLayoutJson" | "draft_layout_json" => Ok(GeneratedField::DraftLayoutJson),
                            "clearDraft" | "clear_draft" => Ok(GeneratedField::ClearDraft),
                            "editorStateJson" | "editor_state_json" => Ok(GeneratedField::EditorStateJson),
                            "clearEditorState" | "clear_editor_state" => Ok(GeneratedField::ClearEditorState),
                            "behaviorsJson" | "behaviors_json" => Ok(GeneratedField::BehaviorsJson),
                            "draftBehaviorsJson" | "draft_behaviors_json" => Ok(GeneratedField::DraftBehaviorsJson),
                            "inputsJson" | "inputs_json" => Ok(GeneratedField::InputsJson),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = UpdateSceneRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct scene.UpdateSceneRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<UpdateSceneRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut name__ = None;
                let mut description__ = None;
                let mut widgets_json__ = None;
                let mut layout_json__ = None;
                let mut draft_widgets_json__ = None;
                let mut draft_layout_json__ = None;
                let mut clear_draft__ = None;
                let mut editor_state_json__ = None;
                let mut clear_editor_state__ = None;
                let mut behaviors_json__ = None;
                let mut draft_behaviors_json__ = None;
                let mut inputs_json__ = None;
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
                        GeneratedField::WidgetsJson => {
                            if widgets_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("widgetsJson"));
                            }
                            widgets_json__ = Some(map_.next_value()?);
                        }
                        GeneratedField::LayoutJson => {
                            if layout_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("layoutJson"));
                            }
                            layout_json__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DraftWidgetsJson => {
                            if draft_widgets_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("draftWidgetsJson"));
                            }
                            draft_widgets_json__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DraftLayoutJson => {
                            if draft_layout_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("draftLayoutJson"));
                            }
                            draft_layout_json__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ClearDraft => {
                            if clear_draft__.is_some() {
                                return Err(serde::de::Error::duplicate_field("clearDraft"));
                            }
                            clear_draft__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EditorStateJson => {
                            if editor_state_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("editorStateJson"));
                            }
                            editor_state_json__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ClearEditorState => {
                            if clear_editor_state__.is_some() {
                                return Err(serde::de::Error::duplicate_field("clearEditorState"));
                            }
                            clear_editor_state__ = Some(map_.next_value()?);
                        }
                        GeneratedField::BehaviorsJson => {
                            if behaviors_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("behaviorsJson"));
                            }
                            behaviors_json__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DraftBehaviorsJson => {
                            if draft_behaviors_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("draftBehaviorsJson"));
                            }
                            draft_behaviors_json__ = Some(map_.next_value()?);
                        }
                        GeneratedField::InputsJson => {
                            if inputs_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("inputsJson"));
                            }
                            inputs_json__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(UpdateSceneRequest {
                    id: id__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    widgets_json: widgets_json__.unwrap_or_default(),
                    layout_json: layout_json__.unwrap_or_default(),
                    draft_widgets_json: draft_widgets_json__.unwrap_or_default(),
                    draft_layout_json: draft_layout_json__.unwrap_or_default(),
                    clear_draft: clear_draft__.unwrap_or_default(),
                    editor_state_json: editor_state_json__.unwrap_or_default(),
                    clear_editor_state: clear_editor_state__.unwrap_or_default(),
                    behaviors_json: behaviors_json__.unwrap_or_default(),
                    draft_behaviors_json: draft_behaviors_json__.unwrap_or_default(),
                    inputs_json: inputs_json__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("scene.UpdateSceneRequest", FIELDS, GeneratedVisitor)
    }
}
