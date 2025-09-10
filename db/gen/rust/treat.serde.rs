// @generated
impl serde::Serialize for AwardTreatRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.user_id.is_empty() {
            len += 1;
        }
        if !self.treat_type.is_empty() {
            len += 1;
        }
        if !self.title.is_empty() {
            len += 1;
        }
        if !self.description.is_empty() {
            len += 1;
        }
        if self.points != 0 {
            len += 1;
        }
        if !self.image_url.is_empty() {
            len += 1;
        }
        if !self.awarded_by.is_empty() {
            len += 1;
        }
        if !self.application_id.is_empty() {
            len += 1;
        }
        if !self.metadata.is_empty() {
            len += 1;
        }
        if self.expires_at.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("treat.AwardTreatRequest", len)?;
        if !self.user_id.is_empty() {
            struct_ser.serialize_field("userId", &self.user_id)?;
        }
        if !self.treat_type.is_empty() {
            struct_ser.serialize_field("treatType", &self.treat_type)?;
        }
        if !self.title.is_empty() {
            struct_ser.serialize_field("title", &self.title)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if self.points != 0 {
            struct_ser.serialize_field("points", &self.points)?;
        }
        if !self.image_url.is_empty() {
            struct_ser.serialize_field("imageUrl", &self.image_url)?;
        }
        if !self.awarded_by.is_empty() {
            struct_ser.serialize_field("awardedBy", &self.awarded_by)?;
        }
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if !self.metadata.is_empty() {
            struct_ser.serialize_field("metadata", &self.metadata)?;
        }
        if let Some(v) = self.expires_at.as_ref() {
            struct_ser.serialize_field("expiresAt", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for AwardTreatRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "user_id",
            "userId",
            "treat_type",
            "treatType",
            "title",
            "description",
            "points",
            "image_url",
            "imageUrl",
            "awarded_by",
            "awardedBy",
            "application_id",
            "applicationId",
            "metadata",
            "expires_at",
            "expiresAt",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            UserId,
            TreatType,
            Title,
            Description,
            Points,
            ImageUrl,
            AwardedBy,
            ApplicationId,
            Metadata,
            ExpiresAt,
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
                            "userId" | "user_id" => Ok(GeneratedField::UserId),
                            "treatType" | "treat_type" => Ok(GeneratedField::TreatType),
                            "title" => Ok(GeneratedField::Title),
                            "description" => Ok(GeneratedField::Description),
                            "points" => Ok(GeneratedField::Points),
                            "imageUrl" | "image_url" => Ok(GeneratedField::ImageUrl),
                            "awardedBy" | "awarded_by" => Ok(GeneratedField::AwardedBy),
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            "metadata" => Ok(GeneratedField::Metadata),
                            "expiresAt" | "expires_at" => Ok(GeneratedField::ExpiresAt),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = AwardTreatRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct treat.AwardTreatRequest")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<AwardTreatRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut user_id__ = None;
                let mut treat_type__ = None;
                let mut title__ = None;
                let mut description__ = None;
                let mut points__ = None;
                let mut image_url__ = None;
                let mut awarded_by__ = None;
                let mut application_id__ = None;
                let mut metadata__ = None;
                let mut expires_at__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::UserId => {
                            if user_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("userId"));
                            }
                            user_id__ = Some(map.next_value()?);
                        }
                        GeneratedField::TreatType => {
                            if treat_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("treatType"));
                            }
                            treat_type__ = Some(map.next_value()?);
                        }
                        GeneratedField::Title => {
                            if title__.is_some() {
                                return Err(serde::de::Error::duplicate_field("title"));
                            }
                            title__ = Some(map.next_value()?);
                        }
                        GeneratedField::Description => {
                            if description__.is_some() {
                                return Err(serde::de::Error::duplicate_field("description"));
                            }
                            description__ = Some(map.next_value()?);
                        }
                        GeneratedField::Points => {
                            if points__.is_some() {
                                return Err(serde::de::Error::duplicate_field("points"));
                            }
                            points__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::ImageUrl => {
                            if image_url__.is_some() {
                                return Err(serde::de::Error::duplicate_field("imageUrl"));
                            }
                            image_url__ = Some(map.next_value()?);
                        }
                        GeneratedField::AwardedBy => {
                            if awarded_by__.is_some() {
                                return Err(serde::de::Error::duplicate_field("awardedBy"));
                            }
                            awarded_by__ = Some(map.next_value()?);
                        }
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map.next_value()?);
                        }
                        GeneratedField::Metadata => {
                            if metadata__.is_some() {
                                return Err(serde::de::Error::duplicate_field("metadata"));
                            }
                            metadata__ = Some(
                                map.next_value::<std::collections::HashMap<_, _>>()?
                            );
                        }
                        GeneratedField::ExpiresAt => {
                            if expires_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("expiresAt"));
                            }
                            expires_at__ = map.next_value()?;
                        }
                    }
                }
                Ok(AwardTreatRequest {
                    user_id: user_id__.unwrap_or_default(),
                    treat_type: treat_type__.unwrap_or_default(),
                    title: title__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    points: points__.unwrap_or_default(),
                    image_url: image_url__.unwrap_or_default(),
                    awarded_by: awarded_by__.unwrap_or_default(),
                    application_id: application_id__.unwrap_or_default(),
                    metadata: metadata__.unwrap_or_default(),
                    expires_at: expires_at__,
                })
            }
        }
        deserializer.deserialize_struct("treat.AwardTreatRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DeleteTreatRequest {
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
        let mut struct_ser = serializer.serialize_struct("treat.DeleteTreatRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DeleteTreatRequest {
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
            type Value = DeleteTreatRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct treat.DeleteTreatRequest")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<DeleteTreatRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map.next_value()?);
                        }
                    }
                }
                Ok(DeleteTreatRequest {
                    id: id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("treat.DeleteTreatRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetTreatRequest {
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
        let mut struct_ser = serializer.serialize_struct("treat.GetTreatRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetTreatRequest {
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
            type Value = GetTreatRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct treat.GetTreatRequest")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<GetTreatRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map.next_value()?);
                        }
                    }
                }
                Ok(GetTreatRequest {
                    id: id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("treat.GetTreatRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetTreatStatsRequest {
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
        if self.from_date.is_some() {
            len += 1;
        }
        if self.to_date.is_some() {
            len += 1;
        }
        if !self.group_by.is_empty() {
            len += 1;
        }
        if !self.user_ids.is_empty() {
            len += 1;
        }
        if !self.treat_types.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("treat.GetTreatStatsRequest", len)?;
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if let Some(v) = self.from_date.as_ref() {
            struct_ser.serialize_field("fromDate", v)?;
        }
        if let Some(v) = self.to_date.as_ref() {
            struct_ser.serialize_field("toDate", v)?;
        }
        if !self.group_by.is_empty() {
            struct_ser.serialize_field("groupBy", &self.group_by)?;
        }
        if !self.user_ids.is_empty() {
            struct_ser.serialize_field("userIds", &self.user_ids)?;
        }
        if !self.treat_types.is_empty() {
            struct_ser.serialize_field("treatTypes", &self.treat_types)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetTreatStatsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "application_id",
            "applicationId",
            "from_date",
            "fromDate",
            "to_date",
            "toDate",
            "group_by",
            "groupBy",
            "user_ids",
            "userIds",
            "treat_types",
            "treatTypes",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ApplicationId,
            FromDate,
            ToDate,
            GroupBy,
            UserIds,
            TreatTypes,
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
                            "fromDate" | "from_date" => Ok(GeneratedField::FromDate),
                            "toDate" | "to_date" => Ok(GeneratedField::ToDate),
                            "groupBy" | "group_by" => Ok(GeneratedField::GroupBy),
                            "userIds" | "user_ids" => Ok(GeneratedField::UserIds),
                            "treatTypes" | "treat_types" => Ok(GeneratedField::TreatTypes),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetTreatStatsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct treat.GetTreatStatsRequest")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<GetTreatStatsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut application_id__ = None;
                let mut from_date__ = None;
                let mut to_date__ = None;
                let mut group_by__ = None;
                let mut user_ids__ = None;
                let mut treat_types__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map.next_value()?);
                        }
                        GeneratedField::FromDate => {
                            if from_date__.is_some() {
                                return Err(serde::de::Error::duplicate_field("fromDate"));
                            }
                            from_date__ = map.next_value()?;
                        }
                        GeneratedField::ToDate => {
                            if to_date__.is_some() {
                                return Err(serde::de::Error::duplicate_field("toDate"));
                            }
                            to_date__ = map.next_value()?;
                        }
                        GeneratedField::GroupBy => {
                            if group_by__.is_some() {
                                return Err(serde::de::Error::duplicate_field("groupBy"));
                            }
                            group_by__ = Some(map.next_value()?);
                        }
                        GeneratedField::UserIds => {
                            if user_ids__.is_some() {
                                return Err(serde::de::Error::duplicate_field("userIds"));
                            }
                            user_ids__ = Some(map.next_value()?);
                        }
                        GeneratedField::TreatTypes => {
                            if treat_types__.is_some() {
                                return Err(serde::de::Error::duplicate_field("treatTypes"));
                            }
                            treat_types__ = Some(map.next_value()?);
                        }
                    }
                }
                Ok(GetTreatStatsRequest {
                    application_id: application_id__.unwrap_or_default(),
                    from_date: from_date__,
                    to_date: to_date__,
                    group_by: group_by__.unwrap_or_default(),
                    user_ids: user_ids__.unwrap_or_default(),
                    treat_types: treat_types__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("treat.GetTreatStatsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetUserTreatsSummaryRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.user_id.is_empty() {
            len += 1;
        }
        if !self.application_id.is_empty() {
            len += 1;
        }
        if self.from_date.is_some() {
            len += 1;
        }
        if self.to_date.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("treat.GetUserTreatsSummaryRequest", len)?;
        if !self.user_id.is_empty() {
            struct_ser.serialize_field("userId", &self.user_id)?;
        }
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if let Some(v) = self.from_date.as_ref() {
            struct_ser.serialize_field("fromDate", v)?;
        }
        if let Some(v) = self.to_date.as_ref() {
            struct_ser.serialize_field("toDate", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetUserTreatsSummaryRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "user_id",
            "userId",
            "application_id",
            "applicationId",
            "from_date",
            "fromDate",
            "to_date",
            "toDate",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            UserId,
            ApplicationId,
            FromDate,
            ToDate,
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
                            "userId" | "user_id" => Ok(GeneratedField::UserId),
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            "fromDate" | "from_date" => Ok(GeneratedField::FromDate),
                            "toDate" | "to_date" => Ok(GeneratedField::ToDate),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetUserTreatsSummaryRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct treat.GetUserTreatsSummaryRequest")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<GetUserTreatsSummaryRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut user_id__ = None;
                let mut application_id__ = None;
                let mut from_date__ = None;
                let mut to_date__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::UserId => {
                            if user_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("userId"));
                            }
                            user_id__ = Some(map.next_value()?);
                        }
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map.next_value()?);
                        }
                        GeneratedField::FromDate => {
                            if from_date__.is_some() {
                                return Err(serde::de::Error::duplicate_field("fromDate"));
                            }
                            from_date__ = map.next_value()?;
                        }
                        GeneratedField::ToDate => {
                            if to_date__.is_some() {
                                return Err(serde::de::Error::duplicate_field("toDate"));
                            }
                            to_date__ = map.next_value()?;
                        }
                    }
                }
                Ok(GetUserTreatsSummaryRequest {
                    user_id: user_id__.unwrap_or_default(),
                    application_id: application_id__.unwrap_or_default(),
                    from_date: from_date__,
                    to_date: to_date__,
                })
            }
        }
        deserializer.deserialize_struct("treat.GetUserTreatsSummaryRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListTreatsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.user_id.is_empty() {
            len += 1;
        }
        if !self.treat_type.is_empty() {
            len += 1;
        }
        if !self.application_id.is_empty() {
            len += 1;
        }
        if self.from_date.is_some() {
            len += 1;
        }
        if self.to_date.is_some() {
            len += 1;
        }
        if self.include_expired {
            len += 1;
        }
        if self.min_points != 0 {
            len += 1;
        }
        if self.max_points != 0 {
            len += 1;
        }
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
        let mut struct_ser = serializer.serialize_struct("treat.ListTreatsRequest", len)?;
        if !self.user_id.is_empty() {
            struct_ser.serialize_field("userId", &self.user_id)?;
        }
        if !self.treat_type.is_empty() {
            struct_ser.serialize_field("treatType", &self.treat_type)?;
        }
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if let Some(v) = self.from_date.as_ref() {
            struct_ser.serialize_field("fromDate", v)?;
        }
        if let Some(v) = self.to_date.as_ref() {
            struct_ser.serialize_field("toDate", v)?;
        }
        if self.include_expired {
            struct_ser.serialize_field("includeExpired", &self.include_expired)?;
        }
        if self.min_points != 0 {
            struct_ser.serialize_field("minPoints", &self.min_points)?;
        }
        if self.max_points != 0 {
            struct_ser.serialize_field("maxPoints", &self.max_points)?;
        }
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
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListTreatsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "user_id",
            "userId",
            "treat_type",
            "treatType",
            "application_id",
            "applicationId",
            "from_date",
            "fromDate",
            "to_date",
            "toDate",
            "include_expired",
            "includeExpired",
            "min_points",
            "minPoints",
            "max_points",
            "maxPoints",
            "page",
            "page_size",
            "pageSize",
            "sort_by",
            "sortBy",
            "sort_desc",
            "sortDesc",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            UserId,
            TreatType,
            ApplicationId,
            FromDate,
            ToDate,
            IncludeExpired,
            MinPoints,
            MaxPoints,
            Page,
            PageSize,
            SortBy,
            SortDesc,
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
                            "userId" | "user_id" => Ok(GeneratedField::UserId),
                            "treatType" | "treat_type" => Ok(GeneratedField::TreatType),
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            "fromDate" | "from_date" => Ok(GeneratedField::FromDate),
                            "toDate" | "to_date" => Ok(GeneratedField::ToDate),
                            "includeExpired" | "include_expired" => Ok(GeneratedField::IncludeExpired),
                            "minPoints" | "min_points" => Ok(GeneratedField::MinPoints),
                            "maxPoints" | "max_points" => Ok(GeneratedField::MaxPoints),
                            "page" => Ok(GeneratedField::Page),
                            "pageSize" | "page_size" => Ok(GeneratedField::PageSize),
                            "sortBy" | "sort_by" => Ok(GeneratedField::SortBy),
                            "sortDesc" | "sort_desc" => Ok(GeneratedField::SortDesc),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListTreatsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct treat.ListTreatsRequest")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<ListTreatsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut user_id__ = None;
                let mut treat_type__ = None;
                let mut application_id__ = None;
                let mut from_date__ = None;
                let mut to_date__ = None;
                let mut include_expired__ = None;
                let mut min_points__ = None;
                let mut max_points__ = None;
                let mut page__ = None;
                let mut page_size__ = None;
                let mut sort_by__ = None;
                let mut sort_desc__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::UserId => {
                            if user_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("userId"));
                            }
                            user_id__ = Some(map.next_value()?);
                        }
                        GeneratedField::TreatType => {
                            if treat_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("treatType"));
                            }
                            treat_type__ = Some(map.next_value()?);
                        }
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map.next_value()?);
                        }
                        GeneratedField::FromDate => {
                            if from_date__.is_some() {
                                return Err(serde::de::Error::duplicate_field("fromDate"));
                            }
                            from_date__ = map.next_value()?;
                        }
                        GeneratedField::ToDate => {
                            if to_date__.is_some() {
                                return Err(serde::de::Error::duplicate_field("toDate"));
                            }
                            to_date__ = map.next_value()?;
                        }
                        GeneratedField::IncludeExpired => {
                            if include_expired__.is_some() {
                                return Err(serde::de::Error::duplicate_field("includeExpired"));
                            }
                            include_expired__ = Some(map.next_value()?);
                        }
                        GeneratedField::MinPoints => {
                            if min_points__.is_some() {
                                return Err(serde::de::Error::duplicate_field("minPoints"));
                            }
                            min_points__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::MaxPoints => {
                            if max_points__.is_some() {
                                return Err(serde::de::Error::duplicate_field("maxPoints"));
                            }
                            max_points__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Page => {
                            if page__.is_some() {
                                return Err(serde::de::Error::duplicate_field("page"));
                            }
                            page__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::PageSize => {
                            if page_size__.is_some() {
                                return Err(serde::de::Error::duplicate_field("pageSize"));
                            }
                            page_size__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::SortBy => {
                            if sort_by__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sortBy"));
                            }
                            sort_by__ = Some(map.next_value()?);
                        }
                        GeneratedField::SortDesc => {
                            if sort_desc__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sortDesc"));
                            }
                            sort_desc__ = Some(map.next_value()?);
                        }
                    }
                }
                Ok(ListTreatsRequest {
                    user_id: user_id__.unwrap_or_default(),
                    treat_type: treat_type__.unwrap_or_default(),
                    application_id: application_id__.unwrap_or_default(),
                    from_date: from_date__,
                    to_date: to_date__,
                    include_expired: include_expired__.unwrap_or_default(),
                    min_points: min_points__.unwrap_or_default(),
                    max_points: max_points__.unwrap_or_default(),
                    page: page__.unwrap_or_default(),
                    page_size: page_size__.unwrap_or_default(),
                    sort_by: sort_by__.unwrap_or_default(),
                    sort_desc: sort_desc__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("treat.ListTreatsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListTreatsResponse {
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
        if !self.treats.is_empty() {
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
        let mut struct_ser = serializer.serialize_struct("treat.ListTreatsResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.treats.is_empty() {
            struct_ser.serialize_field("treats", &self.treats)?;
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
impl<'de> serde::Deserialize<'de> for ListTreatsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "treats",
            "total_count",
            "totalCount",
            "page",
            "page_size",
            "pageSize",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Treats,
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
                            "treats" => Ok(GeneratedField::Treats),
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
            type Value = ListTreatsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct treat.ListTreatsResponse")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<ListTreatsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut treats__ = None;
                let mut total_count__ = None;
                let mut page__ = None;
                let mut page_size__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map.next_value()?;
                        }
                        GeneratedField::Treats => {
                            if treats__.is_some() {
                                return Err(serde::de::Error::duplicate_field("treats"));
                            }
                            treats__ = Some(map.next_value()?);
                        }
                        GeneratedField::TotalCount => {
                            if total_count__.is_some() {
                                return Err(serde::de::Error::duplicate_field("totalCount"));
                            }
                            total_count__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Page => {
                            if page__.is_some() {
                                return Err(serde::de::Error::duplicate_field("page"));
                            }
                            page__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::PageSize => {
                            if page_size__.is_some() {
                                return Err(serde::de::Error::duplicate_field("pageSize"));
                            }
                            page_size__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(ListTreatsResponse {
                    status: status__,
                    treats: treats__.unwrap_or_default(),
                    total_count: total_count__.unwrap_or_default(),
                    page: page__.unwrap_or_default(),
                    page_size: page_size__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("treat.ListTreatsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for Treat {
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
        if !self.user_id.is_empty() {
            len += 1;
        }
        if !self.treat_type.is_empty() {
            len += 1;
        }
        if !self.title.is_empty() {
            len += 1;
        }
        if !self.description.is_empty() {
            len += 1;
        }
        if self.points != 0 {
            len += 1;
        }
        if !self.image_url.is_empty() {
            len += 1;
        }
        if !self.awarded_by.is_empty() {
            len += 1;
        }
        if !self.application_id.is_empty() {
            len += 1;
        }
        if !self.metadata.is_empty() {
            len += 1;
        }
        if self.awarded_at.is_some() {
            len += 1;
        }
        if self.expires_at.is_some() {
            len += 1;
        }
        if self.created_at.is_some() {
            len += 1;
        }
        if self.updated_at.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("treat.Treat", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.user_id.is_empty() {
            struct_ser.serialize_field("userId", &self.user_id)?;
        }
        if !self.treat_type.is_empty() {
            struct_ser.serialize_field("treatType", &self.treat_type)?;
        }
        if !self.title.is_empty() {
            struct_ser.serialize_field("title", &self.title)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if self.points != 0 {
            struct_ser.serialize_field("points", &self.points)?;
        }
        if !self.image_url.is_empty() {
            struct_ser.serialize_field("imageUrl", &self.image_url)?;
        }
        if !self.awarded_by.is_empty() {
            struct_ser.serialize_field("awardedBy", &self.awarded_by)?;
        }
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if !self.metadata.is_empty() {
            struct_ser.serialize_field("metadata", &self.metadata)?;
        }
        if let Some(v) = self.awarded_at.as_ref() {
            struct_ser.serialize_field("awardedAt", v)?;
        }
        if let Some(v) = self.expires_at.as_ref() {
            struct_ser.serialize_field("expiresAt", v)?;
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
impl<'de> serde::Deserialize<'de> for Treat {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "user_id",
            "userId",
            "treat_type",
            "treatType",
            "title",
            "description",
            "points",
            "image_url",
            "imageUrl",
            "awarded_by",
            "awardedBy",
            "application_id",
            "applicationId",
            "metadata",
            "awarded_at",
            "awardedAt",
            "expires_at",
            "expiresAt",
            "created_at",
            "createdAt",
            "updated_at",
            "updatedAt",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            UserId,
            TreatType,
            Title,
            Description,
            Points,
            ImageUrl,
            AwardedBy,
            ApplicationId,
            Metadata,
            AwardedAt,
            ExpiresAt,
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
                            "userId" | "user_id" => Ok(GeneratedField::UserId),
                            "treatType" | "treat_type" => Ok(GeneratedField::TreatType),
                            "title" => Ok(GeneratedField::Title),
                            "description" => Ok(GeneratedField::Description),
                            "points" => Ok(GeneratedField::Points),
                            "imageUrl" | "image_url" => Ok(GeneratedField::ImageUrl),
                            "awardedBy" | "awarded_by" => Ok(GeneratedField::AwardedBy),
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            "metadata" => Ok(GeneratedField::Metadata),
                            "awardedAt" | "awarded_at" => Ok(GeneratedField::AwardedAt),
                            "expiresAt" | "expires_at" => Ok(GeneratedField::ExpiresAt),
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
            type Value = Treat;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct treat.Treat")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<Treat, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut user_id__ = None;
                let mut treat_type__ = None;
                let mut title__ = None;
                let mut description__ = None;
                let mut points__ = None;
                let mut image_url__ = None;
                let mut awarded_by__ = None;
                let mut application_id__ = None;
                let mut metadata__ = None;
                let mut awarded_at__ = None;
                let mut expires_at__ = None;
                let mut created_at__ = None;
                let mut updated_at__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map.next_value()?);
                        }
                        GeneratedField::UserId => {
                            if user_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("userId"));
                            }
                            user_id__ = Some(map.next_value()?);
                        }
                        GeneratedField::TreatType => {
                            if treat_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("treatType"));
                            }
                            treat_type__ = Some(map.next_value()?);
                        }
                        GeneratedField::Title => {
                            if title__.is_some() {
                                return Err(serde::de::Error::duplicate_field("title"));
                            }
                            title__ = Some(map.next_value()?);
                        }
                        GeneratedField::Description => {
                            if description__.is_some() {
                                return Err(serde::de::Error::duplicate_field("description"));
                            }
                            description__ = Some(map.next_value()?);
                        }
                        GeneratedField::Points => {
                            if points__.is_some() {
                                return Err(serde::de::Error::duplicate_field("points"));
                            }
                            points__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::ImageUrl => {
                            if image_url__.is_some() {
                                return Err(serde::de::Error::duplicate_field("imageUrl"));
                            }
                            image_url__ = Some(map.next_value()?);
                        }
                        GeneratedField::AwardedBy => {
                            if awarded_by__.is_some() {
                                return Err(serde::de::Error::duplicate_field("awardedBy"));
                            }
                            awarded_by__ = Some(map.next_value()?);
                        }
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map.next_value()?);
                        }
                        GeneratedField::Metadata => {
                            if metadata__.is_some() {
                                return Err(serde::de::Error::duplicate_field("metadata"));
                            }
                            metadata__ = Some(
                                map.next_value::<std::collections::HashMap<_, _>>()?
                            );
                        }
                        GeneratedField::AwardedAt => {
                            if awarded_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("awardedAt"));
                            }
                            awarded_at__ = map.next_value()?;
                        }
                        GeneratedField::ExpiresAt => {
                            if expires_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("expiresAt"));
                            }
                            expires_at__ = map.next_value()?;
                        }
                        GeneratedField::CreatedAt => {
                            if created_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdAt"));
                            }
                            created_at__ = map.next_value()?;
                        }
                        GeneratedField::UpdatedAt => {
                            if updated_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("updatedAt"));
                            }
                            updated_at__ = map.next_value()?;
                        }
                    }
                }
                Ok(Treat {
                    id: id__.unwrap_or_default(),
                    user_id: user_id__.unwrap_or_default(),
                    treat_type: treat_type__.unwrap_or_default(),
                    title: title__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    points: points__.unwrap_or_default(),
                    image_url: image_url__.unwrap_or_default(),
                    awarded_by: awarded_by__.unwrap_or_default(),
                    application_id: application_id__.unwrap_or_default(),
                    metadata: metadata__.unwrap_or_default(),
                    awarded_at: awarded_at__,
                    expires_at: expires_at__,
                    created_at: created_at__,
                    updated_at: updated_at__,
                })
            }
        }
        deserializer.deserialize_struct("treat.Treat", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for TreatResponse {
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
        if self.treat.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("treat.TreatResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.treat.as_ref() {
            struct_ser.serialize_field("treat", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for TreatResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "treat",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Treat,
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
                            "treat" => Ok(GeneratedField::Treat),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = TreatResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct treat.TreatResponse")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<TreatResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut treat__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map.next_value()?;
                        }
                        GeneratedField::Treat => {
                            if treat__.is_some() {
                                return Err(serde::de::Error::duplicate_field("treat"));
                            }
                            treat__ = map.next_value()?;
                        }
                    }
                }
                Ok(TreatResponse {
                    status: status__,
                    treat: treat__,
                })
            }
        }
        deserializer.deserialize_struct("treat.TreatResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for TreatStats {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.data_points.is_empty() {
            len += 1;
        }
        if self.total_treats != 0 {
            len += 1;
        }
        if self.total_points != 0 {
            len += 1;
        }
        if self.unique_users != 0 {
            len += 1;
        }
        if !self.points_by_type.is_empty() {
            len += 1;
        }
        if self.from_date.is_some() {
            len += 1;
        }
        if self.to_date.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("treat.TreatStats", len)?;
        if !self.data_points.is_empty() {
            struct_ser.serialize_field("dataPoints", &self.data_points)?;
        }
        if self.total_treats != 0 {
            struct_ser.serialize_field("totalTreats", &self.total_treats)?;
        }
        if self.total_points != 0 {
            struct_ser.serialize_field("totalPoints", &self.total_points)?;
        }
        if self.unique_users != 0 {
            struct_ser.serialize_field("uniqueUsers", &self.unique_users)?;
        }
        if !self.points_by_type.is_empty() {
            struct_ser.serialize_field("pointsByType", &self.points_by_type)?;
        }
        if let Some(v) = self.from_date.as_ref() {
            struct_ser.serialize_field("fromDate", v)?;
        }
        if let Some(v) = self.to_date.as_ref() {
            struct_ser.serialize_field("toDate", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for TreatStats {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "data_points",
            "dataPoints",
            "total_treats",
            "totalTreats",
            "total_points",
            "totalPoints",
            "unique_users",
            "uniqueUsers",
            "points_by_type",
            "pointsByType",
            "from_date",
            "fromDate",
            "to_date",
            "toDate",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            DataPoints,
            TotalTreats,
            TotalPoints,
            UniqueUsers,
            PointsByType,
            FromDate,
            ToDate,
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
                            "dataPoints" | "data_points" => Ok(GeneratedField::DataPoints),
                            "totalTreats" | "total_treats" => Ok(GeneratedField::TotalTreats),
                            "totalPoints" | "total_points" => Ok(GeneratedField::TotalPoints),
                            "uniqueUsers" | "unique_users" => Ok(GeneratedField::UniqueUsers),
                            "pointsByType" | "points_by_type" => Ok(GeneratedField::PointsByType),
                            "fromDate" | "from_date" => Ok(GeneratedField::FromDate),
                            "toDate" | "to_date" => Ok(GeneratedField::ToDate),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = TreatStats;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct treat.TreatStats")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<TreatStats, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut data_points__ = None;
                let mut total_treats__ = None;
                let mut total_points__ = None;
                let mut unique_users__ = None;
                let mut points_by_type__ = None;
                let mut from_date__ = None;
                let mut to_date__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::DataPoints => {
                            if data_points__.is_some() {
                                return Err(serde::de::Error::duplicate_field("dataPoints"));
                            }
                            data_points__ = Some(map.next_value()?);
                        }
                        GeneratedField::TotalTreats => {
                            if total_treats__.is_some() {
                                return Err(serde::de::Error::duplicate_field("totalTreats"));
                            }
                            total_treats__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::TotalPoints => {
                            if total_points__.is_some() {
                                return Err(serde::de::Error::duplicate_field("totalPoints"));
                            }
                            total_points__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::UniqueUsers => {
                            if unique_users__.is_some() {
                                return Err(serde::de::Error::duplicate_field("uniqueUsers"));
                            }
                            unique_users__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::PointsByType => {
                            if points_by_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("pointsByType"));
                            }
                            points_by_type__ = Some(
                                map.next_value::<std::collections::HashMap<_, ::pbjson::private::NumberDeserialize<i32>>>()?
                                    .into_iter().map(|(k,v)| (k, v.0)).collect()
                            );
                        }
                        GeneratedField::FromDate => {
                            if from_date__.is_some() {
                                return Err(serde::de::Error::duplicate_field("fromDate"));
                            }
                            from_date__ = map.next_value()?;
                        }
                        GeneratedField::ToDate => {
                            if to_date__.is_some() {
                                return Err(serde::de::Error::duplicate_field("toDate"));
                            }
                            to_date__ = map.next_value()?;
                        }
                    }
                }
                Ok(TreatStats {
                    data_points: data_points__.unwrap_or_default(),
                    total_treats: total_treats__.unwrap_or_default(),
                    total_points: total_points__.unwrap_or_default(),
                    unique_users: unique_users__.unwrap_or_default(),
                    points_by_type: points_by_type__.unwrap_or_default(),
                    from_date: from_date__,
                    to_date: to_date__,
                })
            }
        }
        deserializer.deserialize_struct("treat.TreatStats", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for treat_stats::DataPoint {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.label.is_empty() {
            len += 1;
        }
        if self.count != 0 {
            len += 1;
        }
        if self.total_points != 0 {
            len += 1;
        }
        if !self.points_by_type.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("treat.TreatStats.DataPoint", len)?;
        if !self.label.is_empty() {
            struct_ser.serialize_field("label", &self.label)?;
        }
        if self.count != 0 {
            struct_ser.serialize_field("count", &self.count)?;
        }
        if self.total_points != 0 {
            struct_ser.serialize_field("totalPoints", &self.total_points)?;
        }
        if !self.points_by_type.is_empty() {
            struct_ser.serialize_field("pointsByType", &self.points_by_type)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for treat_stats::DataPoint {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "label",
            "count",
            "total_points",
            "totalPoints",
            "points_by_type",
            "pointsByType",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Label,
            Count,
            TotalPoints,
            PointsByType,
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
                            "label" => Ok(GeneratedField::Label),
                            "count" => Ok(GeneratedField::Count),
                            "totalPoints" | "total_points" => Ok(GeneratedField::TotalPoints),
                            "pointsByType" | "points_by_type" => Ok(GeneratedField::PointsByType),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = treat_stats::DataPoint;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct treat.TreatStats.DataPoint")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<treat_stats::DataPoint, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut label__ = None;
                let mut count__ = None;
                let mut total_points__ = None;
                let mut points_by_type__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::Label => {
                            if label__.is_some() {
                                return Err(serde::de::Error::duplicate_field("label"));
                            }
                            label__ = Some(map.next_value()?);
                        }
                        GeneratedField::Count => {
                            if count__.is_some() {
                                return Err(serde::de::Error::duplicate_field("count"));
                            }
                            count__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::TotalPoints => {
                            if total_points__.is_some() {
                                return Err(serde::de::Error::duplicate_field("totalPoints"));
                            }
                            total_points__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::PointsByType => {
                            if points_by_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("pointsByType"));
                            }
                            points_by_type__ = Some(
                                map.next_value::<std::collections::HashMap<_, ::pbjson::private::NumberDeserialize<i32>>>()?
                                    .into_iter().map(|(k,v)| (k, v.0)).collect()
                            );
                        }
                    }
                }
                Ok(treat_stats::DataPoint {
                    label: label__.unwrap_or_default(),
                    count: count__.unwrap_or_default(),
                    total_points: total_points__.unwrap_or_default(),
                    points_by_type: points_by_type__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("treat.TreatStats.DataPoint", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for TreatStatsResponse {
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
        if self.stats.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("treat.TreatStatsResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.stats.as_ref() {
            struct_ser.serialize_field("stats", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for TreatStatsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "stats",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Stats,
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
                            "stats" => Ok(GeneratedField::Stats),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = TreatStatsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct treat.TreatStatsResponse")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<TreatStatsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut stats__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map.next_value()?;
                        }
                        GeneratedField::Stats => {
                            if stats__.is_some() {
                                return Err(serde::de::Error::duplicate_field("stats"));
                            }
                            stats__ = map.next_value()?;
                        }
                    }
                }
                Ok(TreatStatsResponse {
                    status: status__,
                    stats: stats__,
                })
            }
        }
        deserializer.deserialize_struct("treat.TreatStatsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for TreatsSummary {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.user_id.is_empty() {
            len += 1;
        }
        if self.total_treats != 0 {
            len += 1;
        }
        if self.total_points != 0 {
            len += 1;
        }
        if !self.points_by_type.is_empty() {
            len += 1;
        }
        if !self.recent_treats.is_empty() {
            len += 1;
        }
        if self.from_date.is_some() {
            len += 1;
        }
        if self.to_date.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("treat.TreatsSummary", len)?;
        if !self.user_id.is_empty() {
            struct_ser.serialize_field("userId", &self.user_id)?;
        }
        if self.total_treats != 0 {
            struct_ser.serialize_field("totalTreats", &self.total_treats)?;
        }
        if self.total_points != 0 {
            struct_ser.serialize_field("totalPoints", &self.total_points)?;
        }
        if !self.points_by_type.is_empty() {
            struct_ser.serialize_field("pointsByType", &self.points_by_type)?;
        }
        if !self.recent_treats.is_empty() {
            struct_ser.serialize_field("recentTreats", &self.recent_treats)?;
        }
        if let Some(v) = self.from_date.as_ref() {
            struct_ser.serialize_field("fromDate", v)?;
        }
        if let Some(v) = self.to_date.as_ref() {
            struct_ser.serialize_field("toDate", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for TreatsSummary {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "user_id",
            "userId",
            "total_treats",
            "totalTreats",
            "total_points",
            "totalPoints",
            "points_by_type",
            "pointsByType",
            "recent_treats",
            "recentTreats",
            "from_date",
            "fromDate",
            "to_date",
            "toDate",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            UserId,
            TotalTreats,
            TotalPoints,
            PointsByType,
            RecentTreats,
            FromDate,
            ToDate,
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
                            "userId" | "user_id" => Ok(GeneratedField::UserId),
                            "totalTreats" | "total_treats" => Ok(GeneratedField::TotalTreats),
                            "totalPoints" | "total_points" => Ok(GeneratedField::TotalPoints),
                            "pointsByType" | "points_by_type" => Ok(GeneratedField::PointsByType),
                            "recentTreats" | "recent_treats" => Ok(GeneratedField::RecentTreats),
                            "fromDate" | "from_date" => Ok(GeneratedField::FromDate),
                            "toDate" | "to_date" => Ok(GeneratedField::ToDate),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = TreatsSummary;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct treat.TreatsSummary")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<TreatsSummary, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut user_id__ = None;
                let mut total_treats__ = None;
                let mut total_points__ = None;
                let mut points_by_type__ = None;
                let mut recent_treats__ = None;
                let mut from_date__ = None;
                let mut to_date__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::UserId => {
                            if user_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("userId"));
                            }
                            user_id__ = Some(map.next_value()?);
                        }
                        GeneratedField::TotalTreats => {
                            if total_treats__.is_some() {
                                return Err(serde::de::Error::duplicate_field("totalTreats"));
                            }
                            total_treats__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::TotalPoints => {
                            if total_points__.is_some() {
                                return Err(serde::de::Error::duplicate_field("totalPoints"));
                            }
                            total_points__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::PointsByType => {
                            if points_by_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("pointsByType"));
                            }
                            points_by_type__ = Some(
                                map.next_value::<std::collections::HashMap<_, ::pbjson::private::NumberDeserialize<i32>>>()?
                                    .into_iter().map(|(k,v)| (k, v.0)).collect()
                            );
                        }
                        GeneratedField::RecentTreats => {
                            if recent_treats__.is_some() {
                                return Err(serde::de::Error::duplicate_field("recentTreats"));
                            }
                            recent_treats__ = Some(map.next_value()?);
                        }
                        GeneratedField::FromDate => {
                            if from_date__.is_some() {
                                return Err(serde::de::Error::duplicate_field("fromDate"));
                            }
                            from_date__ = map.next_value()?;
                        }
                        GeneratedField::ToDate => {
                            if to_date__.is_some() {
                                return Err(serde::de::Error::duplicate_field("toDate"));
                            }
                            to_date__ = map.next_value()?;
                        }
                    }
                }
                Ok(TreatsSummary {
                    user_id: user_id__.unwrap_or_default(),
                    total_treats: total_treats__.unwrap_or_default(),
                    total_points: total_points__.unwrap_or_default(),
                    points_by_type: points_by_type__.unwrap_or_default(),
                    recent_treats: recent_treats__.unwrap_or_default(),
                    from_date: from_date__,
                    to_date: to_date__,
                })
            }
        }
        deserializer.deserialize_struct("treat.TreatsSummary", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for TreatsSummaryResponse {
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
        if self.summary.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("treat.TreatsSummaryResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.summary.as_ref() {
            struct_ser.serialize_field("summary", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for TreatsSummaryResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "summary",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Summary,
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
                            "summary" => Ok(GeneratedField::Summary),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = TreatsSummaryResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct treat.TreatsSummaryResponse")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<TreatsSummaryResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut summary__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map.next_value()?;
                        }
                        GeneratedField::Summary => {
                            if summary__.is_some() {
                                return Err(serde::de::Error::duplicate_field("summary"));
                            }
                            summary__ = map.next_value()?;
                        }
                    }
                }
                Ok(TreatsSummaryResponse {
                    status: status__,
                    summary: summary__,
                })
            }
        }
        deserializer.deserialize_struct("treat.TreatsSummaryResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for UpdateTreatRequest {
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
        if !self.title.is_empty() {
            len += 1;
        }
        if !self.description.is_empty() {
            len += 1;
        }
        if self.points != 0 {
            len += 1;
        }
        if !self.image_url.is_empty() {
            len += 1;
        }
        if !self.metadata.is_empty() {
            len += 1;
        }
        if self.expires_at.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("treat.UpdateTreatRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.title.is_empty() {
            struct_ser.serialize_field("title", &self.title)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if self.points != 0 {
            struct_ser.serialize_field("points", &self.points)?;
        }
        if !self.image_url.is_empty() {
            struct_ser.serialize_field("imageUrl", &self.image_url)?;
        }
        if !self.metadata.is_empty() {
            struct_ser.serialize_field("metadata", &self.metadata)?;
        }
        if let Some(v) = self.expires_at.as_ref() {
            struct_ser.serialize_field("expiresAt", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for UpdateTreatRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "title",
            "description",
            "points",
            "image_url",
            "imageUrl",
            "metadata",
            "expires_at",
            "expiresAt",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Title,
            Description,
            Points,
            ImageUrl,
            Metadata,
            ExpiresAt,
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
                            "title" => Ok(GeneratedField::Title),
                            "description" => Ok(GeneratedField::Description),
                            "points" => Ok(GeneratedField::Points),
                            "imageUrl" | "image_url" => Ok(GeneratedField::ImageUrl),
                            "metadata" => Ok(GeneratedField::Metadata),
                            "expiresAt" | "expires_at" => Ok(GeneratedField::ExpiresAt),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = UpdateTreatRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct treat.UpdateTreatRequest")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<UpdateTreatRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut title__ = None;
                let mut description__ = None;
                let mut points__ = None;
                let mut image_url__ = None;
                let mut metadata__ = None;
                let mut expires_at__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map.next_value()?);
                        }
                        GeneratedField::Title => {
                            if title__.is_some() {
                                return Err(serde::de::Error::duplicate_field("title"));
                            }
                            title__ = Some(map.next_value()?);
                        }
                        GeneratedField::Description => {
                            if description__.is_some() {
                                return Err(serde::de::Error::duplicate_field("description"));
                            }
                            description__ = Some(map.next_value()?);
                        }
                        GeneratedField::Points => {
                            if points__.is_some() {
                                return Err(serde::de::Error::duplicate_field("points"));
                            }
                            points__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::ImageUrl => {
                            if image_url__.is_some() {
                                return Err(serde::de::Error::duplicate_field("imageUrl"));
                            }
                            image_url__ = Some(map.next_value()?);
                        }
                        GeneratedField::Metadata => {
                            if metadata__.is_some() {
                                return Err(serde::de::Error::duplicate_field("metadata"));
                            }
                            metadata__ = Some(
                                map.next_value::<std::collections::HashMap<_, _>>()?
                            );
                        }
                        GeneratedField::ExpiresAt => {
                            if expires_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("expiresAt"));
                            }
                            expires_at__ = map.next_value()?;
                        }
                    }
                }
                Ok(UpdateTreatRequest {
                    id: id__.unwrap_or_default(),
                    title: title__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    points: points__.unwrap_or_default(),
                    image_url: image_url__.unwrap_or_default(),
                    metadata: metadata__.unwrap_or_default(),
                    expires_at: expires_at__,
                })
            }
        }
        deserializer.deserialize_struct("treat.UpdateTreatRequest", FIELDS, GeneratedVisitor)
    }
}
