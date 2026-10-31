// @generated
impl serde::Serialize for RecordUserPageSubmissionRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.submission_id.is_empty() {
            len += 1;
        }
        if !self.page_id.is_empty() {
            len += 1;
        }
        if !self.form_id.is_empty() {
            len += 1;
        }
        if self.form_title.is_some() {
            len += 1;
        }
        if self.submitted_at.is_some() {
            len += 1;
        }
        if self.viewer.is_some() {
            len += 1;
        }
        if !self.fields.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("user_page_submission.RecordUserPageSubmissionRequest", len)?;
        if !self.submission_id.is_empty() {
            struct_ser.serialize_field("submissionId", &self.submission_id)?;
        }
        if !self.page_id.is_empty() {
            struct_ser.serialize_field("pageId", &self.page_id)?;
        }
        if !self.form_id.is_empty() {
            struct_ser.serialize_field("formId", &self.form_id)?;
        }
        if let Some(v) = self.form_title.as_ref() {
            struct_ser.serialize_field("formTitle", v)?;
        }
        if let Some(v) = self.submitted_at.as_ref() {
            struct_ser.serialize_field("submittedAt", v)?;
        }
        if let Some(v) = self.viewer.as_ref() {
            struct_ser.serialize_field("viewer", v)?;
        }
        if !self.fields.is_empty() {
            struct_ser.serialize_field("fields", &self.fields)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RecordUserPageSubmissionRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "submission_id",
            "submissionId",
            "page_id",
            "pageId",
            "form_id",
            "formId",
            "form_title",
            "formTitle",
            "submitted_at",
            "submittedAt",
            "viewer",
            "fields",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            SubmissionId,
            PageId,
            FormId,
            FormTitle,
            SubmittedAt,
            Viewer,
            Fields,
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
                            "submissionId" | "submission_id" => Ok(GeneratedField::SubmissionId),
                            "pageId" | "page_id" => Ok(GeneratedField::PageId),
                            "formId" | "form_id" => Ok(GeneratedField::FormId),
                            "formTitle" | "form_title" => Ok(GeneratedField::FormTitle),
                            "submittedAt" | "submitted_at" => Ok(GeneratedField::SubmittedAt),
                            "viewer" => Ok(GeneratedField::Viewer),
                            "fields" => Ok(GeneratedField::Fields),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RecordUserPageSubmissionRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct user_page_submission.RecordUserPageSubmissionRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RecordUserPageSubmissionRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut submission_id__ = None;
                let mut page_id__ = None;
                let mut form_id__ = None;
                let mut form_title__ = None;
                let mut submitted_at__ = None;
                let mut viewer__ = None;
                let mut fields__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::SubmissionId => {
                            if submission_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("submissionId"));
                            }
                            submission_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::PageId => {
                            if page_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("pageId"));
                            }
                            page_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::FormId => {
                            if form_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("formId"));
                            }
                            form_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::FormTitle => {
                            if form_title__.is_some() {
                                return Err(serde::de::Error::duplicate_field("formTitle"));
                            }
                            form_title__ = map_.next_value()?;
                        }
                        GeneratedField::SubmittedAt => {
                            if submitted_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("submittedAt"));
                            }
                            submitted_at__ = map_.next_value()?;
                        }
                        GeneratedField::Viewer => {
                            if viewer__.is_some() {
                                return Err(serde::de::Error::duplicate_field("viewer"));
                            }
                            viewer__ = map_.next_value()?;
                        }
                        GeneratedField::Fields => {
                            if fields__.is_some() {
                                return Err(serde::de::Error::duplicate_field("fields"));
                            }
                            fields__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RecordUserPageSubmissionRequest {
                    submission_id: submission_id__.unwrap_or_default(),
                    page_id: page_id__.unwrap_or_default(),
                    form_id: form_id__.unwrap_or_default(),
                    form_title: form_title__,
                    submitted_at: submitted_at__,
                    viewer: viewer__,
                    fields: fields__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("user_page_submission.RecordUserPageSubmissionRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RecordUserPageSubmissionResponse {
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
        if self.created {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("user_page_submission.RecordUserPageSubmissionResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if self.created {
            struct_ser.serialize_field("created", &self.created)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RecordUserPageSubmissionResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "created",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
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
            type Value = RecordUserPageSubmissionResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct user_page_submission.RecordUserPageSubmissionResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RecordUserPageSubmissionResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut created__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Created => {
                            if created__.is_some() {
                                return Err(serde::de::Error::duplicate_field("created"));
                            }
                            created__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RecordUserPageSubmissionResponse {
                    status: status__,
                    created: created__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("user_page_submission.RecordUserPageSubmissionResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for UserPageSubmissionField {
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
        if !self.label.is_empty() {
            len += 1;
        }
        if !self.r#type.is_empty() {
            len += 1;
        }
        if self.value.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("user_page_submission.UserPageSubmissionField", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.label.is_empty() {
            struct_ser.serialize_field("label", &self.label)?;
        }
        if !self.r#type.is_empty() {
            struct_ser.serialize_field("type", &self.r#type)?;
        }
        if let Some(v) = self.value.as_ref() {
            match v {
                user_page_submission_field::Value::TextValue(v) => {
                    struct_ser.serialize_field("textValue", v)?;
                }
                user_page_submission_field::Value::CheckedValue(v) => {
                    struct_ser.serialize_field("checkedValue", v)?;
                }
            }
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for UserPageSubmissionField {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "label",
            "type",
            "text_value",
            "textValue",
            "checked_value",
            "checkedValue",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Label,
            Type,
            TextValue,
            CheckedValue,
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
                            "label" => Ok(GeneratedField::Label),
                            "type" => Ok(GeneratedField::Type),
                            "textValue" | "text_value" => Ok(GeneratedField::TextValue),
                            "checkedValue" | "checked_value" => Ok(GeneratedField::CheckedValue),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = UserPageSubmissionField;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct user_page_submission.UserPageSubmissionField")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<UserPageSubmissionField, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut label__ = None;
                let mut r#type__ = None;
                let mut value__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Label => {
                            if label__.is_some() {
                                return Err(serde::de::Error::duplicate_field("label"));
                            }
                            label__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Type => {
                            if r#type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("type"));
                            }
                            r#type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::TextValue => {
                            if value__.is_some() {
                                return Err(serde::de::Error::duplicate_field("textValue"));
                            }
                            value__ = map_.next_value::<::std::option::Option<_>>()?.map(user_page_submission_field::Value::TextValue);
                        }
                        GeneratedField::CheckedValue => {
                            if value__.is_some() {
                                return Err(serde::de::Error::duplicate_field("checkedValue"));
                            }
                            value__ = map_.next_value::<::std::option::Option<_>>()?.map(user_page_submission_field::Value::CheckedValue);
                        }
                    }
                }
                Ok(UserPageSubmissionField {
                    id: id__.unwrap_or_default(),
                    label: label__.unwrap_or_default(),
                    r#type: r#type__.unwrap_or_default(),
                    value: value__,
                })
            }
        }
        deserializer.deserialize_struct("user_page_submission.UserPageSubmissionField", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for UserPageViewer {
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
        if !self.display_name.is_empty() {
            len += 1;
        }
        if !self.roles.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("user_page_submission.UserPageViewer", len)?;
        if !self.platform.is_empty() {
            struct_ser.serialize_field("platform", &self.platform)?;
        }
        if !self.platform_user_id.is_empty() {
            struct_ser.serialize_field("platformUserId", &self.platform_user_id)?;
        }
        if !self.display_name.is_empty() {
            struct_ser.serialize_field("displayName", &self.display_name)?;
        }
        if !self.roles.is_empty() {
            struct_ser.serialize_field("roles", &self.roles)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for UserPageViewer {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "platform",
            "platform_user_id",
            "platformUserId",
            "display_name",
            "displayName",
            "roles",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Platform,
            PlatformUserId,
            DisplayName,
            Roles,
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
                            "displayName" | "display_name" => Ok(GeneratedField::DisplayName),
                            "roles" => Ok(GeneratedField::Roles),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = UserPageViewer;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct user_page_submission.UserPageViewer")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<UserPageViewer, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut platform__ = None;
                let mut platform_user_id__ = None;
                let mut display_name__ = None;
                let mut roles__ = None;
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
                        GeneratedField::DisplayName => {
                            if display_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("displayName"));
                            }
                            display_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Roles => {
                            if roles__.is_some() {
                                return Err(serde::de::Error::duplicate_field("roles"));
                            }
                            roles__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(UserPageViewer {
                    platform: platform__.unwrap_or_default(),
                    platform_user_id: platform_user_id__.unwrap_or_default(),
                    display_name: display_name__.unwrap_or_default(),
                    roles: roles__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("user_page_submission.UserPageViewer", FIELDS, GeneratedVisitor)
    }
}
