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
        if !self.application_id.is_empty() {
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
        let mut struct_ser = serializer.serialize_struct("client.Client", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
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
            "application_id",
            "applicationId",
            "client_id",
            "clientId",
            "client_secret",
            "clientSecret",
            "callback_url",
            "callbackUrl",
            "callback_token",
            "callbackToken",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Description,
            ApplicationId,
            ClientId,
            ClientSecret,
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
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            "clientId" | "client_id" => Ok(GeneratedField::ClientId),
                            "clientSecret" | "client_secret" => Ok(GeneratedField::ClientSecret),
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
                let mut application_id__ = None;
                let mut client_id__ = None;
                let mut client_secret__ = None;
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
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map_.next_value()?);
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
                    }
                }
                Ok(Client {
                    id: id__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    application_id: application_id__.unwrap_or_default(),
                    client_id: client_id__.unwrap_or_default(),
                    client_secret: client_secret__.unwrap_or_default(),
                    callback_url: callback_url__.unwrap_or_default(),
                    callback_token: callback_token__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("client.Client", FIELDS, GeneratedVisitor)
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
        if !self.application_id.is_empty() {
            len += 1;
        }
        if !self.callback_url.is_empty() {
            len += 1;
        }
        if !self.callback_token.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("client.CreateClientRequest", len)?;
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
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
impl<'de> serde::Deserialize<'de> for CreateClientRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "description",
            "application_id",
            "applicationId",
            "callback_url",
            "callbackUrl",
            "callback_token",
            "callbackToken",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Description,
            ApplicationId,
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
                            "description" => Ok(GeneratedField::Description),
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
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
            type Value = CreateClientRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct client.CreateClientRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CreateClientRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut description__ = None;
                let mut application_id__ = None;
                let mut callback_url__ = None;
                let mut callback_token__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Description => {
                            if description__.is_some() {
                                return Err(serde::de::Error::duplicate_field("description"));
                            }
                            description__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map_.next_value()?);
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
                Ok(CreateClientRequest {
                    description: description__.unwrap_or_default(),
                    application_id: application_id__.unwrap_or_default(),
                    callback_url: callback_url__.unwrap_or_default(),
                    callback_token: callback_token__.unwrap_or_default(),
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
        let mut len = 0;
        if !self.application_id.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("client.ListClientsRequest", len)?;
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
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
            "application_id",
            "applicationId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
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
            type Value = ListClientsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct client.ListClientsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListClientsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut application_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListClientsRequest {
                    application_id: application_id__.unwrap_or_default(),
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
