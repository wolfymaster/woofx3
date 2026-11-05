// @generated
impl serde::Serialize for CreateDatabaseRecordOutcome {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::Unspecified => "CREATE_DATABASE_RECORD_OUTCOME_UNSPECIFIED",
            Self::Created => "CREATE_DATABASE_RECORD_OUTCOME_CREATED",
            Self::Duplicate => "CREATE_DATABASE_RECORD_OUTCOME_DUPLICATE",
            Self::Full => "CREATE_DATABASE_RECORD_OUTCOME_FULL",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for CreateDatabaseRecordOutcome {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "CREATE_DATABASE_RECORD_OUTCOME_UNSPECIFIED",
            "CREATE_DATABASE_RECORD_OUTCOME_CREATED",
            "CREATE_DATABASE_RECORD_OUTCOME_DUPLICATE",
            "CREATE_DATABASE_RECORD_OUTCOME_FULL",
        ];

        struct GeneratedVisitor;

        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CreateDatabaseRecordOutcome;

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
                    "CREATE_DATABASE_RECORD_OUTCOME_UNSPECIFIED" => Ok(CreateDatabaseRecordOutcome::Unspecified),
                    "CREATE_DATABASE_RECORD_OUTCOME_CREATED" => Ok(CreateDatabaseRecordOutcome::Created),
                    "CREATE_DATABASE_RECORD_OUTCOME_DUPLICATE" => Ok(CreateDatabaseRecordOutcome::Duplicate),
                    "CREATE_DATABASE_RECORD_OUTCOME_FULL" => Ok(CreateDatabaseRecordOutcome::Full),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for CreateDatabaseRecordRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.database_id.is_empty() {
            len += 1;
        }
        if self.insert_key.is_some() {
            len += 1;
        }
        if self.values.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("database_record.CreateDatabaseRecordRequest", len)?;
        if !self.database_id.is_empty() {
            struct_ser.serialize_field("databaseId", &self.database_id)?;
        }
        if let Some(v) = self.insert_key.as_ref() {
            struct_ser.serialize_field("insertKey", v)?;
        }
        if let Some(v) = self.values.as_ref() {
            match v {
                create_database_record_request::Values::TypedValuesJson(v) => {
                    struct_ser.serialize_field("typedValuesJson", v)?;
                }
                create_database_record_request::Values::TextValues(v) => {
                    struct_ser.serialize_field("textValues", v)?;
                }
            }
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CreateDatabaseRecordRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "database_id",
            "databaseId",
            "insert_key",
            "insertKey",
            "typed_values_json",
            "typedValuesJson",
            "text_values",
            "textValues",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            DatabaseId,
            InsertKey,
            TypedValuesJson,
            TextValues,
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
                            "databaseId" | "database_id" => Ok(GeneratedField::DatabaseId),
                            "insertKey" | "insert_key" => Ok(GeneratedField::InsertKey),
                            "typedValuesJson" | "typed_values_json" => Ok(GeneratedField::TypedValuesJson),
                            "textValues" | "text_values" => Ok(GeneratedField::TextValues),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CreateDatabaseRecordRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct database_record.CreateDatabaseRecordRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CreateDatabaseRecordRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut database_id__ = None;
                let mut insert_key__ = None;
                let mut values__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::DatabaseId => {
                            if database_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("databaseId"));
                            }
                            database_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::InsertKey => {
                            if insert_key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("insertKey"));
                            }
                            insert_key__ = map_.next_value()?;
                        }
                        GeneratedField::TypedValuesJson => {
                            if values__.is_some() {
                                return Err(serde::de::Error::duplicate_field("typedValuesJson"));
                            }
                            values__ = map_.next_value::<::std::option::Option<_>>()?.map(create_database_record_request::Values::TypedValuesJson);
                        }
                        GeneratedField::TextValues => {
                            if values__.is_some() {
                                return Err(serde::de::Error::duplicate_field("textValues"));
                            }
                            values__ = map_.next_value::<::std::option::Option<_>>()?.map(create_database_record_request::Values::TextValues)
;
                        }
                    }
                }
                Ok(CreateDatabaseRecordRequest {
                    database_id: database_id__.unwrap_or_default(),
                    insert_key: insert_key__,
                    values: values__,
                })
            }
        }
        deserializer.deserialize_struct("database_record.CreateDatabaseRecordRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for CreateDatabaseRecordResponse {
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
        if self.outcome != 0 {
            len += 1;
        }
        if self.record.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("database_record.CreateDatabaseRecordResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if self.outcome != 0 {
            let v = CreateDatabaseRecordOutcome::try_from(self.outcome)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.outcome)))?;
            struct_ser.serialize_field("outcome", &v)?;
        }
        if let Some(v) = self.record.as_ref() {
            struct_ser.serialize_field("record", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CreateDatabaseRecordResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "outcome",
            "record",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Outcome,
            Record,
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
                            "outcome" => Ok(GeneratedField::Outcome),
                            "record" => Ok(GeneratedField::Record),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CreateDatabaseRecordResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct database_record.CreateDatabaseRecordResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CreateDatabaseRecordResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut outcome__ = None;
                let mut record__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Outcome => {
                            if outcome__.is_some() {
                                return Err(serde::de::Error::duplicate_field("outcome"));
                            }
                            outcome__ = Some(map_.next_value::<CreateDatabaseRecordOutcome>()? as i32);
                        }
                        GeneratedField::Record => {
                            if record__.is_some() {
                                return Err(serde::de::Error::duplicate_field("record"));
                            }
                            record__ = map_.next_value()?;
                        }
                    }
                }
                Ok(CreateDatabaseRecordResponse {
                    status: status__,
                    outcome: outcome__.unwrap_or_default(),
                    record: record__,
                })
            }
        }
        deserializer.deserialize_struct("database_record.CreateDatabaseRecordResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DatabaseRecord {
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
        if !self.database_id.is_empty() {
            len += 1;
        }
        if self.revision != 0 {
            len += 1;
        }
        if self.created_at.is_some() {
            len += 1;
        }
        if self.updated_at.is_some() {
            len += 1;
        }
        if !self.values_json.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("database_record.DatabaseRecord", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.database_id.is_empty() {
            struct_ser.serialize_field("databaseId", &self.database_id)?;
        }
        if self.revision != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("revision", ToString::to_string(&self.revision).as_str())?;
        }
        if let Some(v) = self.created_at.as_ref() {
            struct_ser.serialize_field("createdAt", v)?;
        }
        if let Some(v) = self.updated_at.as_ref() {
            struct_ser.serialize_field("updatedAt", v)?;
        }
        if !self.values_json.is_empty() {
            struct_ser.serialize_field("valuesJson", &self.values_json)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DatabaseRecord {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "database_id",
            "databaseId",
            "revision",
            "created_at",
            "createdAt",
            "updated_at",
            "updatedAt",
            "values_json",
            "valuesJson",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            DatabaseId,
            Revision,
            CreatedAt,
            UpdatedAt,
            ValuesJson,
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
                            "databaseId" | "database_id" => Ok(GeneratedField::DatabaseId),
                            "revision" => Ok(GeneratedField::Revision),
                            "createdAt" | "created_at" => Ok(GeneratedField::CreatedAt),
                            "updatedAt" | "updated_at" => Ok(GeneratedField::UpdatedAt),
                            "valuesJson" | "values_json" => Ok(GeneratedField::ValuesJson),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = DatabaseRecord;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct database_record.DatabaseRecord")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DatabaseRecord, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut database_id__ = None;
                let mut revision__ = None;
                let mut created_at__ = None;
                let mut updated_at__ = None;
                let mut values_json__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DatabaseId => {
                            if database_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("databaseId"));
                            }
                            database_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Revision => {
                            if revision__.is_some() {
                                return Err(serde::de::Error::duplicate_field("revision"));
                            }
                            revision__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
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
                        GeneratedField::ValuesJson => {
                            if values_json__.is_some() {
                                return Err(serde::de::Error::duplicate_field("valuesJson"));
                            }
                            values_json__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(DatabaseRecord {
                    id: id__.unwrap_or_default(),
                    database_id: database_id__.unwrap_or_default(),
                    revision: revision__.unwrap_or_default(),
                    created_at: created_at__,
                    updated_at: updated_at__,
                    values_json: values_json__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("database_record.DatabaseRecord", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DatabaseTextValues {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.values.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("database_record.DatabaseTextValues", len)?;
        if !self.values.is_empty() {
            struct_ser.serialize_field("values", &self.values)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DatabaseTextValues {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "values",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Values,
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
                            "values" => Ok(GeneratedField::Values),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = DatabaseTextValues;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct database_record.DatabaseTextValues")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DatabaseTextValues, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut values__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Values => {
                            if values__.is_some() {
                                return Err(serde::de::Error::duplicate_field("values"));
                            }
                            values__ = Some(
                                map_.next_value::<std::collections::HashMap<_, _>>()?
                            );
                        }
                    }
                }
                Ok(DatabaseTextValues {
                    values: values__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("database_record.DatabaseTextValues", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DeleteDatabaseRecordRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.database_id.is_empty() {
            len += 1;
        }
        if !self.record_id.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("database_record.DeleteDatabaseRecordRequest", len)?;
        if !self.database_id.is_empty() {
            struct_ser.serialize_field("databaseId", &self.database_id)?;
        }
        if !self.record_id.is_empty() {
            struct_ser.serialize_field("recordId", &self.record_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DeleteDatabaseRecordRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "database_id",
            "databaseId",
            "record_id",
            "recordId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            DatabaseId,
            RecordId,
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
                            "databaseId" | "database_id" => Ok(GeneratedField::DatabaseId),
                            "recordId" | "record_id" => Ok(GeneratedField::RecordId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = DeleteDatabaseRecordRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct database_record.DeleteDatabaseRecordRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DeleteDatabaseRecordRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut database_id__ = None;
                let mut record_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::DatabaseId => {
                            if database_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("databaseId"));
                            }
                            database_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::RecordId => {
                            if record_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("recordId"));
                            }
                            record_id__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(DeleteDatabaseRecordRequest {
                    database_id: database_id__.unwrap_or_default(),
                    record_id: record_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("database_record.DeleteDatabaseRecordRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DeleteDatabaseRecordResponse {
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
        if self.deleted {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("database_record.DeleteDatabaseRecordResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if self.deleted {
            struct_ser.serialize_field("deleted", &self.deleted)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DeleteDatabaseRecordResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "deleted",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Deleted,
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
                            "deleted" => Ok(GeneratedField::Deleted),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = DeleteDatabaseRecordResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct database_record.DeleteDatabaseRecordResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DeleteDatabaseRecordResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut deleted__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Deleted => {
                            if deleted__.is_some() {
                                return Err(serde::de::Error::duplicate_field("deleted"));
                            }
                            deleted__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(DeleteDatabaseRecordResponse {
                    status: status__,
                    deleted: deleted__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("database_record.DeleteDatabaseRecordResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for FindDatabaseRecordRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.database_id.is_empty() {
            len += 1;
        }
        if !self.column_id.is_empty() {
            len += 1;
        }
        if !self.r#match.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("database_record.FindDatabaseRecordRequest", len)?;
        if !self.database_id.is_empty() {
            struct_ser.serialize_field("databaseId", &self.database_id)?;
        }
        if !self.column_id.is_empty() {
            struct_ser.serialize_field("columnId", &self.column_id)?;
        }
        if !self.r#match.is_empty() {
            struct_ser.serialize_field("match", &self.r#match)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for FindDatabaseRecordRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "database_id",
            "databaseId",
            "column_id",
            "columnId",
            "match",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            DatabaseId,
            ColumnId,
            Match,
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
                            "databaseId" | "database_id" => Ok(GeneratedField::DatabaseId),
                            "columnId" | "column_id" => Ok(GeneratedField::ColumnId),
                            "match" => Ok(GeneratedField::Match),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = FindDatabaseRecordRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct database_record.FindDatabaseRecordRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<FindDatabaseRecordRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut database_id__ = None;
                let mut column_id__ = None;
                let mut r#match__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::DatabaseId => {
                            if database_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("databaseId"));
                            }
                            database_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ColumnId => {
                            if column_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("columnId"));
                            }
                            column_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Match => {
                            if r#match__.is_some() {
                                return Err(serde::de::Error::duplicate_field("match"));
                            }
                            r#match__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(FindDatabaseRecordRequest {
                    database_id: database_id__.unwrap_or_default(),
                    column_id: column_id__.unwrap_or_default(),
                    r#match: r#match__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("database_record.FindDatabaseRecordRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for FindDatabaseRecordResponse {
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
        if self.found {
            len += 1;
        }
        if self.record.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("database_record.FindDatabaseRecordResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if self.found {
            struct_ser.serialize_field("found", &self.found)?;
        }
        if let Some(v) = self.record.as_ref() {
            struct_ser.serialize_field("record", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for FindDatabaseRecordResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "found",
            "record",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Found,
            Record,
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
                            "found" => Ok(GeneratedField::Found),
                            "record" => Ok(GeneratedField::Record),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = FindDatabaseRecordResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct database_record.FindDatabaseRecordResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<FindDatabaseRecordResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut found__ = None;
                let mut record__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Found => {
                            if found__.is_some() {
                                return Err(serde::de::Error::duplicate_field("found"));
                            }
                            found__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Record => {
                            if record__.is_some() {
                                return Err(serde::de::Error::duplicate_field("record"));
                            }
                            record__ = map_.next_value()?;
                        }
                    }
                }
                Ok(FindDatabaseRecordResponse {
                    status: status__,
                    found: found__.unwrap_or_default(),
                    record: record__,
                })
            }
        }
        deserializer.deserialize_struct("database_record.FindDatabaseRecordResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetDatabaseRecordRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.database_id.is_empty() {
            len += 1;
        }
        if !self.record_id.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("database_record.GetDatabaseRecordRequest", len)?;
        if !self.database_id.is_empty() {
            struct_ser.serialize_field("databaseId", &self.database_id)?;
        }
        if !self.record_id.is_empty() {
            struct_ser.serialize_field("recordId", &self.record_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetDatabaseRecordRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "database_id",
            "databaseId",
            "record_id",
            "recordId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            DatabaseId,
            RecordId,
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
                            "databaseId" | "database_id" => Ok(GeneratedField::DatabaseId),
                            "recordId" | "record_id" => Ok(GeneratedField::RecordId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetDatabaseRecordRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct database_record.GetDatabaseRecordRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetDatabaseRecordRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut database_id__ = None;
                let mut record_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::DatabaseId => {
                            if database_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("databaseId"));
                            }
                            database_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::RecordId => {
                            if record_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("recordId"));
                            }
                            record_id__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(GetDatabaseRecordRequest {
                    database_id: database_id__.unwrap_or_default(),
                    record_id: record_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("database_record.GetDatabaseRecordRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetDatabaseRecordResponse {
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
        if self.found {
            len += 1;
        }
        if self.record.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("database_record.GetDatabaseRecordResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if self.found {
            struct_ser.serialize_field("found", &self.found)?;
        }
        if let Some(v) = self.record.as_ref() {
            struct_ser.serialize_field("record", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetDatabaseRecordResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "found",
            "record",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Found,
            Record,
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
                            "found" => Ok(GeneratedField::Found),
                            "record" => Ok(GeneratedField::Record),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetDatabaseRecordResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct database_record.GetDatabaseRecordResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetDatabaseRecordResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut found__ = None;
                let mut record__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Found => {
                            if found__.is_some() {
                                return Err(serde::de::Error::duplicate_field("found"));
                            }
                            found__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Record => {
                            if record__.is_some() {
                                return Err(serde::de::Error::duplicate_field("record"));
                            }
                            record__ = map_.next_value()?;
                        }
                    }
                }
                Ok(GetDatabaseRecordResponse {
                    status: status__,
                    found: found__.unwrap_or_default(),
                    record: record__,
                })
            }
        }
        deserializer.deserialize_struct("database_record.GetDatabaseRecordResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListDatabaseRecordsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.database_id.is_empty() {
            len += 1;
        }
        if !self.sort_by.is_empty() {
            len += 1;
        }
        if self.descending {
            len += 1;
        }
        if self.offset != 0 {
            len += 1;
        }
        if self.limit != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("database_record.ListDatabaseRecordsRequest", len)?;
        if !self.database_id.is_empty() {
            struct_ser.serialize_field("databaseId", &self.database_id)?;
        }
        if !self.sort_by.is_empty() {
            struct_ser.serialize_field("sortBy", &self.sort_by)?;
        }
        if self.descending {
            struct_ser.serialize_field("descending", &self.descending)?;
        }
        if self.offset != 0 {
            struct_ser.serialize_field("offset", &self.offset)?;
        }
        if self.limit != 0 {
            struct_ser.serialize_field("limit", &self.limit)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListDatabaseRecordsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "database_id",
            "databaseId",
            "sort_by",
            "sortBy",
            "descending",
            "offset",
            "limit",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            DatabaseId,
            SortBy,
            Descending,
            Offset,
            Limit,
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
                            "databaseId" | "database_id" => Ok(GeneratedField::DatabaseId),
                            "sortBy" | "sort_by" => Ok(GeneratedField::SortBy),
                            "descending" => Ok(GeneratedField::Descending),
                            "offset" => Ok(GeneratedField::Offset),
                            "limit" => Ok(GeneratedField::Limit),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListDatabaseRecordsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct database_record.ListDatabaseRecordsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListDatabaseRecordsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut database_id__ = None;
                let mut sort_by__ = None;
                let mut descending__ = None;
                let mut offset__ = None;
                let mut limit__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::DatabaseId => {
                            if database_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("databaseId"));
                            }
                            database_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SortBy => {
                            if sort_by__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sortBy"));
                            }
                            sort_by__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Descending => {
                            if descending__.is_some() {
                                return Err(serde::de::Error::duplicate_field("descending"));
                            }
                            descending__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Offset => {
                            if offset__.is_some() {
                                return Err(serde::de::Error::duplicate_field("offset"));
                            }
                            offset__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Limit => {
                            if limit__.is_some() {
                                return Err(serde::de::Error::duplicate_field("limit"));
                            }
                            limit__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(ListDatabaseRecordsRequest {
                    database_id: database_id__.unwrap_or_default(),
                    sort_by: sort_by__.unwrap_or_default(),
                    descending: descending__.unwrap_or_default(),
                    offset: offset__.unwrap_or_default(),
                    limit: limit__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("database_record.ListDatabaseRecordsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListDatabaseRecordsResponse {
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
        if !self.records.is_empty() {
            len += 1;
        }
        if self.total != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("database_record.ListDatabaseRecordsResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.records.is_empty() {
            struct_ser.serialize_field("records", &self.records)?;
        }
        if self.total != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("total", ToString::to_string(&self.total).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListDatabaseRecordsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "records",
            "total",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Records,
            Total,
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
                            "records" => Ok(GeneratedField::Records),
                            "total" => Ok(GeneratedField::Total),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListDatabaseRecordsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct database_record.ListDatabaseRecordsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListDatabaseRecordsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut records__ = None;
                let mut total__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Records => {
                            if records__.is_some() {
                                return Err(serde::de::Error::duplicate_field("records"));
                            }
                            records__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Total => {
                            if total__.is_some() {
                                return Err(serde::de::Error::duplicate_field("total"));
                            }
                            total__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(ListDatabaseRecordsResponse {
                    status: status__,
                    records: records__.unwrap_or_default(),
                    total: total__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("database_record.ListDatabaseRecordsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListPublicDatabaseRecordsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.database_id.is_empty() {
            len += 1;
        }
        if self.offset != 0 {
            len += 1;
        }
        if self.limit != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("database_record.ListPublicDatabaseRecordsRequest", len)?;
        if !self.database_id.is_empty() {
            struct_ser.serialize_field("databaseId", &self.database_id)?;
        }
        if self.offset != 0 {
            struct_ser.serialize_field("offset", &self.offset)?;
        }
        if self.limit != 0 {
            struct_ser.serialize_field("limit", &self.limit)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListPublicDatabaseRecordsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "database_id",
            "databaseId",
            "offset",
            "limit",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            DatabaseId,
            Offset,
            Limit,
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
                            "databaseId" | "database_id" => Ok(GeneratedField::DatabaseId),
                            "offset" => Ok(GeneratedField::Offset),
                            "limit" => Ok(GeneratedField::Limit),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListPublicDatabaseRecordsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct database_record.ListPublicDatabaseRecordsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListPublicDatabaseRecordsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut database_id__ = None;
                let mut offset__ = None;
                let mut limit__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::DatabaseId => {
                            if database_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("databaseId"));
                            }
                            database_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Offset => {
                            if offset__.is_some() {
                                return Err(serde::de::Error::duplicate_field("offset"));
                            }
                            offset__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Limit => {
                            if limit__.is_some() {
                                return Err(serde::de::Error::duplicate_field("limit"));
                            }
                            limit__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(ListPublicDatabaseRecordsRequest {
                    database_id: database_id__.unwrap_or_default(),
                    offset: offset__.unwrap_or_default(),
                    limit: limit__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("database_record.ListPublicDatabaseRecordsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListPublicDatabaseRecordsResponse {
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
        if !self.records.is_empty() {
            len += 1;
        }
        if self.total != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("database_record.ListPublicDatabaseRecordsResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.records.is_empty() {
            struct_ser.serialize_field("records", &self.records)?;
        }
        if self.total != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("total", ToString::to_string(&self.total).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListPublicDatabaseRecordsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "records",
            "total",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Records,
            Total,
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
                            "records" => Ok(GeneratedField::Records),
                            "total" => Ok(GeneratedField::Total),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListPublicDatabaseRecordsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct database_record.ListPublicDatabaseRecordsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListPublicDatabaseRecordsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut records__ = None;
                let mut total__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Records => {
                            if records__.is_some() {
                                return Err(serde::de::Error::duplicate_field("records"));
                            }
                            records__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Total => {
                            if total__.is_some() {
                                return Err(serde::de::Error::duplicate_field("total"));
                            }
                            total__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(ListPublicDatabaseRecordsResponse {
                    status: status__,
                    records: records__.unwrap_or_default(),
                    total: total__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("database_record.ListPublicDatabaseRecordsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for UpdateDatabaseRecordRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.database_id.is_empty() {
            len += 1;
        }
        if !self.record_id.is_empty() {
            len += 1;
        }
        if self.expected_revision.is_some() {
            len += 1;
        }
        if self.values.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("database_record.UpdateDatabaseRecordRequest", len)?;
        if !self.database_id.is_empty() {
            struct_ser.serialize_field("databaseId", &self.database_id)?;
        }
        if !self.record_id.is_empty() {
            struct_ser.serialize_field("recordId", &self.record_id)?;
        }
        if let Some(v) = self.expected_revision.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("expectedRevision", ToString::to_string(&v).as_str())?;
        }
        if let Some(v) = self.values.as_ref() {
            match v {
                update_database_record_request::Values::TypedValuesJson(v) => {
                    struct_ser.serialize_field("typedValuesJson", v)?;
                }
                update_database_record_request::Values::TextValues(v) => {
                    struct_ser.serialize_field("textValues", v)?;
                }
            }
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for UpdateDatabaseRecordRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "database_id",
            "databaseId",
            "record_id",
            "recordId",
            "expected_revision",
            "expectedRevision",
            "typed_values_json",
            "typedValuesJson",
            "text_values",
            "textValues",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            DatabaseId,
            RecordId,
            ExpectedRevision,
            TypedValuesJson,
            TextValues,
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
                            "databaseId" | "database_id" => Ok(GeneratedField::DatabaseId),
                            "recordId" | "record_id" => Ok(GeneratedField::RecordId),
                            "expectedRevision" | "expected_revision" => Ok(GeneratedField::ExpectedRevision),
                            "typedValuesJson" | "typed_values_json" => Ok(GeneratedField::TypedValuesJson),
                            "textValues" | "text_values" => Ok(GeneratedField::TextValues),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = UpdateDatabaseRecordRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct database_record.UpdateDatabaseRecordRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<UpdateDatabaseRecordRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut database_id__ = None;
                let mut record_id__ = None;
                let mut expected_revision__ = None;
                let mut values__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::DatabaseId => {
                            if database_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("databaseId"));
                            }
                            database_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::RecordId => {
                            if record_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("recordId"));
                            }
                            record_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ExpectedRevision => {
                            if expected_revision__.is_some() {
                                return Err(serde::de::Error::duplicate_field("expectedRevision"));
                            }
                            expected_revision__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::TypedValuesJson => {
                            if values__.is_some() {
                                return Err(serde::de::Error::duplicate_field("typedValuesJson"));
                            }
                            values__ = map_.next_value::<::std::option::Option<_>>()?.map(update_database_record_request::Values::TypedValuesJson);
                        }
                        GeneratedField::TextValues => {
                            if values__.is_some() {
                                return Err(serde::de::Error::duplicate_field("textValues"));
                            }
                            values__ = map_.next_value::<::std::option::Option<_>>()?.map(update_database_record_request::Values::TextValues)
;
                        }
                    }
                }
                Ok(UpdateDatabaseRecordRequest {
                    database_id: database_id__.unwrap_or_default(),
                    record_id: record_id__.unwrap_or_default(),
                    expected_revision: expected_revision__,
                    values: values__,
                })
            }
        }
        deserializer.deserialize_struct("database_record.UpdateDatabaseRecordRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for UpdateDatabaseRecordResponse {
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
        if self.updated {
            len += 1;
        }
        if self.record.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("database_record.UpdateDatabaseRecordResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if self.updated {
            struct_ser.serialize_field("updated", &self.updated)?;
        }
        if let Some(v) = self.record.as_ref() {
            struct_ser.serialize_field("record", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for UpdateDatabaseRecordResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "updated",
            "record",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Updated,
            Record,
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
                            "updated" => Ok(GeneratedField::Updated),
                            "record" => Ok(GeneratedField::Record),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = UpdateDatabaseRecordResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct database_record.UpdateDatabaseRecordResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<UpdateDatabaseRecordResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut updated__ = None;
                let mut record__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Updated => {
                            if updated__.is_some() {
                                return Err(serde::de::Error::duplicate_field("updated"));
                            }
                            updated__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Record => {
                            if record__.is_some() {
                                return Err(serde::de::Error::duplicate_field("record"));
                            }
                            record__ = map_.next_value()?;
                        }
                    }
                }
                Ok(UpdateDatabaseRecordResponse {
                    status: status__,
                    updated: updated__.unwrap_or_default(),
                    record: record__,
                })
            }
        }
        deserializer.deserialize_struct("database_record.UpdateDatabaseRecordResponse", FIELDS, GeneratedVisitor)
    }
}
