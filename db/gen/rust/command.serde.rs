// @generated
impl serde::Serialize for Command {
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
        if !self.command.is_empty() {
            len += 1;
        }
        if !self.r#type.is_empty() {
            len += 1;
        }
        if !self.type_value.is_empty() {
            len += 1;
        }
        if self.cooldown != 0 {
            len += 1;
        }
        if self.priority != 0 {
            len += 1;
        }
        if self.enabled {
            len += 1;
        }
        if !self.created_by.is_empty() {
            len += 1;
        }
        if self.created_at.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("command.Command", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if !self.command.is_empty() {
            struct_ser.serialize_field("command", &self.command)?;
        }
        if !self.r#type.is_empty() {
            struct_ser.serialize_field("type", &self.r#type)?;
        }
        if !self.type_value.is_empty() {
            struct_ser.serialize_field("typeValue", &self.type_value)?;
        }
        if self.cooldown != 0 {
            struct_ser.serialize_field("cooldown", &self.cooldown)?;
        }
        if self.priority != 0 {
            struct_ser.serialize_field("priority", &self.priority)?;
        }
        if self.enabled {
            struct_ser.serialize_field("enabled", &self.enabled)?;
        }
        if !self.created_by.is_empty() {
            struct_ser.serialize_field("createdBy", &self.created_by)?;
        }
        if let Some(v) = self.created_at.as_ref() {
            struct_ser.serialize_field("createdAt", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Command {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "application_id",
            "applicationId",
            "command",
            "type",
            "type_value",
            "typeValue",
            "cooldown",
            "priority",
            "enabled",
            "created_by",
            "createdBy",
            "created_at",
            "createdAt",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            ApplicationId,
            Command,
            Type,
            TypeValue,
            Cooldown,
            Priority,
            Enabled,
            CreatedBy,
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
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            "command" => Ok(GeneratedField::Command),
                            "type" => Ok(GeneratedField::Type),
                            "typeValue" | "type_value" => Ok(GeneratedField::TypeValue),
                            "cooldown" => Ok(GeneratedField::Cooldown),
                            "priority" => Ok(GeneratedField::Priority),
                            "enabled" => Ok(GeneratedField::Enabled),
                            "createdBy" | "created_by" => Ok(GeneratedField::CreatedBy),
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
            type Value = Command;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct command.Command")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<Command, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut application_id__ = None;
                let mut command__ = None;
                let mut r#type__ = None;
                let mut type_value__ = None;
                let mut cooldown__ = None;
                let mut priority__ = None;
                let mut enabled__ = None;
                let mut created_by__ = None;
                let mut created_at__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map.next_value()?);
                        }
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map.next_value()?);
                        }
                        GeneratedField::Command => {
                            if command__.is_some() {
                                return Err(serde::de::Error::duplicate_field("command"));
                            }
                            command__ = Some(map.next_value()?);
                        }
                        GeneratedField::Type => {
                            if r#type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("type"));
                            }
                            r#type__ = Some(map.next_value()?);
                        }
                        GeneratedField::TypeValue => {
                            if type_value__.is_some() {
                                return Err(serde::de::Error::duplicate_field("typeValue"));
                            }
                            type_value__ = Some(map.next_value()?);
                        }
                        GeneratedField::Cooldown => {
                            if cooldown__.is_some() {
                                return Err(serde::de::Error::duplicate_field("cooldown"));
                            }
                            cooldown__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Priority => {
                            if priority__.is_some() {
                                return Err(serde::de::Error::duplicate_field("priority"));
                            }
                            priority__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Enabled => {
                            if enabled__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enabled"));
                            }
                            enabled__ = Some(map.next_value()?);
                        }
                        GeneratedField::CreatedBy => {
                            if created_by__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdBy"));
                            }
                            created_by__ = Some(map.next_value()?);
                        }
                        GeneratedField::CreatedAt => {
                            if created_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdAt"));
                            }
                            created_at__ = map.next_value()?;
                        }
                    }
                }
                Ok(Command {
                    id: id__.unwrap_or_default(),
                    application_id: application_id__.unwrap_or_default(),
                    command: command__.unwrap_or_default(),
                    r#type: r#type__.unwrap_or_default(),
                    type_value: type_value__.unwrap_or_default(),
                    cooldown: cooldown__.unwrap_or_default(),
                    priority: priority__.unwrap_or_default(),
                    enabled: enabled__.unwrap_or_default(),
                    created_by: created_by__.unwrap_or_default(),
                    created_at: created_at__,
                })
            }
        }
        deserializer.deserialize_struct("command.Command", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for CommandResponse {
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
        if self.command.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("command.CommandResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.command.as_ref() {
            struct_ser.serialize_field("command", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CommandResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "command",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Command,
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
                            "command" => Ok(GeneratedField::Command),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CommandResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct command.CommandResponse")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<CommandResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut command__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map.next_value()?;
                        }
                        GeneratedField::Command => {
                            if command__.is_some() {
                                return Err(serde::de::Error::duplicate_field("command"));
                            }
                            command__ = map.next_value()?;
                        }
                    }
                }
                Ok(CommandResponse {
                    status: status__,
                    command: command__,
                })
            }
        }
        deserializer.deserialize_struct("command.CommandResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for CreateCommandRequest {
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
        if !self.command.is_empty() {
            len += 1;
        }
        if self.enabled {
            len += 1;
        }
        if self.cooldown != 0 {
            len += 1;
        }
        if !self.r#type.is_empty() {
            len += 1;
        }
        if !self.type_value.is_empty() {
            len += 1;
        }
        if self.priority != 0 {
            len += 1;
        }
        if !self.created_by.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("command.CreateCommandRequest", len)?;
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if !self.command.is_empty() {
            struct_ser.serialize_field("command", &self.command)?;
        }
        if self.enabled {
            struct_ser.serialize_field("enabled", &self.enabled)?;
        }
        if self.cooldown != 0 {
            struct_ser.serialize_field("cooldown", &self.cooldown)?;
        }
        if !self.r#type.is_empty() {
            struct_ser.serialize_field("type", &self.r#type)?;
        }
        if !self.type_value.is_empty() {
            struct_ser.serialize_field("typeValue", &self.type_value)?;
        }
        if self.priority != 0 {
            struct_ser.serialize_field("priority", &self.priority)?;
        }
        if !self.created_by.is_empty() {
            struct_ser.serialize_field("createdBy", &self.created_by)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CreateCommandRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "application_id",
            "applicationId",
            "command",
            "enabled",
            "cooldown",
            "type",
            "type_value",
            "typeValue",
            "priority",
            "created_by",
            "createdBy",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ApplicationId,
            Command,
            Enabled,
            Cooldown,
            Type,
            TypeValue,
            Priority,
            CreatedBy,
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
                            "command" => Ok(GeneratedField::Command),
                            "enabled" => Ok(GeneratedField::Enabled),
                            "cooldown" => Ok(GeneratedField::Cooldown),
                            "type" => Ok(GeneratedField::Type),
                            "typeValue" | "type_value" => Ok(GeneratedField::TypeValue),
                            "priority" => Ok(GeneratedField::Priority),
                            "createdBy" | "created_by" => Ok(GeneratedField::CreatedBy),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CreateCommandRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct command.CreateCommandRequest")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<CreateCommandRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut application_id__ = None;
                let mut command__ = None;
                let mut enabled__ = None;
                let mut cooldown__ = None;
                let mut r#type__ = None;
                let mut type_value__ = None;
                let mut priority__ = None;
                let mut created_by__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map.next_value()?);
                        }
                        GeneratedField::Command => {
                            if command__.is_some() {
                                return Err(serde::de::Error::duplicate_field("command"));
                            }
                            command__ = Some(map.next_value()?);
                        }
                        GeneratedField::Enabled => {
                            if enabled__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enabled"));
                            }
                            enabled__ = Some(map.next_value()?);
                        }
                        GeneratedField::Cooldown => {
                            if cooldown__.is_some() {
                                return Err(serde::de::Error::duplicate_field("cooldown"));
                            }
                            cooldown__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Type => {
                            if r#type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("type"));
                            }
                            r#type__ = Some(map.next_value()?);
                        }
                        GeneratedField::TypeValue => {
                            if type_value__.is_some() {
                                return Err(serde::de::Error::duplicate_field("typeValue"));
                            }
                            type_value__ = Some(map.next_value()?);
                        }
                        GeneratedField::Priority => {
                            if priority__.is_some() {
                                return Err(serde::de::Error::duplicate_field("priority"));
                            }
                            priority__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::CreatedBy => {
                            if created_by__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdBy"));
                            }
                            created_by__ = Some(map.next_value()?);
                        }
                    }
                }
                Ok(CreateCommandRequest {
                    application_id: application_id__.unwrap_or_default(),
                    command: command__.unwrap_or_default(),
                    enabled: enabled__.unwrap_or_default(),
                    cooldown: cooldown__.unwrap_or_default(),
                    r#type: r#type__.unwrap_or_default(),
                    type_value: type_value__.unwrap_or_default(),
                    priority: priority__.unwrap_or_default(),
                    created_by: created_by__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("command.CreateCommandRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DeleteCommandRequest {
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
        let mut struct_ser = serializer.serialize_struct("command.DeleteCommandRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DeleteCommandRequest {
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
            type Value = DeleteCommandRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct command.DeleteCommandRequest")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<DeleteCommandRequest, V::Error>
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
                Ok(DeleteCommandRequest {
                    id: id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("command.DeleteCommandRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetCommandRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.command.is_empty() {
            len += 1;
        }
        if !self.application_id.is_empty() {
            len += 1;
        }
        if self.username.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("command.GetCommandRequest", len)?;
        if !self.command.is_empty() {
            struct_ser.serialize_field("command", &self.command)?;
        }
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if let Some(v) = self.username.as_ref() {
            struct_ser.serialize_field("username", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetCommandRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "command",
            "application_id",
            "applicationId",
            "username",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Command,
            ApplicationId,
            Username,
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
                            "command" => Ok(GeneratedField::Command),
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            "username" => Ok(GeneratedField::Username),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetCommandRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct command.GetCommandRequest")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<GetCommandRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut command__ = None;
                let mut application_id__ = None;
                let mut username__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::Command => {
                            if command__.is_some() {
                                return Err(serde::de::Error::duplicate_field("command"));
                            }
                            command__ = Some(map.next_value()?);
                        }
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
                            username__ = map.next_value()?;
                        }
                    }
                }
                Ok(GetCommandRequest {
                    command: command__.unwrap_or_default(),
                    application_id: application_id__.unwrap_or_default(),
                    username: username__,
                })
            }
        }
        deserializer.deserialize_struct("command.GetCommandRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListCommandsRequest {
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
        if self.include_disabled {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("command.ListCommandsRequest", len)?;
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if self.include_disabled {
            struct_ser.serialize_field("includeDisabled", &self.include_disabled)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListCommandsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "application_id",
            "applicationId",
            "include_disabled",
            "includeDisabled",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ApplicationId,
            IncludeDisabled,
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
                            "includeDisabled" | "include_disabled" => Ok(GeneratedField::IncludeDisabled),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListCommandsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct command.ListCommandsRequest")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<ListCommandsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut application_id__ = None;
                let mut include_disabled__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map.next_value()?);
                        }
                        GeneratedField::IncludeDisabled => {
                            if include_disabled__.is_some() {
                                return Err(serde::de::Error::duplicate_field("includeDisabled"));
                            }
                            include_disabled__ = Some(map.next_value()?);
                        }
                    }
                }
                Ok(ListCommandsRequest {
                    application_id: application_id__.unwrap_or_default(),
                    include_disabled: include_disabled__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("command.ListCommandsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListCommandsResponse {
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
        if !self.commands.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("command.ListCommandsResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.commands.is_empty() {
            struct_ser.serialize_field("commands", &self.commands)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListCommandsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "commands",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Commands,
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
                            "commands" => Ok(GeneratedField::Commands),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListCommandsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct command.ListCommandsResponse")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<ListCommandsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut commands__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map.next_value()?;
                        }
                        GeneratedField::Commands => {
                            if commands__.is_some() {
                                return Err(serde::de::Error::duplicate_field("commands"));
                            }
                            commands__ = Some(map.next_value()?);
                        }
                    }
                }
                Ok(ListCommandsResponse {
                    status: status__,
                    commands: commands__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("command.ListCommandsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for UpdateCommandRequest {
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
        if !self.command.is_empty() {
            len += 1;
        }
        if self.enabled {
            len += 1;
        }
        if self.cooldown != 0 {
            len += 1;
        }
        if !self.r#type.is_empty() {
            len += 1;
        }
        if !self.type_value.is_empty() {
            len += 1;
        }
        if self.priority != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("command.UpdateCommandRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.command.is_empty() {
            struct_ser.serialize_field("command", &self.command)?;
        }
        if self.enabled {
            struct_ser.serialize_field("enabled", &self.enabled)?;
        }
        if self.cooldown != 0 {
            struct_ser.serialize_field("cooldown", &self.cooldown)?;
        }
        if !self.r#type.is_empty() {
            struct_ser.serialize_field("type", &self.r#type)?;
        }
        if !self.type_value.is_empty() {
            struct_ser.serialize_field("typeValue", &self.type_value)?;
        }
        if self.priority != 0 {
            struct_ser.serialize_field("priority", &self.priority)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for UpdateCommandRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "command",
            "enabled",
            "cooldown",
            "type",
            "type_value",
            "typeValue",
            "priority",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Command,
            Enabled,
            Cooldown,
            Type,
            TypeValue,
            Priority,
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
                            "command" => Ok(GeneratedField::Command),
                            "enabled" => Ok(GeneratedField::Enabled),
                            "cooldown" => Ok(GeneratedField::Cooldown),
                            "type" => Ok(GeneratedField::Type),
                            "typeValue" | "type_value" => Ok(GeneratedField::TypeValue),
                            "priority" => Ok(GeneratedField::Priority),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = UpdateCommandRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct command.UpdateCommandRequest")
            }

            fn visit_map<V>(self, mut map: V) -> std::result::Result<UpdateCommandRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut command__ = None;
                let mut enabled__ = None;
                let mut cooldown__ = None;
                let mut r#type__ = None;
                let mut type_value__ = None;
                let mut priority__ = None;
                while let Some(k) = map.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map.next_value()?);
                        }
                        GeneratedField::Command => {
                            if command__.is_some() {
                                return Err(serde::de::Error::duplicate_field("command"));
                            }
                            command__ = Some(map.next_value()?);
                        }
                        GeneratedField::Enabled => {
                            if enabled__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enabled"));
                            }
                            enabled__ = Some(map.next_value()?);
                        }
                        GeneratedField::Cooldown => {
                            if cooldown__.is_some() {
                                return Err(serde::de::Error::duplicate_field("cooldown"));
                            }
                            cooldown__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Type => {
                            if r#type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("type"));
                            }
                            r#type__ = Some(map.next_value()?);
                        }
                        GeneratedField::TypeValue => {
                            if type_value__.is_some() {
                                return Err(serde::de::Error::duplicate_field("typeValue"));
                            }
                            type_value__ = Some(map.next_value()?);
                        }
                        GeneratedField::Priority => {
                            if priority__.is_some() {
                                return Err(serde::de::Error::duplicate_field("priority"));
                            }
                            priority__ = 
                                Some(map.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(UpdateCommandRequest {
                    id: id__.unwrap_or_default(),
                    command: command__.unwrap_or_default(),
                    enabled: enabled__.unwrap_or_default(),
                    cooldown: cooldown__.unwrap_or_default(),
                    r#type: r#type__.unwrap_or_default(),
                    type_value: type_value__.unwrap_or_default(),
                    priority: priority__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("command.UpdateCommandRequest", FIELDS, GeneratedVisitor)
    }
}
