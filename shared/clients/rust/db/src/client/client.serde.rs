// @generated
impl serde::Serialize for Client {
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
        if !self.description.is_empty() {
            len += 1;
        }
        if !self.client_id.is_empty() {
            len += 1;
        }
        if !self.client_secret.is_empty() {
            len += 1;
        }
        if !self.callback_url.is_empty() {
            len += 1;
        }
        if !self.callback_token.is_empty() {
            len += 1;
        }
        if self.kind != 0 {
            len += 1;
        }
        if !self.origin.is_empty() {
            len += 1;
        }
        if self.created_at.is_some() {
            len += 1;
        }
        if self.last_authenticated_at.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("client.Client", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.client_id.is_empty() {
            struct_ser.serialize_field("clientId", &self.client_id)?;
        }
        if !self.client_secret.is_empty() {
            struct_ser.serialize_field("clientSecret", &self.client_secret)?;
        }
        if !self.callback_url.is_empty() {
            struct_ser.serialize_field("callbackUrl", &self.callback_url)?;
        }
        if !self.callback_token.is_empty() {
            struct_ser.serialize_field("callbackToken", &self.callback_token)?;
        }
        if self.kind != 0 {
            let v = ClientKind::try_from(self.kind)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.kind)))?;
            struct_ser.serialize_field("kind", &v)?;
        }
        if !self.origin.is_empty() {
            struct_ser.serialize_field("origin", &self.origin)?;
        }
        if let Some(v) = self.created_at.as_ref() {
            struct_ser.serialize_field("createdAt", v)?;
        }
        if let Some(v) = self.last_authenticated_at.as_ref() {
            struct_ser.serialize_field("lastAuthenticatedAt", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Client {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "description",
            "client_id",
            "clientId",
            "client_secret",
            "clientSecret",
            "callback_url",
            "callbackUrl",
            "callback_token",
            "callbackToken",
            "kind",
            "origin",
            "created_at",
            "createdAt",
            "last_authenticated_at",
            "lastAuthenticatedAt",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Description,
            ClientId,
            ClientSecret,
            CallbackUrl,
            CallbackToken,
            Kind,
            Origin,
            CreatedAt,
            LastAuthenticatedAt,
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
                            "description" => Ok(GeneratedField::Description),
                            "clientId" | "client_id" => Ok(GeneratedField::ClientId),
                            "clientSecret" | "client_secret" => Ok(GeneratedField::ClientSecret),
                            "callbackUrl" | "callback_url" => Ok(GeneratedField::CallbackUrl),
                            "callbackToken" | "callback_token" => Ok(GeneratedField::CallbackToken),
                            "kind" => Ok(GeneratedField::Kind),
                            "origin" => Ok(GeneratedField::Origin),
                            "createdAt" | "created_at" => Ok(GeneratedField::CreatedAt),
                            "lastAuthenticatedAt" | "last_authenticated_at" => Ok(GeneratedField::LastAuthenticatedAt),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = Client;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct client.Client")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Client, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut description__ = None;
                let mut client_id__ = None;
                let mut client_secret__ = None;
                let mut callback_url__ = None;
                let mut callback_token__ = None;
                let mut kind__ = None;
                let mut origin__ = None;
                let mut created_at__ = None;
                let mut last_authenticated_at__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Description => {
                            if description__.is_some() {
                                return Err(serde::de::Error::duplicate_field("description"));
                            }
                            description__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ClientId => {
                            if client_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("clientId"));
                            }
                            client_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ClientSecret => {
                            if client_secret__.is_some() {
                                return Err(serde::de::Error::duplicate_field("clientSecret"));
                            }
                            client_secret__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CallbackUrl => {
                            if callback_url__.is_some() {
                                return Err(serde::de::Error::duplicate_field("callbackUrl"));
                            }
                            callback_url__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CallbackToken => {
                            if callback_token__.is_some() {
                                return Err(serde::de::Error::duplicate_field("callbackToken"));
                            }
                            callback_token__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Kind => {
                            if kind__.is_some() {
                                return Err(serde::de::Error::duplicate_field("kind"));
                            }
                            kind__ = Some(map_.next_value::<ClientKind>()? as i32);
                        }
                        GeneratedField::Origin => {
                            if origin__.is_some() {
                                return Err(serde::de::Error::duplicate_field("origin"));
                            }
                            origin__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedAt => {
                            if created_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdAt"));
                            }
                            created_at__ = map_.next_value()?;
                        }
                        GeneratedField::LastAuthenticatedAt => {
                            if last_authenticated_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("lastAuthenticatedAt"));
                            }
                            last_authenticated_at__ = map_.next_value()?;
                        }
                    }
                }
                Ok(Client {
                    id: id__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    client_id: client_id__.unwrap_or_default(),
                    client_secret: client_secret__.unwrap_or_default(),
                    callback_url: callback_url__.unwrap_or_default(),
                    callback_token: callback_token__.unwrap_or_default(),
                    kind: kind__.unwrap_or_default(),
                    origin: origin__.unwrap_or_default(),
                    created_at: created_at__,
                    last_authenticated_at: last_authenticated_at__,
                })
            }
        }
        deserializer.deserialize_struct("client.Client", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ClientKind {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::Unspecified => "CLIENT_KIND_UNSPECIFIED",
            Self::Registered => "CLIENT_KIND_REGISTERED",
            Self::Paired => "CLIENT_KIND_PAIRED",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for ClientKind {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "CLIENT_KIND_UNSPECIFIED",
            "CLIENT_KIND_REGISTERED",
            "CLIENT_KIND_PAIRED",
        ];

        struct GeneratedVisitor;

        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ClientKind;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(formatter, "expected one of: {:?}", &FIELDS)
            }

            fn visit_i64<E>(self, v: i64) -> std::result::Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                i32::try_from(v)
                    .ok()
                    .and_then(|x| x.try_into().ok())
                    .ok_or_else(|| {
                        serde::de::Error::invalid_value(serde::de::Unexpected::Signed(v), &self)
                    })
            }

            fn visit_u64<E>(self, v: u64) -> std::result::Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                i32::try_from(v)
                    .ok()
                    .and_then(|x| x.try_into().ok())
                    .ok_or_else(|| {
                        serde::de::Error::invalid_value(serde::de::Unexpected::Unsigned(v), &self)
                    })
            }

            fn visit_str<E>(self, value: &str) -> std::result::Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                match value {
                    "CLIENT_KIND_UNSPECIFIED" => Ok(ClientKind::Unspecified),
                    "CLIENT_KIND_REGISTERED" => Ok(ClientKind::Registered),
                    "CLIENT_KIND_PAIRED" => Ok(ClientKind::Paired),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for ClientResponse {
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
        if self.client.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("client.ClientResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.client.as_ref() {
            struct_ser.serialize_field("client", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ClientResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "client",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Client,
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
                            "client" => Ok(GeneratedField::Client),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ClientResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct client.ClientResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ClientResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut client__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Client => {
                            if client__.is_some() {
                                return Err(serde::de::Error::duplicate_field("client"));
                            }
                            client__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ClientResponse {
                    status: status__,
                    client: client__,
                })
            }
        }
        deserializer.deserialize_struct("client.ClientResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for CreateClientRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.description.is_empty() {
            len += 1;
        }
        if !self.callback_url.is_empty() {
            len += 1;
        }
        if !self.callback_token.is_empty() {
            len += 1;
        }
        if self.kind != 0 {
            len += 1;
        }
        if !self.origin.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("client.CreateClientRequest", len)?;
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.callback_url.is_empty() {
            struct_ser.serialize_field("callbackUrl", &self.callback_url)?;
        }
        if !self.callback_token.is_empty() {
            struct_ser.serialize_field("callbackToken", &self.callback_token)?;
        }
        if self.kind != 0 {
            let v = ClientKind::try_from(self.kind)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.kind)))?;
            struct_ser.serialize_field("kind", &v)?;
        }
        if !self.origin.is_empty() {
            struct_ser.serialize_field("origin", &self.origin)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CreateClientRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "description",
            "callback_url",
            "callbackUrl",
            "callback_token",
            "callbackToken",
            "kind",
            "origin",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Description,
            CallbackUrl,
            CallbackToken,
            Kind,
            Origin,
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
                            "description" => Ok(GeneratedField::Description),
                            "callbackUrl" | "callback_url" => Ok(GeneratedField::CallbackUrl),
                            "callbackToken" | "callback_token" => Ok(GeneratedField::CallbackToken),
                            "kind" => Ok(GeneratedField::Kind),
                            "origin" => Ok(GeneratedField::Origin),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CreateClientRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct client.CreateClientRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CreateClientRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut description__ = None;
                let mut callback_url__ = None;
                let mut callback_token__ = None;
                let mut kind__ = None;
                let mut origin__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Description => {
                            if description__.is_some() {
                                return Err(serde::de::Error::duplicate_field("description"));
                            }
                            description__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CallbackUrl => {
                            if callback_url__.is_some() {
                                return Err(serde::de::Error::duplicate_field("callbackUrl"));
                            }
                            callback_url__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CallbackToken => {
                            if callback_token__.is_some() {
                                return Err(serde::de::Error::duplicate_field("callbackToken"));
                            }
                            callback_token__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Kind => {
                            if kind__.is_some() {
                                return Err(serde::de::Error::duplicate_field("kind"));
                            }
                            kind__ = Some(map_.next_value::<ClientKind>()? as i32);
                        }
                        GeneratedField::Origin => {
                            if origin__.is_some() {
                                return Err(serde::de::Error::duplicate_field("origin"));
                            }
                            origin__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(CreateClientRequest {
                    description: description__.unwrap_or_default(),
                    callback_url: callback_url__.unwrap_or_default(),
                    callback_token: callback_token__.unwrap_or_default(),
                    kind: kind__.unwrap_or_default(),
                    origin: origin__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("client.CreateClientRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DeleteClientRequest {
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
        let mut struct_ser = serializer.serialize_struct("client.DeleteClientRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DeleteClientRequest {
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
            type Value = DeleteClientRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct client.DeleteClientRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DeleteClientRequest, V::Error>
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
                Ok(DeleteClientRequest {
                    id: id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("client.DeleteClientRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetClientRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.client_id.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("client.GetClientRequest", len)?;
        if !self.client_id.is_empty() {
            struct_ser.serialize_field("clientId", &self.client_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetClientRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "client_id",
            "clientId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ClientId,
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
                            "clientId" | "client_id" => Ok(GeneratedField::ClientId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetClientRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct client.GetClientRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetClientRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut client_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ClientId => {
                            if client_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("clientId"));
                            }
                            client_id__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(GetClientRequest {
                    client_id: client_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("client.GetClientRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListClientsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let len = 0;
        let struct_ser = serializer.serialize_struct("client.ListClientsRequest", len)?;
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListClientsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
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
                            Err(serde::de::Error::unknown_field(value, FIELDS))
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListClientsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct client.ListClientsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListClientsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                while map_.next_key::<GeneratedField>()?.is_some() {
                    let _ = map_.next_value::<serde::de::IgnoredAny>()?;
                }
                Ok(ListClientsRequest {
                })
            }
        }
        deserializer.deserialize_struct("client.ListClientsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListClientsResponse {
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
        if !self.clients.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("client.ListClientsResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.clients.is_empty() {
            struct_ser.serialize_field("clients", &self.clients)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListClientsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "clients",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Clients,
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
                            "clients" => Ok(GeneratedField::Clients),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListClientsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct client.ListClientsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListClientsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut clients__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Clients => {
                            if clients__.is_some() {
                                return Err(serde::de::Error::duplicate_field("clients"));
                            }
                            clients__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListClientsResponse {
                    status: status__,
                    clients: clients__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("client.ListClientsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RecordClientAuthenticationRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.client_id.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("client.RecordClientAuthenticationRequest", len)?;
        if !self.client_id.is_empty() {
            struct_ser.serialize_field("clientId", &self.client_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RecordClientAuthenticationRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "client_id",
            "clientId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ClientId,
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
                            "clientId" | "client_id" => Ok(GeneratedField::ClientId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RecordClientAuthenticationRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct client.RecordClientAuthenticationRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RecordClientAuthenticationRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut client_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ClientId => {
                            if client_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("clientId"));
                            }
                            client_id__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RecordClientAuthenticationRequest {
                    client_id: client_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("client.RecordClientAuthenticationRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for UpdateClientRequest {
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
        if !self.description.is_empty() {
            len += 1;
        }
        if !self.callback_url.is_empty() {
            len += 1;
        }
        if !self.callback_token.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("client.UpdateClientRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.callback_url.is_empty() {
            struct_ser.serialize_field("callbackUrl", &self.callback_url)?;
        }
        if !self.callback_token.is_empty() {
            struct_ser.serialize_field("callbackToken", &self.callback_token)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for UpdateClientRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "description",
            "callback_url",
            "callbackUrl",
            "callback_token",
            "callbackToken",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Description,
            CallbackUrl,
            CallbackToken,
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
                            "description" => Ok(GeneratedField::Description),
                            "callbackUrl" | "callback_url" => Ok(GeneratedField::CallbackUrl),
                            "callbackToken" | "callback_token" => Ok(GeneratedField::CallbackToken),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = UpdateClientRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct client.UpdateClientRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<UpdateClientRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut description__ = None;
                let mut callback_url__ = None;
                let mut callback_token__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Description => {
                            if description__.is_some() {
                                return Err(serde::de::Error::duplicate_field("description"));
                            }
                            description__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CallbackUrl => {
                            if callback_url__.is_some() {
                                return Err(serde::de::Error::duplicate_field("callbackUrl"));
                            }
                            callback_url__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CallbackToken => {
                            if callback_token__.is_some() {
                                return Err(serde::de::Error::duplicate_field("callbackToken"));
                            }
                            callback_token__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(UpdateClientRequest {
                    id: id__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    callback_url: callback_url__.unwrap_or_default(),
                    callback_token: callback_token__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("client.UpdateClientRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ValidateClientRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.client_id.is_empty() {
            len += 1;
        }
        if !self.client_secret.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("client.ValidateClientRequest", len)?;
        if !self.client_id.is_empty() {
            struct_ser.serialize_field("clientId", &self.client_id)?;
        }
        if !self.client_secret.is_empty() {
            struct_ser.serialize_field("clientSecret", &self.client_secret)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ValidateClientRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "client_id",
            "clientId",
            "client_secret",
            "clientSecret",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ClientId,
            ClientSecret,
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
                            "clientId" | "client_id" => Ok(GeneratedField::ClientId),
                            "clientSecret" | "client_secret" => Ok(GeneratedField::ClientSecret),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ValidateClientRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct client.ValidateClientRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ValidateClientRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut client_id__ = None;
                let mut client_secret__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ClientId => {
                            if client_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("clientId"));
                            }
                            client_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ClientSecret => {
                            if client_secret__.is_some() {
                                return Err(serde::de::Error::duplicate_field("clientSecret"));
                            }
                            client_secret__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ValidateClientRequest {
                    client_id: client_id__.unwrap_or_default(),
                    client_secret: client_secret__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("client.ValidateClientRequest", FIELDS, GeneratedVisitor)
    }
}
