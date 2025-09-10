// @generated
impl serde::Serialize for HasPermissionRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.username.is_empty() {
            len += 1;
        }
        if !self.resource.is_empty() {
            len += 1;
        }
        if !self.action.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("permission.HasPermissionRequest", len)?;
        if !self.username.is_empty() {
            struct_ser.serialize_field("username", &self.username)?;
        }
        if !self.resource.is_empty() {
            struct_ser.serialize_field("resource", &self.resource)?;
        }
        if !self.action.is_empty() {
            struct_ser.serialize_field("action", &self.action)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for HasPermissionRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "username",
            "resource",
            "action",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Username,
            Resource,
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
                            "username" => Ok(GeneratedField::Username),
                            "resource" => Ok(GeneratedField::Resource),
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
            type Value = HasPermissionRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct permission.HasPermissionRequest")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<HasPermissionRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut username__ = None;
                let mut resource__ = None;
                let mut action__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::Username => {
                            if username__.is_some() {
                                return Err(serde::de::Error::duplicate_field("username"));
                            }
                            username__ = Some(map.next_value()?);
                        }
                        GeneratedField::Resource => {
                            if resource__.is_some() {
                                return Err(serde::de::Error::duplicate_field("resource"));
                            }
                            resource__ = Some(map.next_value()?);
                        }
                        GeneratedField::Action => {
                            if action__.is_some() {
                                return Err(serde::de::Error::duplicate_field("action"));
                            }
                            action__ = Some(map.next_value()?);
                        }
                    }
                }
                Ok(HasPermissionRequest {
                    username: username__.unwrap_or_default(),
                    resource: resource__.unwrap_or_default(),
                    action: action__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("permission.HasPermissionRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for PermissionRequest {
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
        if !self.subject.is_empty() {
            len += 1;
        }
        if !self.object.is_empty() {
            len += 1;
        }
        if !self.action.is_empty() {
            len += 1;
        }
        if !self.permission.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("permission.PermissionRequest", len)?;
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if !self.subject.is_empty() {
            struct_ser.serialize_field("subject", &self.subject)?;
        }
        if !self.object.is_empty() {
            struct_ser.serialize_field("object", &self.object)?;
        }
        if !self.action.is_empty() {
            struct_ser.serialize_field("action", &self.action)?;
        }
        if !self.permission.is_empty() {
            struct_ser.serialize_field("permission", &self.permission)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for PermissionRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "application_id",
            "applicationId",
            "subject",
            "object",
            "action",
            "permission",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ApplicationId,
            Subject,
            Object,
            Action,
            Permission,
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
                            "subject" => Ok(GeneratedField::Subject),
                            "object" => Ok(GeneratedField::Object),
                            "action" => Ok(GeneratedField::Action),
                            "permission" => Ok(GeneratedField::Permission),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = PermissionRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct permission.PermissionRequest")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<PermissionRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut application_id__ = None;
                let mut subject__ = None;
                let mut object__ = None;
                let mut action__ = None;
                let mut permission__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map.next_value()?);
                        }
                        GeneratedField::Subject => {
                            if subject__.is_some() {
                                return Err(serde::de::Error::duplicate_field("subject"));
                            }
                            subject__ = Some(map.next_value()?);
                        }
                        GeneratedField::Object => {
                            if object__.is_some() {
                                return Err(serde::de::Error::duplicate_field("object"));
                            }
                            object__ = Some(map.next_value()?);
                        }
                        GeneratedField::Action => {
                            if action__.is_some() {
                                return Err(serde::de::Error::duplicate_field("action"));
                            }
                            action__ = Some(map.next_value()?);
                        }
                        GeneratedField::Permission => {
                            if permission__.is_some() {
                                return Err(serde::de::Error::duplicate_field("permission"));
                            }
                            permission__ = Some(map.next_value()?);
                        }
                    }
                }
                Ok(PermissionRequest {
                    application_id: application_id__.unwrap_or_default(),
                    subject: subject__.unwrap_or_default(),
                    object: object__.unwrap_or_default(),
                    action: action__.unwrap_or_default(),
                    permission: permission__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("permission.PermissionRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for UserResourceRoleRequest {
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
        if !self.username.is_empty() {
            len += 1;
        }
        if !self.resource.is_empty() {
            len += 1;
        }
        if !self.role.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("permission.UserResourceRoleRequest", len)?;
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if !self.username.is_empty() {
            struct_ser.serialize_field("username", &self.username)?;
        }
        if !self.resource.is_empty() {
            struct_ser.serialize_field("resource", &self.resource)?;
        }
        if !self.role.is_empty() {
            struct_ser.serialize_field("role", &self.role)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for UserResourceRoleRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "application_id",
            "applicationId",
            "username",
            "resource",
            "role",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ApplicationId,
            Username,
            Resource,
            Role,
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
                            "username" => Ok(GeneratedField::Username),
                            "resource" => Ok(GeneratedField::Resource),
                            "role" => Ok(GeneratedField::Role),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = UserResourceRoleRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct permission.UserResourceRoleRequest")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<UserResourceRoleRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut application_id__ = None;
                let mut username__ = None;
                let mut resource__ = None;
                let mut role__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map.next_value()?);
                        }
                        GeneratedField::Username => {
                            if username__.is_some() {
                                return Err(serde::de::Error::duplicate_field("username"));
                            }
                            username__ = Some(map.next_value()?);
                        }
                        GeneratedField::Resource => {
                            if resource__.is_some() {
                                return Err(serde::de::Error::duplicate_field("resource"));
                            }
                            resource__ = Some(map.next_value()?);
                        }
                        GeneratedField::Role => {
                            if role__.is_some() {
                                return Err(serde::de::Error::duplicate_field("role"));
                            }
                            role__ = Some(map.next_value()?);
                        }
                    }
                }
                Ok(UserResourceRoleRequest {
                    application_id: application_id__.unwrap_or_default(),
                    username: username__.unwrap_or_default(),
                    resource: resource__.unwrap_or_default(),
                    role: role__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("permission.UserResourceRoleRequest", FIELDS, GeneratedVisitor)
    }
}
