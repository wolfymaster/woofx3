// @generated
impl serde::Serialize for AddWorkflowGroupMembersRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.group_id.is_empty() {
            len += 1;
        }
        if !self.workflow_ids.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow_group.AddWorkflowGroupMembersRequest", len)?;
        if !self.group_id.is_empty() {
            struct_ser.serialize_field("groupId", &self.group_id)?;
        }
        if !self.workflow_ids.is_empty() {
            struct_ser.serialize_field("workflowIds", &self.workflow_ids)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for AddWorkflowGroupMembersRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "group_id",
            "groupId",
            "workflow_ids",
            "workflowIds",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            GroupId,
            WorkflowIds,
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
                            "groupId" | "group_id" => Ok(GeneratedField::GroupId),
                            "workflowIds" | "workflow_ids" => Ok(GeneratedField::WorkflowIds),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = AddWorkflowGroupMembersRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow_group.AddWorkflowGroupMembersRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<AddWorkflowGroupMembersRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut group_id__ = None;
                let mut workflow_ids__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::GroupId => {
                            if group_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("groupId"));
                            }
                            group_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::WorkflowIds => {
                            if workflow_ids__.is_some() {
                                return Err(serde::de::Error::duplicate_field("workflowIds"));
                            }
                            workflow_ids__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(AddWorkflowGroupMembersRequest {
                    group_id: group_id__.unwrap_or_default(),
                    workflow_ids: workflow_ids__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow_group.AddWorkflowGroupMembersRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for AddWorkflowGroupMembersResponse {
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
        if self.group.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow_group.AddWorkflowGroupMembersResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.group.as_ref() {
            struct_ser.serialize_field("group", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for AddWorkflowGroupMembersResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "group",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Group,
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
                            "group" => Ok(GeneratedField::Group),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = AddWorkflowGroupMembersResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow_group.AddWorkflowGroupMembersResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<AddWorkflowGroupMembersResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut group__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Group => {
                            if group__.is_some() {
                                return Err(serde::de::Error::duplicate_field("group"));
                            }
                            group__ = map_.next_value()?;
                        }
                    }
                }
                Ok(AddWorkflowGroupMembersResponse {
                    status: status__,
                    group: group__,
                })
            }
        }
        deserializer.deserialize_struct("workflow_group.AddWorkflowGroupMembersResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for CreateWorkflowGroupRequest {
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
        let mut struct_ser = serializer.serialize_struct("workflow_group.CreateWorkflowGroupRequest", len)?;
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CreateWorkflowGroupRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "name",
            "description",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Name,
            Description,
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
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CreateWorkflowGroupRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow_group.CreateWorkflowGroupRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CreateWorkflowGroupRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut name__ = None;
                let mut description__ = None;
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
                    }
                }
                Ok(CreateWorkflowGroupRequest {
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow_group.CreateWorkflowGroupRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for CreateWorkflowGroupResponse {
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
        if self.group.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow_group.CreateWorkflowGroupResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.group.as_ref() {
            struct_ser.serialize_field("group", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CreateWorkflowGroupResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "group",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Group,
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
                            "group" => Ok(GeneratedField::Group),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CreateWorkflowGroupResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow_group.CreateWorkflowGroupResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CreateWorkflowGroupResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut group__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Group => {
                            if group__.is_some() {
                                return Err(serde::de::Error::duplicate_field("group"));
                            }
                            group__ = map_.next_value()?;
                        }
                    }
                }
                Ok(CreateWorkflowGroupResponse {
                    status: status__,
                    group: group__,
                })
            }
        }
        deserializer.deserialize_struct("workflow_group.CreateWorkflowGroupResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DeleteWorkflowGroupRequest {
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
        let mut struct_ser = serializer.serialize_struct("workflow_group.DeleteWorkflowGroupRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DeleteWorkflowGroupRequest {
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
            type Value = DeleteWorkflowGroupRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow_group.DeleteWorkflowGroupRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DeleteWorkflowGroupRequest, V::Error>
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
                Ok(DeleteWorkflowGroupRequest {
                    id: id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow_group.DeleteWorkflowGroupRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DeleteWorkflowGroupResponse {
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
        let mut struct_ser = serializer.serialize_struct("workflow_group.DeleteWorkflowGroupResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DeleteWorkflowGroupResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
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
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = DeleteWorkflowGroupResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow_group.DeleteWorkflowGroupResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DeleteWorkflowGroupResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                    }
                }
                Ok(DeleteWorkflowGroupResponse {
                    status: status__,
                })
            }
        }
        deserializer.deserialize_struct("workflow_group.DeleteWorkflowGroupResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListWorkflowGroupsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let len = 0;
        let struct_ser = serializer.serialize_struct("workflow_group.ListWorkflowGroupsRequest", len)?;
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListWorkflowGroupsRequest {
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
            type Value = ListWorkflowGroupsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow_group.ListWorkflowGroupsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListWorkflowGroupsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                while map_.next_key::<GeneratedField>()?.is_some() {
                    let _ = map_.next_value::<serde::de::IgnoredAny>()?;
                }
                Ok(ListWorkflowGroupsRequest {
                })
            }
        }
        deserializer.deserialize_struct("workflow_group.ListWorkflowGroupsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListWorkflowGroupsResponse {
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
        if !self.groups.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow_group.ListWorkflowGroupsResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.groups.is_empty() {
            struct_ser.serialize_field("groups", &self.groups)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListWorkflowGroupsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "groups",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Groups,
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
                            "groups" => Ok(GeneratedField::Groups),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListWorkflowGroupsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow_group.ListWorkflowGroupsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListWorkflowGroupsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut groups__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Groups => {
                            if groups__.is_some() {
                                return Err(serde::de::Error::duplicate_field("groups"));
                            }
                            groups__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListWorkflowGroupsResponse {
                    status: status__,
                    groups: groups__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow_group.ListWorkflowGroupsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RemoveWorkflowGroupMembersRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.group_id.is_empty() {
            len += 1;
        }
        if !self.workflow_ids.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow_group.RemoveWorkflowGroupMembersRequest", len)?;
        if !self.group_id.is_empty() {
            struct_ser.serialize_field("groupId", &self.group_id)?;
        }
        if !self.workflow_ids.is_empty() {
            struct_ser.serialize_field("workflowIds", &self.workflow_ids)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RemoveWorkflowGroupMembersRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "group_id",
            "groupId",
            "workflow_ids",
            "workflowIds",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            GroupId,
            WorkflowIds,
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
                            "groupId" | "group_id" => Ok(GeneratedField::GroupId),
                            "workflowIds" | "workflow_ids" => Ok(GeneratedField::WorkflowIds),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RemoveWorkflowGroupMembersRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow_group.RemoveWorkflowGroupMembersRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RemoveWorkflowGroupMembersRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut group_id__ = None;
                let mut workflow_ids__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::GroupId => {
                            if group_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("groupId"));
                            }
                            group_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::WorkflowIds => {
                            if workflow_ids__.is_some() {
                                return Err(serde::de::Error::duplicate_field("workflowIds"));
                            }
                            workflow_ids__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RemoveWorkflowGroupMembersRequest {
                    group_id: group_id__.unwrap_or_default(),
                    workflow_ids: workflow_ids__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow_group.RemoveWorkflowGroupMembersRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RemoveWorkflowGroupMembersResponse {
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
        if self.group.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow_group.RemoveWorkflowGroupMembersResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.group.as_ref() {
            struct_ser.serialize_field("group", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RemoveWorkflowGroupMembersResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "group",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Group,
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
                            "group" => Ok(GeneratedField::Group),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RemoveWorkflowGroupMembersResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow_group.RemoveWorkflowGroupMembersResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RemoveWorkflowGroupMembersResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut group__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Group => {
                            if group__.is_some() {
                                return Err(serde::de::Error::duplicate_field("group"));
                            }
                            group__ = map_.next_value()?;
                        }
                    }
                }
                Ok(RemoveWorkflowGroupMembersResponse {
                    status: status__,
                    group: group__,
                })
            }
        }
        deserializer.deserialize_struct("workflow_group.RemoveWorkflowGroupMembersResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SetWorkflowGroupEnabledRequest {
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
        if self.enabled {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow_group.SetWorkflowGroupEnabledRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if self.enabled {
            struct_ser.serialize_field("enabled", &self.enabled)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SetWorkflowGroupEnabledRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "enabled",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Enabled,
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
                            "enabled" => Ok(GeneratedField::Enabled),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = SetWorkflowGroupEnabledRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow_group.SetWorkflowGroupEnabledRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SetWorkflowGroupEnabledRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut enabled__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Enabled => {
                            if enabled__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enabled"));
                            }
                            enabled__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(SetWorkflowGroupEnabledRequest {
                    id: id__.unwrap_or_default(),
                    enabled: enabled__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow_group.SetWorkflowGroupEnabledRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SetWorkflowGroupEnabledResponse {
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
        if self.group.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow_group.SetWorkflowGroupEnabledResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.group.as_ref() {
            struct_ser.serialize_field("group", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SetWorkflowGroupEnabledResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "group",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Group,
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
                            "group" => Ok(GeneratedField::Group),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = SetWorkflowGroupEnabledResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow_group.SetWorkflowGroupEnabledResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SetWorkflowGroupEnabledResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut group__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Group => {
                            if group__.is_some() {
                                return Err(serde::de::Error::duplicate_field("group"));
                            }
                            group__ = map_.next_value()?;
                        }
                    }
                }
                Ok(SetWorkflowGroupEnabledResponse {
                    status: status__,
                    group: group__,
                })
            }
        }
        deserializer.deserialize_struct("workflow_group.SetWorkflowGroupEnabledResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for UpdateWorkflowGroupRequest {
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
        let mut struct_ser = serializer.serialize_struct("workflow_group.UpdateWorkflowGroupRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for UpdateWorkflowGroupRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "name",
            "description",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Name,
            Description,
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
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = UpdateWorkflowGroupRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow_group.UpdateWorkflowGroupRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<UpdateWorkflowGroupRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut name__ = None;
                let mut description__ = None;
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
                    }
                }
                Ok(UpdateWorkflowGroupRequest {
                    id: id__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow_group.UpdateWorkflowGroupRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for UpdateWorkflowGroupResponse {
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
        if self.group.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow_group.UpdateWorkflowGroupResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.group.as_ref() {
            struct_ser.serialize_field("group", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for UpdateWorkflowGroupResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "group",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Group,
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
                            "group" => Ok(GeneratedField::Group),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = UpdateWorkflowGroupResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow_group.UpdateWorkflowGroupResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<UpdateWorkflowGroupResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut group__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Group => {
                            if group__.is_some() {
                                return Err(serde::de::Error::duplicate_field("group"));
                            }
                            group__ = map_.next_value()?;
                        }
                    }
                }
                Ok(UpdateWorkflowGroupResponse {
                    status: status__,
                    group: group__,
                })
            }
        }
        deserializer.deserialize_struct("workflow_group.UpdateWorkflowGroupResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for WorkflowGroup {
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
        if self.enabled {
            len += 1;
        }
        if !self.member_ids.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow_group.WorkflowGroup", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if self.enabled {
            struct_ser.serialize_field("enabled", &self.enabled)?;
        }
        if !self.member_ids.is_empty() {
            struct_ser.serialize_field("memberIds", &self.member_ids)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for WorkflowGroup {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "name",
            "description",
            "enabled",
            "member_ids",
            "memberIds",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Name,
            Description,
            Enabled,
            MemberIds,
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
                            "enabled" => Ok(GeneratedField::Enabled),
                            "memberIds" | "member_ids" => Ok(GeneratedField::MemberIds),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = WorkflowGroup;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow_group.WorkflowGroup")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<WorkflowGroup, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut name__ = None;
                let mut description__ = None;
                let mut enabled__ = None;
                let mut member_ids__ = None;
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
                        GeneratedField::Enabled => {
                            if enabled__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enabled"));
                            }
                            enabled__ = Some(map_.next_value()?);
                        }
                        GeneratedField::MemberIds => {
                            if member_ids__.is_some() {
                                return Err(serde::de::Error::duplicate_field("memberIds"));
                            }
                            member_ids__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(WorkflowGroup {
                    id: id__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    enabled: enabled__.unwrap_or_default(),
                    member_ids: member_ids__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow_group.WorkflowGroup", FIELDS, GeneratedVisitor)
    }
}
