// @generated
impl serde::Serialize for ApplyFactDeltasRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.source.is_empty() {
            len += 1;
        }
        if !self.event_id.is_empty() {
            len += 1;
        }
        if self.occurred_at.is_some() {
            len += 1;
        }
        if !self.session_stamp.is_empty() {
            len += 1;
        }
        if self.silent {
            len += 1;
        }
        if !self.deltas.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("viewer_fact.ApplyFactDeltasRequest", len)?;
        if !self.source.is_empty() {
            struct_ser.serialize_field("source", &self.source)?;
        }
        if !self.event_id.is_empty() {
            struct_ser.serialize_field("eventId", &self.event_id)?;
        }
        if let Some(v) = self.occurred_at.as_ref() {
            struct_ser.serialize_field("occurredAt", v)?;
        }
        if !self.session_stamp.is_empty() {
            struct_ser.serialize_field("sessionStamp", &self.session_stamp)?;
        }
        if self.silent {
            struct_ser.serialize_field("silent", &self.silent)?;
        }
        if !self.deltas.is_empty() {
            struct_ser.serialize_field("deltas", &self.deltas)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ApplyFactDeltasRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "source",
            "event_id",
            "eventId",
            "occurred_at",
            "occurredAt",
            "session_stamp",
            "sessionStamp",
            "silent",
            "deltas",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Source,
            EventId,
            OccurredAt,
            SessionStamp,
            Silent,
            Deltas,
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
                            "source" => Ok(GeneratedField::Source),
                            "eventId" | "event_id" => Ok(GeneratedField::EventId),
                            "occurredAt" | "occurred_at" => Ok(GeneratedField::OccurredAt),
                            "sessionStamp" | "session_stamp" => Ok(GeneratedField::SessionStamp),
                            "silent" => Ok(GeneratedField::Silent),
                            "deltas" => Ok(GeneratedField::Deltas),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ApplyFactDeltasRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct viewer_fact.ApplyFactDeltasRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ApplyFactDeltasRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut source__ = None;
                let mut event_id__ = None;
                let mut occurred_at__ = None;
                let mut session_stamp__ = None;
                let mut silent__ = None;
                let mut deltas__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Source => {
                            if source__.is_some() {
                                return Err(serde::de::Error::duplicate_field("source"));
                            }
                            source__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EventId => {
                            if event_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("eventId"));
                            }
                            event_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::OccurredAt => {
                            if occurred_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("occurredAt"));
                            }
                            occurred_at__ = map_.next_value()?;
                        }
                        GeneratedField::SessionStamp => {
                            if session_stamp__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sessionStamp"));
                            }
                            session_stamp__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Silent => {
                            if silent__.is_some() {
                                return Err(serde::de::Error::duplicate_field("silent"));
                            }
                            silent__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Deltas => {
                            if deltas__.is_some() {
                                return Err(serde::de::Error::duplicate_field("deltas"));
                            }
                            deltas__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ApplyFactDeltasRequest {
                    source: source__.unwrap_or_default(),
                    event_id: event_id__.unwrap_or_default(),
                    occurred_at: occurred_at__,
                    session_stamp: session_stamp__.unwrap_or_default(),
                    silent: silent__.unwrap_or_default(),
                    deltas: deltas__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("viewer_fact.ApplyFactDeltasRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ApplyFactDeltasResponse {
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
        if self.applied {
            len += 1;
        }
        if self.dropped != 0 {
            len += 1;
        }
        if !self.changes.is_empty() {
            len += 1;
        }
        if self.invalid != 0 {
            len += 1;
        }
        if self.skipped != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("viewer_fact.ApplyFactDeltasResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if self.applied {
            struct_ser.serialize_field("applied", &self.applied)?;
        }
        if self.dropped != 0 {
            struct_ser.serialize_field("dropped", &self.dropped)?;
        }
        if !self.changes.is_empty() {
            struct_ser.serialize_field("changes", &self.changes)?;
        }
        if self.invalid != 0 {
            struct_ser.serialize_field("invalid", &self.invalid)?;
        }
        if self.skipped != 0 {
            struct_ser.serialize_field("skipped", &self.skipped)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ApplyFactDeltasResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "applied",
            "dropped",
            "changes",
            "invalid",
            "skipped",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Applied,
            Dropped,
            Changes,
            Invalid,
            Skipped,
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
                            "applied" => Ok(GeneratedField::Applied),
                            "dropped" => Ok(GeneratedField::Dropped),
                            "changes" => Ok(GeneratedField::Changes),
                            "invalid" => Ok(GeneratedField::Invalid),
                            "skipped" => Ok(GeneratedField::Skipped),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ApplyFactDeltasResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct viewer_fact.ApplyFactDeltasResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ApplyFactDeltasResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut applied__ = None;
                let mut dropped__ = None;
                let mut changes__ = None;
                let mut invalid__ = None;
                let mut skipped__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Applied => {
                            if applied__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applied"));
                            }
                            applied__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Dropped => {
                            if dropped__.is_some() {
                                return Err(serde::de::Error::duplicate_field("dropped"));
                            }
                            dropped__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Changes => {
                            if changes__.is_some() {
                                return Err(serde::de::Error::duplicate_field("changes"));
                            }
                            changes__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Invalid => {
                            if invalid__.is_some() {
                                return Err(serde::de::Error::duplicate_field("invalid"));
                            }
                            invalid__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Skipped => {
                            if skipped__.is_some() {
                                return Err(serde::de::Error::duplicate_field("skipped"));
                            }
                            skipped__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(ApplyFactDeltasResponse {
                    status: status__,
                    applied: applied__.unwrap_or_default(),
                    dropped: dropped__.unwrap_or_default(),
                    changes: changes__.unwrap_or_default(),
                    invalid: invalid__.unwrap_or_default(),
                    skipped: skipped__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("viewer_fact.ApplyFactDeltasResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DeleteFactDefinitionRequest {
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
        let mut struct_ser = serializer.serialize_struct("viewer_fact.DeleteFactDefinitionRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DeleteFactDefinitionRequest {
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
            type Value = DeleteFactDefinitionRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct viewer_fact.DeleteFactDefinitionRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DeleteFactDefinitionRequest, V::Error>
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
                Ok(DeleteFactDefinitionRequest {
                    id: id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("viewer_fact.DeleteFactDefinitionRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for FactDefinition {
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
        if !self.definition.is_empty() {
            len += 1;
        }
        if !self.value_kind.is_empty() {
            len += 1;
        }
        if !self.window_kind.is_empty() {
            len += 1;
        }
        if self.revision != 0 {
            len += 1;
        }
        if !self.created_by_type.is_empty() {
            len += 1;
        }
        if !self.created_by_ref.is_empty() {
            len += 1;
        }
        if self.counting_since.is_some() {
            len += 1;
        }
        if self.backfilled_through.is_some() {
            len += 1;
        }
        if self.created_at.is_some() {
            len += 1;
        }
        if self.updated_at.is_some() {
            len += 1;
        }
        if !self.status.is_empty() {
            len += 1;
        }
        if !self.reason.is_empty() {
            len += 1;
        }
        if !self.sources.is_empty() {
            len += 1;
        }
        if !self.aggregate.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("viewer_fact.FactDefinition", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.definition.is_empty() {
            struct_ser.serialize_field("definition", &self.definition)?;
        }
        if !self.value_kind.is_empty() {
            struct_ser.serialize_field("valueKind", &self.value_kind)?;
        }
        if !self.window_kind.is_empty() {
            struct_ser.serialize_field("windowKind", &self.window_kind)?;
        }
        if self.revision != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("revision", ToString::to_string(&self.revision).as_str())?;
        }
        if !self.created_by_type.is_empty() {
            struct_ser.serialize_field("createdByType", &self.created_by_type)?;
        }
        if !self.created_by_ref.is_empty() {
            struct_ser.serialize_field("createdByRef", &self.created_by_ref)?;
        }
        if let Some(v) = self.counting_since.as_ref() {
            struct_ser.serialize_field("countingSince", v)?;
        }
        if let Some(v) = self.backfilled_through.as_ref() {
            struct_ser.serialize_field("backfilledThrough", v)?;
        }
        if let Some(v) = self.created_at.as_ref() {
            struct_ser.serialize_field("createdAt", v)?;
        }
        if let Some(v) = self.updated_at.as_ref() {
            struct_ser.serialize_field("updatedAt", v)?;
        }
        if !self.status.is_empty() {
            struct_ser.serialize_field("status", &self.status)?;
        }
        if !self.reason.is_empty() {
            struct_ser.serialize_field("reason", &self.reason)?;
        }
        if !self.sources.is_empty() {
            struct_ser.serialize_field("sources", &self.sources)?;
        }
        if !self.aggregate.is_empty() {
            struct_ser.serialize_field("aggregate", &self.aggregate)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for FactDefinition {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "name",
            "description",
            "definition",
            "value_kind",
            "valueKind",
            "window_kind",
            "windowKind",
            "revision",
            "created_by_type",
            "createdByType",
            "created_by_ref",
            "createdByRef",
            "counting_since",
            "countingSince",
            "backfilled_through",
            "backfilledThrough",
            "created_at",
            "createdAt",
            "updated_at",
            "updatedAt",
            "status",
            "reason",
            "sources",
            "aggregate",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Name,
            Description,
            Definition,
            ValueKind,
            WindowKind,
            Revision,
            CreatedByType,
            CreatedByRef,
            CountingSince,
            BackfilledThrough,
            CreatedAt,
            UpdatedAt,
            Status,
            Reason,
            Sources,
            Aggregate,
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
                            "definition" => Ok(GeneratedField::Definition),
                            "valueKind" | "value_kind" => Ok(GeneratedField::ValueKind),
                            "windowKind" | "window_kind" => Ok(GeneratedField::WindowKind),
                            "revision" => Ok(GeneratedField::Revision),
                            "createdByType" | "created_by_type" => Ok(GeneratedField::CreatedByType),
                            "createdByRef" | "created_by_ref" => Ok(GeneratedField::CreatedByRef),
                            "countingSince" | "counting_since" => Ok(GeneratedField::CountingSince),
                            "backfilledThrough" | "backfilled_through" => Ok(GeneratedField::BackfilledThrough),
                            "createdAt" | "created_at" => Ok(GeneratedField::CreatedAt),
                            "updatedAt" | "updated_at" => Ok(GeneratedField::UpdatedAt),
                            "status" => Ok(GeneratedField::Status),
                            "reason" => Ok(GeneratedField::Reason),
                            "sources" => Ok(GeneratedField::Sources),
                            "aggregate" => Ok(GeneratedField::Aggregate),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = FactDefinition;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct viewer_fact.FactDefinition")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<FactDefinition, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut name__ = None;
                let mut description__ = None;
                let mut definition__ = None;
                let mut value_kind__ = None;
                let mut window_kind__ = None;
                let mut revision__ = None;
                let mut created_by_type__ = None;
                let mut created_by_ref__ = None;
                let mut counting_since__ = None;
                let mut backfilled_through__ = None;
                let mut created_at__ = None;
                let mut updated_at__ = None;
                let mut status__ = None;
                let mut reason__ = None;
                let mut sources__ = None;
                let mut aggregate__ = None;
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
                        GeneratedField::Definition => {
                            if definition__.is_some() {
                                return Err(serde::de::Error::duplicate_field("definition"));
                            }
                            definition__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ValueKind => {
                            if value_kind__.is_some() {
                                return Err(serde::de::Error::duplicate_field("valueKind"));
                            }
                            value_kind__ = Some(map_.next_value()?);
                        }
                        GeneratedField::WindowKind => {
                            if window_kind__.is_some() {
                                return Err(serde::de::Error::duplicate_field("windowKind"));
                            }
                            window_kind__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Revision => {
                            if revision__.is_some() {
                                return Err(serde::de::Error::duplicate_field("revision"));
                            }
                            revision__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
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
                        GeneratedField::CountingSince => {
                            if counting_since__.is_some() {
                                return Err(serde::de::Error::duplicate_field("countingSince"));
                            }
                            counting_since__ = map_.next_value()?;
                        }
                        GeneratedField::BackfilledThrough => {
                            if backfilled_through__.is_some() {
                                return Err(serde::de::Error::duplicate_field("backfilledThrough"));
                            }
                            backfilled_through__ = map_.next_value()?;
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
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Reason => {
                            if reason__.is_some() {
                                return Err(serde::de::Error::duplicate_field("reason"));
                            }
                            reason__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Sources => {
                            if sources__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sources"));
                            }
                            sources__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Aggregate => {
                            if aggregate__.is_some() {
                                return Err(serde::de::Error::duplicate_field("aggregate"));
                            }
                            aggregate__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(FactDefinition {
                    id: id__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    definition: definition__.unwrap_or_default(),
                    value_kind: value_kind__.unwrap_or_default(),
                    window_kind: window_kind__.unwrap_or_default(),
                    revision: revision__.unwrap_or_default(),
                    created_by_type: created_by_type__.unwrap_or_default(),
                    created_by_ref: created_by_ref__.unwrap_or_default(),
                    counting_since: counting_since__,
                    backfilled_through: backfilled_through__,
                    created_at: created_at__,
                    updated_at: updated_at__,
                    status: status__.unwrap_or_default(),
                    reason: reason__.unwrap_or_default(),
                    sources: sources__.unwrap_or_default(),
                    aggregate: aggregate__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("viewer_fact.FactDefinition", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for FactDefinitionResponse {
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
        if self.definition.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("viewer_fact.FactDefinitionResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.definition.as_ref() {
            struct_ser.serialize_field("definition", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for FactDefinitionResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "definition",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Definition,
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
                            "definition" => Ok(GeneratedField::Definition),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = FactDefinitionResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct viewer_fact.FactDefinitionResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<FactDefinitionResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut definition__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Definition => {
                            if definition__.is_some() {
                                return Err(serde::de::Error::duplicate_field("definition"));
                            }
                            definition__ = map_.next_value()?;
                        }
                    }
                }
                Ok(FactDefinitionResponse {
                    status: status__,
                    definition: definition__,
                })
            }
        }
        deserializer.deserialize_struct("viewer_fact.FactDefinitionResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for FactDelta {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.fact_id.is_empty() {
            len += 1;
        }
        if self.revision != 0 {
            len += 1;
        }
        if !self.platform.is_empty() {
            len += 1;
        }
        if !self.subject_id.is_empty() {
            len += 1;
        }
        if self.subject_name.is_some() {
            len += 1;
        }
        if !self.op.is_empty() {
            len += 1;
        }
        if self.num.is_some() {
            len += 1;
        }
        if self.str.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("viewer_fact.FactDelta", len)?;
        if !self.fact_id.is_empty() {
            struct_ser.serialize_field("factId", &self.fact_id)?;
        }
        if self.revision != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("revision", ToString::to_string(&self.revision).as_str())?;
        }
        if !self.platform.is_empty() {
            struct_ser.serialize_field("platform", &self.platform)?;
        }
        if !self.subject_id.is_empty() {
            struct_ser.serialize_field("subjectId", &self.subject_id)?;
        }
        if let Some(v) = self.subject_name.as_ref() {
            struct_ser.serialize_field("subjectName", v)?;
        }
        if !self.op.is_empty() {
            struct_ser.serialize_field("op", &self.op)?;
        }
        if let Some(v) = self.num.as_ref() {
            struct_ser.serialize_field("num", v)?;
        }
        if let Some(v) = self.str.as_ref() {
            struct_ser.serialize_field("str", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for FactDelta {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "fact_id",
            "factId",
            "revision",
            "platform",
            "subject_id",
            "subjectId",
            "subject_name",
            "subjectName",
            "op",
            "num",
            "str",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            FactId,
            Revision,
            Platform,
            SubjectId,
            SubjectName,
            Op,
            Num,
            Str,
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
                            "factId" | "fact_id" => Ok(GeneratedField::FactId),
                            "revision" => Ok(GeneratedField::Revision),
                            "platform" => Ok(GeneratedField::Platform),
                            "subjectId" | "subject_id" => Ok(GeneratedField::SubjectId),
                            "subjectName" | "subject_name" => Ok(GeneratedField::SubjectName),
                            "op" => Ok(GeneratedField::Op),
                            "num" => Ok(GeneratedField::Num),
                            "str" => Ok(GeneratedField::Str),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = FactDelta;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct viewer_fact.FactDelta")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<FactDelta, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut fact_id__ = None;
                let mut revision__ = None;
                let mut platform__ = None;
                let mut subject_id__ = None;
                let mut subject_name__ = None;
                let mut op__ = None;
                let mut num__ = None;
                let mut str__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::FactId => {
                            if fact_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("factId"));
                            }
                            fact_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Revision => {
                            if revision__.is_some() {
                                return Err(serde::de::Error::duplicate_field("revision"));
                            }
                            revision__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Platform => {
                            if platform__.is_some() {
                                return Err(serde::de::Error::duplicate_field("platform"));
                            }
                            platform__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SubjectId => {
                            if subject_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("subjectId"));
                            }
                            subject_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SubjectName => {
                            if subject_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("subjectName"));
                            }
                            subject_name__ = map_.next_value()?;
                        }
                        GeneratedField::Op => {
                            if op__.is_some() {
                                return Err(serde::de::Error::duplicate_field("op"));
                            }
                            op__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Num => {
                            if num__.is_some() {
                                return Err(serde::de::Error::duplicate_field("num"));
                            }
                            num__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::Str => {
                            if str__.is_some() {
                                return Err(serde::de::Error::duplicate_field("str"));
                            }
                            str__ = map_.next_value()?;
                        }
                    }
                }
                Ok(FactDelta {
                    fact_id: fact_id__.unwrap_or_default(),
                    revision: revision__.unwrap_or_default(),
                    platform: platform__.unwrap_or_default(),
                    subject_id: subject_id__.unwrap_or_default(),
                    subject_name: subject_name__,
                    op: op__.unwrap_or_default(),
                    num: num__,
                    str: str__,
                })
            }
        }
        deserializer.deserialize_struct("viewer_fact.FactDelta", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for FactValue {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.num.is_some() {
            len += 1;
        }
        if self.str.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("viewer_fact.FactValue", len)?;
        if let Some(v) = self.num.as_ref() {
            struct_ser.serialize_field("num", v)?;
        }
        if let Some(v) = self.str.as_ref() {
            struct_ser.serialize_field("str", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for FactValue {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "num",
            "str",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Num,
            Str,
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
                            "num" => Ok(GeneratedField::Num),
                            "str" => Ok(GeneratedField::Str),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = FactValue;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct viewer_fact.FactValue")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<FactValue, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut num__ = None;
                let mut str__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Num => {
                            if num__.is_some() {
                                return Err(serde::de::Error::duplicate_field("num"));
                            }
                            num__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::Str => {
                            if str__.is_some() {
                                return Err(serde::de::Error::duplicate_field("str"));
                            }
                            str__ = map_.next_value()?;
                        }
                    }
                }
                Ok(FactValue {
                    num: num__,
                    str: str__,
                })
            }
        }
        deserializer.deserialize_struct("viewer_fact.FactValue", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for FactValueChange {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.fact_id.is_empty() {
            len += 1;
        }
        if !self.platform.is_empty() {
            len += 1;
        }
        if !self.subject_id.is_empty() {
            len += 1;
        }
        if !self.window_key.is_empty() {
            len += 1;
        }
        if self.subject_name.is_some() {
            len += 1;
        }
        if self.before.is_some() {
            len += 1;
        }
        if self.after.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("viewer_fact.FactValueChange", len)?;
        if !self.fact_id.is_empty() {
            struct_ser.serialize_field("factId", &self.fact_id)?;
        }
        if !self.platform.is_empty() {
            struct_ser.serialize_field("platform", &self.platform)?;
        }
        if !self.subject_id.is_empty() {
            struct_ser.serialize_field("subjectId", &self.subject_id)?;
        }
        if !self.window_key.is_empty() {
            struct_ser.serialize_field("windowKey", &self.window_key)?;
        }
        if let Some(v) = self.subject_name.as_ref() {
            struct_ser.serialize_field("subjectName", v)?;
        }
        if let Some(v) = self.before.as_ref() {
            struct_ser.serialize_field("before", v)?;
        }
        if let Some(v) = self.after.as_ref() {
            struct_ser.serialize_field("after", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for FactValueChange {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "fact_id",
            "factId",
            "platform",
            "subject_id",
            "subjectId",
            "window_key",
            "windowKey",
            "subject_name",
            "subjectName",
            "before",
            "after",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            FactId,
            Platform,
            SubjectId,
            WindowKey,
            SubjectName,
            Before,
            After,
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
                            "factId" | "fact_id" => Ok(GeneratedField::FactId),
                            "platform" => Ok(GeneratedField::Platform),
                            "subjectId" | "subject_id" => Ok(GeneratedField::SubjectId),
                            "windowKey" | "window_key" => Ok(GeneratedField::WindowKey),
                            "subjectName" | "subject_name" => Ok(GeneratedField::SubjectName),
                            "before" => Ok(GeneratedField::Before),
                            "after" => Ok(GeneratedField::After),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = FactValueChange;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct viewer_fact.FactValueChange")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<FactValueChange, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut fact_id__ = None;
                let mut platform__ = None;
                let mut subject_id__ = None;
                let mut window_key__ = None;
                let mut subject_name__ = None;
                let mut before__ = None;
                let mut after__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::FactId => {
                            if fact_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("factId"));
                            }
                            fact_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Platform => {
                            if platform__.is_some() {
                                return Err(serde::de::Error::duplicate_field("platform"));
                            }
                            platform__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SubjectId => {
                            if subject_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("subjectId"));
                            }
                            subject_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::WindowKey => {
                            if window_key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("windowKey"));
                            }
                            window_key__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SubjectName => {
                            if subject_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("subjectName"));
                            }
                            subject_name__ = map_.next_value()?;
                        }
                        GeneratedField::Before => {
                            if before__.is_some() {
                                return Err(serde::de::Error::duplicate_field("before"));
                            }
                            before__ = map_.next_value()?;
                        }
                        GeneratedField::After => {
                            if after__.is_some() {
                                return Err(serde::de::Error::duplicate_field("after"));
                            }
                            after__ = map_.next_value()?;
                        }
                    }
                }
                Ok(FactValueChange {
                    fact_id: fact_id__.unwrap_or_default(),
                    platform: platform__.unwrap_or_default(),
                    subject_id: subject_id__.unwrap_or_default(),
                    window_key: window_key__.unwrap_or_default(),
                    subject_name: subject_name__,
                    before: before__,
                    after: after__,
                })
            }
        }
        deserializer.deserialize_struct("viewer_fact.FactValueChange", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetViewerFactsRequest {
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
        if !self.subject_id.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("viewer_fact.GetViewerFactsRequest", len)?;
        if !self.platform.is_empty() {
            struct_ser.serialize_field("platform", &self.platform)?;
        }
        if !self.subject_id.is_empty() {
            struct_ser.serialize_field("subjectId", &self.subject_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetViewerFactsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "platform",
            "subject_id",
            "subjectId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Platform,
            SubjectId,
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
                            "subjectId" | "subject_id" => Ok(GeneratedField::SubjectId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetViewerFactsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct viewer_fact.GetViewerFactsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetViewerFactsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut platform__ = None;
                let mut subject_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Platform => {
                            if platform__.is_some() {
                                return Err(serde::de::Error::duplicate_field("platform"));
                            }
                            platform__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SubjectId => {
                            if subject_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("subjectId"));
                            }
                            subject_id__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(GetViewerFactsRequest {
                    platform: platform__.unwrap_or_default(),
                    subject_id: subject_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("viewer_fact.GetViewerFactsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetViewerFactsResponse {
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
        if !self.session_id.is_empty() {
            len += 1;
        }
        if self.subject_name.is_some() {
            len += 1;
        }
        if !self.values.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("viewer_fact.GetViewerFactsResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.session_id.is_empty() {
            struct_ser.serialize_field("sessionId", &self.session_id)?;
        }
        if let Some(v) = self.subject_name.as_ref() {
            struct_ser.serialize_field("subjectName", v)?;
        }
        if !self.values.is_empty() {
            struct_ser.serialize_field("values", &self.values)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetViewerFactsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "session_id",
            "sessionId",
            "subject_name",
            "subjectName",
            "values",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            SessionId,
            SubjectName,
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
                            "status" => Ok(GeneratedField::Status),
                            "sessionId" | "session_id" => Ok(GeneratedField::SessionId),
                            "subjectName" | "subject_name" => Ok(GeneratedField::SubjectName),
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
            type Value = GetViewerFactsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct viewer_fact.GetViewerFactsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetViewerFactsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut session_id__ = None;
                let mut subject_name__ = None;
                let mut values__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::SessionId => {
                            if session_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sessionId"));
                            }
                            session_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SubjectName => {
                            if subject_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("subjectName"));
                            }
                            subject_name__ = map_.next_value()?;
                        }
                        GeneratedField::Values => {
                            if values__.is_some() {
                                return Err(serde::de::Error::duplicate_field("values"));
                            }
                            values__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(GetViewerFactsResponse {
                    status: status__,
                    session_id: session_id__.unwrap_or_default(),
                    subject_name: subject_name__,
                    values: values__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("viewer_fact.GetViewerFactsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListFactDefinitionsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let len = 0;
        let struct_ser = serializer.serialize_struct("viewer_fact.ListFactDefinitionsRequest", len)?;
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListFactDefinitionsRequest {
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
            type Value = ListFactDefinitionsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct viewer_fact.ListFactDefinitionsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListFactDefinitionsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                while map_.next_key::<GeneratedField>()?.is_some() {
                    let _ = map_.next_value::<serde::de::IgnoredAny>()?;
                }
                Ok(ListFactDefinitionsRequest {
                })
            }
        }
        deserializer.deserialize_struct("viewer_fact.ListFactDefinitionsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListFactDefinitionsResponse {
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
        if !self.definitions.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("viewer_fact.ListFactDefinitionsResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.definitions.is_empty() {
            struct_ser.serialize_field("definitions", &self.definitions)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListFactDefinitionsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "definitions",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Definitions,
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
                            "definitions" => Ok(GeneratedField::Definitions),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListFactDefinitionsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct viewer_fact.ListFactDefinitionsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListFactDefinitionsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut definitions__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Definitions => {
                            if definitions__.is_some() {
                                return Err(serde::de::Error::duplicate_field("definitions"));
                            }
                            definitions__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListFactDefinitionsResponse {
                    status: status__,
                    definitions: definitions__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("viewer_fact.ListFactDefinitionsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ResolvedFactSource {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.trigger.is_empty() {
            len += 1;
        }
        if !self.event.is_empty() {
            len += 1;
        }
        if !self.subject_path.is_empty() {
            len += 1;
        }
        if self.subject_is_array {
            len += 1;
        }
        if !self.anonymous_when.is_empty() {
            len += 1;
        }
        if !self.display_name.is_empty() {
            len += 1;
        }
        if !self.value_path.is_empty() {
            len += 1;
        }
        if !self.r#where.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("viewer_fact.ResolvedFactSource", len)?;
        if !self.trigger.is_empty() {
            struct_ser.serialize_field("trigger", &self.trigger)?;
        }
        if !self.event.is_empty() {
            struct_ser.serialize_field("event", &self.event)?;
        }
        if !self.subject_path.is_empty() {
            struct_ser.serialize_field("subjectPath", &self.subject_path)?;
        }
        if self.subject_is_array {
            struct_ser.serialize_field("subjectIsArray", &self.subject_is_array)?;
        }
        if !self.anonymous_when.is_empty() {
            struct_ser.serialize_field("anonymousWhen", &self.anonymous_when)?;
        }
        if !self.display_name.is_empty() {
            struct_ser.serialize_field("displayName", &self.display_name)?;
        }
        if !self.value_path.is_empty() {
            struct_ser.serialize_field("valuePath", &self.value_path)?;
        }
        if !self.r#where.is_empty() {
            struct_ser.serialize_field("where", &self.r#where)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ResolvedFactSource {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "trigger",
            "event",
            "subject_path",
            "subjectPath",
            "subject_is_array",
            "subjectIsArray",
            "anonymous_when",
            "anonymousWhen",
            "display_name",
            "displayName",
            "value_path",
            "valuePath",
            "where",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Trigger,
            Event,
            SubjectPath,
            SubjectIsArray,
            AnonymousWhen,
            DisplayName,
            ValuePath,
            Where,
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
                            "trigger" => Ok(GeneratedField::Trigger),
                            "event" => Ok(GeneratedField::Event),
                            "subjectPath" | "subject_path" => Ok(GeneratedField::SubjectPath),
                            "subjectIsArray" | "subject_is_array" => Ok(GeneratedField::SubjectIsArray),
                            "anonymousWhen" | "anonymous_when" => Ok(GeneratedField::AnonymousWhen),
                            "displayName" | "display_name" => Ok(GeneratedField::DisplayName),
                            "valuePath" | "value_path" => Ok(GeneratedField::ValuePath),
                            "where" => Ok(GeneratedField::Where),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ResolvedFactSource;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct viewer_fact.ResolvedFactSource")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ResolvedFactSource, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut trigger__ = None;
                let mut event__ = None;
                let mut subject_path__ = None;
                let mut subject_is_array__ = None;
                let mut anonymous_when__ = None;
                let mut display_name__ = None;
                let mut value_path__ = None;
                let mut r#where__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Trigger => {
                            if trigger__.is_some() {
                                return Err(serde::de::Error::duplicate_field("trigger"));
                            }
                            trigger__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Event => {
                            if event__.is_some() {
                                return Err(serde::de::Error::duplicate_field("event"));
                            }
                            event__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SubjectPath => {
                            if subject_path__.is_some() {
                                return Err(serde::de::Error::duplicate_field("subjectPath"));
                            }
                            subject_path__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SubjectIsArray => {
                            if subject_is_array__.is_some() {
                                return Err(serde::de::Error::duplicate_field("subjectIsArray"));
                            }
                            subject_is_array__ = Some(map_.next_value()?);
                        }
                        GeneratedField::AnonymousWhen => {
                            if anonymous_when__.is_some() {
                                return Err(serde::de::Error::duplicate_field("anonymousWhen"));
                            }
                            anonymous_when__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DisplayName => {
                            if display_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("displayName"));
                            }
                            display_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ValuePath => {
                            if value_path__.is_some() {
                                return Err(serde::de::Error::duplicate_field("valuePath"));
                            }
                            value_path__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Where => {
                            if r#where__.is_some() {
                                return Err(serde::de::Error::duplicate_field("where"));
                            }
                            r#where__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ResolvedFactSource {
                    trigger: trigger__.unwrap_or_default(),
                    event: event__.unwrap_or_default(),
                    subject_path: subject_path__.unwrap_or_default(),
                    subject_is_array: subject_is_array__.unwrap_or_default(),
                    anonymous_when: anonymous_when__.unwrap_or_default(),
                    display_name: display_name__.unwrap_or_default(),
                    value_path: value_path__.unwrap_or_default(),
                    r#where: r#where__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("viewer_fact.ResolvedFactSource", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for UpsertFactDefinitionRequest {
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
        if !self.definition.is_empty() {
            len += 1;
        }
        if !self.window_kind.is_empty() {
            len += 1;
        }
        if !self.created_by_type.is_empty() {
            len += 1;
        }
        if !self.created_by_ref.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("viewer_fact.UpsertFactDefinitionRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.definition.is_empty() {
            struct_ser.serialize_field("definition", &self.definition)?;
        }
        if !self.window_kind.is_empty() {
            struct_ser.serialize_field("windowKind", &self.window_kind)?;
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
impl<'de> serde::Deserialize<'de> for UpsertFactDefinitionRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "name",
            "description",
            "definition",
            "window_kind",
            "windowKind",
            "created_by_type",
            "createdByType",
            "created_by_ref",
            "createdByRef",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Name,
            Description,
            Definition,
            WindowKind,
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
                            "name" => Ok(GeneratedField::Name),
                            "description" => Ok(GeneratedField::Description),
                            "definition" => Ok(GeneratedField::Definition),
                            "windowKind" | "window_kind" => Ok(GeneratedField::WindowKind),
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
            type Value = UpsertFactDefinitionRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct viewer_fact.UpsertFactDefinitionRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<UpsertFactDefinitionRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut name__ = None;
                let mut description__ = None;
                let mut definition__ = None;
                let mut window_kind__ = None;
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
                        GeneratedField::Definition => {
                            if definition__.is_some() {
                                return Err(serde::de::Error::duplicate_field("definition"));
                            }
                            definition__ = Some(map_.next_value()?);
                        }
                        GeneratedField::WindowKind => {
                            if window_kind__.is_some() {
                                return Err(serde::de::Error::duplicate_field("windowKind"));
                            }
                            window_kind__ = Some(map_.next_value()?);
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
                Ok(UpsertFactDefinitionRequest {
                    id: id__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    definition: definition__.unwrap_or_default(),
                    window_kind: window_kind__.unwrap_or_default(),
                    created_by_type: created_by_type__.unwrap_or_default(),
                    created_by_ref: created_by_ref__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("viewer_fact.UpsertFactDefinitionRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ViewerFactValue {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.fact_id.is_empty() {
            len += 1;
        }
        if !self.window_kind.is_empty() {
            len += 1;
        }
        if !self.value_kind.is_empty() {
            len += 1;
        }
        if self.value.is_some() {
            len += 1;
        }
        if self.updated_at.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("viewer_fact.ViewerFactValue", len)?;
        if !self.fact_id.is_empty() {
            struct_ser.serialize_field("factId", &self.fact_id)?;
        }
        if !self.window_kind.is_empty() {
            struct_ser.serialize_field("windowKind", &self.window_kind)?;
        }
        if !self.value_kind.is_empty() {
            struct_ser.serialize_field("valueKind", &self.value_kind)?;
        }
        if let Some(v) = self.value.as_ref() {
            struct_ser.serialize_field("value", v)?;
        }
        if let Some(v) = self.updated_at.as_ref() {
            struct_ser.serialize_field("updatedAt", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ViewerFactValue {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "fact_id",
            "factId",
            "window_kind",
            "windowKind",
            "value_kind",
            "valueKind",
            "value",
            "updated_at",
            "updatedAt",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            FactId,
            WindowKind,
            ValueKind,
            Value,
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
                            "factId" | "fact_id" => Ok(GeneratedField::FactId),
                            "windowKind" | "window_kind" => Ok(GeneratedField::WindowKind),
                            "valueKind" | "value_kind" => Ok(GeneratedField::ValueKind),
                            "value" => Ok(GeneratedField::Value),
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
            type Value = ViewerFactValue;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct viewer_fact.ViewerFactValue")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ViewerFactValue, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut fact_id__ = None;
                let mut window_kind__ = None;
                let mut value_kind__ = None;
                let mut value__ = None;
                let mut updated_at__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::FactId => {
                            if fact_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("factId"));
                            }
                            fact_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::WindowKind => {
                            if window_kind__.is_some() {
                                return Err(serde::de::Error::duplicate_field("windowKind"));
                            }
                            window_kind__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ValueKind => {
                            if value_kind__.is_some() {
                                return Err(serde::de::Error::duplicate_field("valueKind"));
                            }
                            value_kind__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Value => {
                            if value__.is_some() {
                                return Err(serde::de::Error::duplicate_field("value"));
                            }
                            value__ = map_.next_value()?;
                        }
                        GeneratedField::UpdatedAt => {
                            if updated_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("updatedAt"));
                            }
                            updated_at__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ViewerFactValue {
                    fact_id: fact_id__.unwrap_or_default(),
                    window_kind: window_kind__.unwrap_or_default(),
                    value_kind: value_kind__.unwrap_or_default(),
                    value: value__,
                    updated_at: updated_at__,
                })
            }
        }
        deserializer.deserialize_struct("viewer_fact.ViewerFactValue", FIELDS, GeneratedVisitor)
    }
}
