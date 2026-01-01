// @generated
impl serde::Serialize for CancelWorkflowExecutionRequest {
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
        if !self.reason.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow.CancelWorkflowExecutionRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.reason.is_empty() {
            struct_ser.serialize_field("reason", &self.reason)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CancelWorkflowExecutionRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "reason",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Reason,
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
                            "reason" => Ok(GeneratedField::Reason),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CancelWorkflowExecutionRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow.CancelWorkflowExecutionRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CancelWorkflowExecutionRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut reason__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Reason => {
                            if reason__.is_some() {
                                return Err(serde::de::Error::duplicate_field("reason"));
                            }
                            reason__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(CancelWorkflowExecutionRequest {
                    id: id__.unwrap_or_default(),
                    reason: reason__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow.CancelWorkflowExecutionRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for CreateWorkflowRequest {
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
        if !self.application_id.is_empty() {
            len += 1;
        }
        if !self.created_by.is_empty() {
            len += 1;
        }
        if self.enabled {
            len += 1;
        }
        if !self.steps.is_empty() {
            len += 1;
        }
        if !self.variables.is_empty() {
            len += 1;
        }
        if !self.on_success.is_empty() {
            len += 1;
        }
        if !self.on_failure.is_empty() {
            len += 1;
        }
        if self.max_retries != 0 {
            len += 1;
        }
        if self.timeout_seconds != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow.CreateWorkflowRequest", len)?;
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if !self.created_by.is_empty() {
            struct_ser.serialize_field("createdBy", &self.created_by)?;
        }
        if self.enabled {
            struct_ser.serialize_field("enabled", &self.enabled)?;
        }
        if !self.steps.is_empty() {
            struct_ser.serialize_field("steps", &self.steps)?;
        }
        if !self.variables.is_empty() {
            struct_ser.serialize_field("variables", &self.variables)?;
        }
        if !self.on_success.is_empty() {
            struct_ser.serialize_field("onSuccess", &self.on_success)?;
        }
        if !self.on_failure.is_empty() {
            struct_ser.serialize_field("onFailure", &self.on_failure)?;
        }
        if self.max_retries != 0 {
            struct_ser.serialize_field("maxRetries", &self.max_retries)?;
        }
        if self.timeout_seconds != 0 {
            struct_ser.serialize_field("timeoutSeconds", &self.timeout_seconds)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CreateWorkflowRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "name",
            "description",
            "application_id",
            "applicationId",
            "created_by",
            "createdBy",
            "enabled",
            "steps",
            "variables",
            "on_success",
            "onSuccess",
            "on_failure",
            "onFailure",
            "max_retries",
            "maxRetries",
            "timeout_seconds",
            "timeoutSeconds",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Name,
            Description,
            ApplicationId,
            CreatedBy,
            Enabled,
            Steps,
            Variables,
            OnSuccess,
            OnFailure,
            MaxRetries,
            TimeoutSeconds,
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
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            "createdBy" | "created_by" => Ok(GeneratedField::CreatedBy),
                            "enabled" => Ok(GeneratedField::Enabled),
                            "steps" => Ok(GeneratedField::Steps),
                            "variables" => Ok(GeneratedField::Variables),
                            "onSuccess" | "on_success" => Ok(GeneratedField::OnSuccess),
                            "onFailure" | "on_failure" => Ok(GeneratedField::OnFailure),
                            "maxRetries" | "max_retries" => Ok(GeneratedField::MaxRetries),
                            "timeoutSeconds" | "timeout_seconds" => Ok(GeneratedField::TimeoutSeconds),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CreateWorkflowRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow.CreateWorkflowRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CreateWorkflowRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut name__ = None;
                let mut description__ = None;
                let mut application_id__ = None;
                let mut created_by__ = None;
                let mut enabled__ = None;
                let mut steps__ = None;
                let mut variables__ = None;
                let mut on_success__ = None;
                let mut on_failure__ = None;
                let mut max_retries__ = None;
                let mut timeout_seconds__ = None;
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
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedBy => {
                            if created_by__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdBy"));
                            }
                            created_by__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Enabled => {
                            if enabled__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enabled"));
                            }
                            enabled__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Steps => {
                            if steps__.is_some() {
                                return Err(serde::de::Error::duplicate_field("steps"));
                            }
                            steps__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Variables => {
                            if variables__.is_some() {
                                return Err(serde::de::Error::duplicate_field("variables"));
                            }
                            variables__ = Some(
                                map_.next_value::<std::collections::HashMap<_, _>>()?
                            );
                        }
                        GeneratedField::OnSuccess => {
                            if on_success__.is_some() {
                                return Err(serde::de::Error::duplicate_field("onSuccess"));
                            }
                            on_success__ = Some(map_.next_value()?);
                        }
                        GeneratedField::OnFailure => {
                            if on_failure__.is_some() {
                                return Err(serde::de::Error::duplicate_field("onFailure"));
                            }
                            on_failure__ = Some(map_.next_value()?);
                        }
                        GeneratedField::MaxRetries => {
                            if max_retries__.is_some() {
                                return Err(serde::de::Error::duplicate_field("maxRetries"));
                            }
                            max_retries__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::TimeoutSeconds => {
                            if timeout_seconds__.is_some() {
                                return Err(serde::de::Error::duplicate_field("timeoutSeconds"));
                            }
                            timeout_seconds__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(CreateWorkflowRequest {
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    application_id: application_id__.unwrap_or_default(),
                    created_by: created_by__.unwrap_or_default(),
                    enabled: enabled__.unwrap_or_default(),
                    steps: steps__.unwrap_or_default(),
                    variables: variables__.unwrap_or_default(),
                    on_success: on_success__.unwrap_or_default(),
                    on_failure: on_failure__.unwrap_or_default(),
                    max_retries: max_retries__.unwrap_or_default(),
                    timeout_seconds: timeout_seconds__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow.CreateWorkflowRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DeleteWorkflowRequest {
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
        let mut struct_ser = serializer.serialize_struct("workflow.DeleteWorkflowRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DeleteWorkflowRequest {
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
            type Value = DeleteWorkflowRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow.DeleteWorkflowRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DeleteWorkflowRequest, V::Error>
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
                Ok(DeleteWorkflowRequest {
                    id: id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow.DeleteWorkflowRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ExecuteWorkflowRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.workflow_id.is_empty() {
            len += 1;
        }
        if !self.application_id.is_empty() {
            len += 1;
        }
        if !self.started_by.is_empty() {
            len += 1;
        }
        if !self.inputs.is_empty() {
            len += 1;
        }
        if self.r#async {
            len += 1;
        }
        if !self.correlation_id.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow.ExecuteWorkflowRequest", len)?;
        if !self.workflow_id.is_empty() {
            struct_ser.serialize_field("workflowId", &self.workflow_id)?;
        }
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if !self.started_by.is_empty() {
            struct_ser.serialize_field("startedBy", &self.started_by)?;
        }
        if !self.inputs.is_empty() {
            struct_ser.serialize_field("inputs", &self.inputs)?;
        }
        if self.r#async {
            struct_ser.serialize_field("async", &self.r#async)?;
        }
        if !self.correlation_id.is_empty() {
            struct_ser.serialize_field("correlationId", &self.correlation_id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ExecuteWorkflowRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "workflow_id",
            "workflowId",
            "application_id",
            "applicationId",
            "started_by",
            "startedBy",
            "inputs",
            "async",
            "correlation_id",
            "correlationId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            WorkflowId,
            ApplicationId,
            StartedBy,
            Inputs,
            Async,
            CorrelationId,
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
                            "workflowId" | "workflow_id" => Ok(GeneratedField::WorkflowId),
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            "startedBy" | "started_by" => Ok(GeneratedField::StartedBy),
                            "inputs" => Ok(GeneratedField::Inputs),
                            "async" => Ok(GeneratedField::Async),
                            "correlationId" | "correlation_id" => Ok(GeneratedField::CorrelationId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ExecuteWorkflowRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow.ExecuteWorkflowRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ExecuteWorkflowRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut workflow_id__ = None;
                let mut application_id__ = None;
                let mut started_by__ = None;
                let mut inputs__ = None;
                let mut r#async__ = None;
                let mut correlation_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::WorkflowId => {
                            if workflow_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("workflowId"));
                            }
                            workflow_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::StartedBy => {
                            if started_by__.is_some() {
                                return Err(serde::de::Error::duplicate_field("startedBy"));
                            }
                            started_by__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Inputs => {
                            if inputs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("inputs"));
                            }
                            inputs__ = Some(
                                map_.next_value::<std::collections::HashMap<_, _>>()?
                            );
                        }
                        GeneratedField::Async => {
                            if r#async__.is_some() {
                                return Err(serde::de::Error::duplicate_field("async"));
                            }
                            r#async__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CorrelationId => {
                            if correlation_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("correlationId"));
                            }
                            correlation_id__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ExecuteWorkflowRequest {
                    workflow_id: workflow_id__.unwrap_or_default(),
                    application_id: application_id__.unwrap_or_default(),
                    started_by: started_by__.unwrap_or_default(),
                    inputs: inputs__.unwrap_or_default(),
                    r#async: r#async__.unwrap_or_default(),
                    correlation_id: correlation_id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow.ExecuteWorkflowRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ExecuteWorkflowResponse {
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
        if !self.execution_id.is_empty() {
            len += 1;
        }
        if self.r#async {
            len += 1;
        }
        if !self.status_url.is_empty() {
            len += 1;
        }
        if !self.outputs.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow.ExecuteWorkflowResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.execution_id.is_empty() {
            struct_ser.serialize_field("executionId", &self.execution_id)?;
        }
        if self.r#async {
            struct_ser.serialize_field("async", &self.r#async)?;
        }
        if !self.status_url.is_empty() {
            struct_ser.serialize_field("statusUrl", &self.status_url)?;
        }
        if !self.outputs.is_empty() {
            struct_ser.serialize_field("outputs", &self.outputs)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ExecuteWorkflowResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "execution_id",
            "executionId",
            "async",
            "status_url",
            "statusUrl",
            "outputs",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            ExecutionId,
            Async,
            StatusUrl,
            Outputs,
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
                            "executionId" | "execution_id" => Ok(GeneratedField::ExecutionId),
                            "async" => Ok(GeneratedField::Async),
                            "statusUrl" | "status_url" => Ok(GeneratedField::StatusUrl),
                            "outputs" => Ok(GeneratedField::Outputs),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ExecuteWorkflowResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow.ExecuteWorkflowResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ExecuteWorkflowResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut execution_id__ = None;
                let mut r#async__ = None;
                let mut status_url__ = None;
                let mut outputs__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::ExecutionId => {
                            if execution_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("executionId"));
                            }
                            execution_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Async => {
                            if r#async__.is_some() {
                                return Err(serde::de::Error::duplicate_field("async"));
                            }
                            r#async__ = Some(map_.next_value()?);
                        }
                        GeneratedField::StatusUrl => {
                            if status_url__.is_some() {
                                return Err(serde::de::Error::duplicate_field("statusUrl"));
                            }
                            status_url__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Outputs => {
                            if outputs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("outputs"));
                            }
                            outputs__ = Some(
                                map_.next_value::<std::collections::HashMap<_, _>>()?
                            );
                        }
                    }
                }
                Ok(ExecuteWorkflowResponse {
                    status: status__,
                    execution_id: execution_id__.unwrap_or_default(),
                    r#async: r#async__.unwrap_or_default(),
                    status_url: status_url__.unwrap_or_default(),
                    outputs: outputs__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow.ExecuteWorkflowResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ExecutionStep {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.step_id.is_empty() {
            len += 1;
        }
        if !self.name.is_empty() {
            len += 1;
        }
        if !self.status.is_empty() {
            len += 1;
        }
        if self.attempt != 0 {
            len += 1;
        }
        if !self.error.is_empty() {
            len += 1;
        }
        if !self.inputs.is_empty() {
            len += 1;
        }
        if !self.outputs.is_empty() {
            len += 1;
        }
        if self.started_at.is_some() {
            len += 1;
        }
        if self.completed_at.is_some() {
            len += 1;
        }
        if self.duration_ms != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow.ExecutionStep", len)?;
        if !self.step_id.is_empty() {
            struct_ser.serialize_field("stepId", &self.step_id)?;
        }
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.status.is_empty() {
            struct_ser.serialize_field("status", &self.status)?;
        }
        if self.attempt != 0 {
            struct_ser.serialize_field("attempt", &self.attempt)?;
        }
        if !self.error.is_empty() {
            struct_ser.serialize_field("error", &self.error)?;
        }
        if !self.inputs.is_empty() {
            struct_ser.serialize_field("inputs", &self.inputs)?;
        }
        if !self.outputs.is_empty() {
            struct_ser.serialize_field("outputs", &self.outputs)?;
        }
        if let Some(v) = self.started_at.as_ref() {
            struct_ser.serialize_field("startedAt", v)?;
        }
        if let Some(v) = self.completed_at.as_ref() {
            struct_ser.serialize_field("completedAt", v)?;
        }
        if self.duration_ms != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("durationMs", ToString::to_string(&self.duration_ms).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ExecutionStep {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "step_id",
            "stepId",
            "name",
            "status",
            "attempt",
            "error",
            "inputs",
            "outputs",
            "started_at",
            "startedAt",
            "completed_at",
            "completedAt",
            "duration_ms",
            "durationMs",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            StepId,
            Name,
            Status,
            Attempt,
            Error,
            Inputs,
            Outputs,
            StartedAt,
            CompletedAt,
            DurationMs,
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
                            "stepId" | "step_id" => Ok(GeneratedField::StepId),
                            "name" => Ok(GeneratedField::Name),
                            "status" => Ok(GeneratedField::Status),
                            "attempt" => Ok(GeneratedField::Attempt),
                            "error" => Ok(GeneratedField::Error),
                            "inputs" => Ok(GeneratedField::Inputs),
                            "outputs" => Ok(GeneratedField::Outputs),
                            "startedAt" | "started_at" => Ok(GeneratedField::StartedAt),
                            "completedAt" | "completed_at" => Ok(GeneratedField::CompletedAt),
                            "durationMs" | "duration_ms" => Ok(GeneratedField::DurationMs),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ExecutionStep;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow.ExecutionStep")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ExecutionStep, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut step_id__ = None;
                let mut name__ = None;
                let mut status__ = None;
                let mut attempt__ = None;
                let mut error__ = None;
                let mut inputs__ = None;
                let mut outputs__ = None;
                let mut started_at__ = None;
                let mut completed_at__ = None;
                let mut duration_ms__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::StepId => {
                            if step_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("stepId"));
                            }
                            step_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Name => {
                            if name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("name"));
                            }
                            name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Attempt => {
                            if attempt__.is_some() {
                                return Err(serde::de::Error::duplicate_field("attempt"));
                            }
                            attempt__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Error => {
                            if error__.is_some() {
                                return Err(serde::de::Error::duplicate_field("error"));
                            }
                            error__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Inputs => {
                            if inputs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("inputs"));
                            }
                            inputs__ = Some(
                                map_.next_value::<std::collections::HashMap<_, _>>()?
                            );
                        }
                        GeneratedField::Outputs => {
                            if outputs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("outputs"));
                            }
                            outputs__ = Some(
                                map_.next_value::<std::collections::HashMap<_, _>>()?
                            );
                        }
                        GeneratedField::StartedAt => {
                            if started_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("startedAt"));
                            }
                            started_at__ = map_.next_value()?;
                        }
                        GeneratedField::CompletedAt => {
                            if completed_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("completedAt"));
                            }
                            completed_at__ = map_.next_value()?;
                        }
                        GeneratedField::DurationMs => {
                            if duration_ms__.is_some() {
                                return Err(serde::de::Error::duplicate_field("durationMs"));
                            }
                            duration_ms__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(ExecutionStep {
                    step_id: step_id__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                    status: status__.unwrap_or_default(),
                    attempt: attempt__.unwrap_or_default(),
                    error: error__.unwrap_or_default(),
                    inputs: inputs__.unwrap_or_default(),
                    outputs: outputs__.unwrap_or_default(),
                    started_at: started_at__,
                    completed_at: completed_at__,
                    duration_ms: duration_ms__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow.ExecutionStep", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetWorkflowExecutionRequest {
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
        let mut struct_ser = serializer.serialize_struct("workflow.GetWorkflowExecutionRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetWorkflowExecutionRequest {
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
            type Value = GetWorkflowExecutionRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow.GetWorkflowExecutionRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetWorkflowExecutionRequest, V::Error>
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
                Ok(GetWorkflowExecutionRequest {
                    id: id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow.GetWorkflowExecutionRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetWorkflowRequest {
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
        let mut struct_ser = serializer.serialize_struct("workflow.GetWorkflowRequest", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetWorkflowRequest {
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
            type Value = GetWorkflowRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow.GetWorkflowRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetWorkflowRequest, V::Error>
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
                Ok(GetWorkflowRequest {
                    id: id__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow.GetWorkflowRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListWorkflowExecutionsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.workflow_id.is_empty() {
            len += 1;
        }
        if !self.application_id.is_empty() {
            len += 1;
        }
        if !self.status.is_empty() {
            len += 1;
        }
        if !self.started_by.is_empty() {
            len += 1;
        }
        if self.from.is_some() {
            len += 1;
        }
        if self.to.is_some() {
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
        let mut struct_ser = serializer.serialize_struct("workflow.ListWorkflowExecutionsRequest", len)?;
        if !self.workflow_id.is_empty() {
            struct_ser.serialize_field("workflowId", &self.workflow_id)?;
        }
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if !self.status.is_empty() {
            struct_ser.serialize_field("status", &self.status)?;
        }
        if !self.started_by.is_empty() {
            struct_ser.serialize_field("startedBy", &self.started_by)?;
        }
        if let Some(v) = self.from.as_ref() {
            struct_ser.serialize_field("from", v)?;
        }
        if let Some(v) = self.to.as_ref() {
            struct_ser.serialize_field("to", v)?;
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
impl<'de> serde::Deserialize<'de> for ListWorkflowExecutionsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "workflow_id",
            "workflowId",
            "application_id",
            "applicationId",
            "status",
            "started_by",
            "startedBy",
            "from",
            "to",
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
            WorkflowId,
            ApplicationId,
            Status,
            StartedBy,
            From,
            To,
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
                            "workflowId" | "workflow_id" => Ok(GeneratedField::WorkflowId),
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            "status" => Ok(GeneratedField::Status),
                            "startedBy" | "started_by" => Ok(GeneratedField::StartedBy),
                            "from" => Ok(GeneratedField::From),
                            "to" => Ok(GeneratedField::To),
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
            type Value = ListWorkflowExecutionsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow.ListWorkflowExecutionsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListWorkflowExecutionsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut workflow_id__ = None;
                let mut application_id__ = None;
                let mut status__ = None;
                let mut started_by__ = None;
                let mut from__ = None;
                let mut to__ = None;
                let mut page__ = None;
                let mut page_size__ = None;
                let mut sort_by__ = None;
                let mut sort_desc__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::WorkflowId => {
                            if workflow_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("workflowId"));
                            }
                            workflow_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = Some(map_.next_value()?);
                        }
                        GeneratedField::StartedBy => {
                            if started_by__.is_some() {
                                return Err(serde::de::Error::duplicate_field("startedBy"));
                            }
                            started_by__ = Some(map_.next_value()?);
                        }
                        GeneratedField::From => {
                            if from__.is_some() {
                                return Err(serde::de::Error::duplicate_field("from"));
                            }
                            from__ = map_.next_value()?;
                        }
                        GeneratedField::To => {
                            if to__.is_some() {
                                return Err(serde::de::Error::duplicate_field("to"));
                            }
                            to__ = map_.next_value()?;
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
                    }
                }
                Ok(ListWorkflowExecutionsRequest {
                    workflow_id: workflow_id__.unwrap_or_default(),
                    application_id: application_id__.unwrap_or_default(),
                    status: status__.unwrap_or_default(),
                    started_by: started_by__.unwrap_or_default(),
                    from: from__,
                    to: to__,
                    page: page__.unwrap_or_default(),
                    page_size: page_size__.unwrap_or_default(),
                    sort_by: sort_by__.unwrap_or_default(),
                    sort_desc: sort_desc__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow.ListWorkflowExecutionsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListWorkflowExecutionsResponse {
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
        if !self.executions.is_empty() {
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
        let mut struct_ser = serializer.serialize_struct("workflow.ListWorkflowExecutionsResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.executions.is_empty() {
            struct_ser.serialize_field("executions", &self.executions)?;
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
impl<'de> serde::Deserialize<'de> for ListWorkflowExecutionsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "executions",
            "total_count",
            "totalCount",
            "page",
            "page_size",
            "pageSize",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Executions,
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
                            "executions" => Ok(GeneratedField::Executions),
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
            type Value = ListWorkflowExecutionsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow.ListWorkflowExecutionsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListWorkflowExecutionsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut executions__ = None;
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
                        GeneratedField::Executions => {
                            if executions__.is_some() {
                                return Err(serde::de::Error::duplicate_field("executions"));
                            }
                            executions__ = Some(map_.next_value()?);
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
                Ok(ListWorkflowExecutionsResponse {
                    status: status__,
                    executions: executions__.unwrap_or_default(),
                    total_count: total_count__.unwrap_or_default(),
                    page: page__.unwrap_or_default(),
                    page_size: page_size__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow.ListWorkflowExecutionsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListWorkflowsRequest {
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
        let mut struct_ser = serializer.serialize_struct("workflow.ListWorkflowsRequest", len)?;
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if self.include_disabled {
            struct_ser.serialize_field("includeDisabled", &self.include_disabled)?;
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
impl<'de> serde::Deserialize<'de> for ListWorkflowsRequest {
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
            ApplicationId,
            IncludeDisabled,
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
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            "includeDisabled" | "include_disabled" => Ok(GeneratedField::IncludeDisabled),
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
            type Value = ListWorkflowsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow.ListWorkflowsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListWorkflowsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut application_id__ = None;
                let mut include_disabled__ = None;
                let mut page__ = None;
                let mut page_size__ = None;
                let mut sort_by__ = None;
                let mut sort_desc__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::IncludeDisabled => {
                            if include_disabled__.is_some() {
                                return Err(serde::de::Error::duplicate_field("includeDisabled"));
                            }
                            include_disabled__ = Some(map_.next_value()?);
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
                    }
                }
                Ok(ListWorkflowsRequest {
                    application_id: application_id__.unwrap_or_default(),
                    include_disabled: include_disabled__.unwrap_or_default(),
                    page: page__.unwrap_or_default(),
                    page_size: page_size__.unwrap_or_default(),
                    sort_by: sort_by__.unwrap_or_default(),
                    sort_desc: sort_desc__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow.ListWorkflowsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListWorkflowsResponse {
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
        if !self.workflows.is_empty() {
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
        let mut struct_ser = serializer.serialize_struct("workflow.ListWorkflowsResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if !self.workflows.is_empty() {
            struct_ser.serialize_field("workflows", &self.workflows)?;
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
impl<'de> serde::Deserialize<'de> for ListWorkflowsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "workflows",
            "total_count",
            "totalCount",
            "page",
            "page_size",
            "pageSize",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Workflows,
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
                            "workflows" => Ok(GeneratedField::Workflows),
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
            type Value = ListWorkflowsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow.ListWorkflowsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListWorkflowsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut workflows__ = None;
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
                        GeneratedField::Workflows => {
                            if workflows__.is_some() {
                                return Err(serde::de::Error::duplicate_field("workflows"));
                            }
                            workflows__ = Some(map_.next_value()?);
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
                Ok(ListWorkflowsResponse {
                    status: status__,
                    workflows: workflows__.unwrap_or_default(),
                    total_count: total_count__.unwrap_or_default(),
                    page: page__.unwrap_or_default(),
                    page_size: page_size__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow.ListWorkflowsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for UpdateWorkflowRequest {
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
        if !self.steps.is_empty() {
            len += 1;
        }
        if !self.variables.is_empty() {
            len += 1;
        }
        if !self.on_success.is_empty() {
            len += 1;
        }
        if !self.on_failure.is_empty() {
            len += 1;
        }
        if self.max_retries != 0 {
            len += 1;
        }
        if self.timeout_seconds != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow.UpdateWorkflowRequest", len)?;
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
        if !self.steps.is_empty() {
            struct_ser.serialize_field("steps", &self.steps)?;
        }
        if !self.variables.is_empty() {
            struct_ser.serialize_field("variables", &self.variables)?;
        }
        if !self.on_success.is_empty() {
            struct_ser.serialize_field("onSuccess", &self.on_success)?;
        }
        if !self.on_failure.is_empty() {
            struct_ser.serialize_field("onFailure", &self.on_failure)?;
        }
        if self.max_retries != 0 {
            struct_ser.serialize_field("maxRetries", &self.max_retries)?;
        }
        if self.timeout_seconds != 0 {
            struct_ser.serialize_field("timeoutSeconds", &self.timeout_seconds)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for UpdateWorkflowRequest {
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
            "steps",
            "variables",
            "on_success",
            "onSuccess",
            "on_failure",
            "onFailure",
            "max_retries",
            "maxRetries",
            "timeout_seconds",
            "timeoutSeconds",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Name,
            Description,
            Enabled,
            Steps,
            Variables,
            OnSuccess,
            OnFailure,
            MaxRetries,
            TimeoutSeconds,
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
                            "steps" => Ok(GeneratedField::Steps),
                            "variables" => Ok(GeneratedField::Variables),
                            "onSuccess" | "on_success" => Ok(GeneratedField::OnSuccess),
                            "onFailure" | "on_failure" => Ok(GeneratedField::OnFailure),
                            "maxRetries" | "max_retries" => Ok(GeneratedField::MaxRetries),
                            "timeoutSeconds" | "timeout_seconds" => Ok(GeneratedField::TimeoutSeconds),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = UpdateWorkflowRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow.UpdateWorkflowRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<UpdateWorkflowRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut name__ = None;
                let mut description__ = None;
                let mut enabled__ = None;
                let mut steps__ = None;
                let mut variables__ = None;
                let mut on_success__ = None;
                let mut on_failure__ = None;
                let mut max_retries__ = None;
                let mut timeout_seconds__ = None;
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
                        GeneratedField::Steps => {
                            if steps__.is_some() {
                                return Err(serde::de::Error::duplicate_field("steps"));
                            }
                            steps__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Variables => {
                            if variables__.is_some() {
                                return Err(serde::de::Error::duplicate_field("variables"));
                            }
                            variables__ = Some(
                                map_.next_value::<std::collections::HashMap<_, _>>()?
                            );
                        }
                        GeneratedField::OnSuccess => {
                            if on_success__.is_some() {
                                return Err(serde::de::Error::duplicate_field("onSuccess"));
                            }
                            on_success__ = Some(map_.next_value()?);
                        }
                        GeneratedField::OnFailure => {
                            if on_failure__.is_some() {
                                return Err(serde::de::Error::duplicate_field("onFailure"));
                            }
                            on_failure__ = Some(map_.next_value()?);
                        }
                        GeneratedField::MaxRetries => {
                            if max_retries__.is_some() {
                                return Err(serde::de::Error::duplicate_field("maxRetries"));
                            }
                            max_retries__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::TimeoutSeconds => {
                            if timeout_seconds__.is_some() {
                                return Err(serde::de::Error::duplicate_field("timeoutSeconds"));
                            }
                            timeout_seconds__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(UpdateWorkflowRequest {
                    id: id__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    enabled: enabled__.unwrap_or_default(),
                    steps: steps__.unwrap_or_default(),
                    variables: variables__.unwrap_or_default(),
                    on_success: on_success__.unwrap_or_default(),
                    on_failure: on_failure__.unwrap_or_default(),
                    max_retries: max_retries__.unwrap_or_default(),
                    timeout_seconds: timeout_seconds__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow.UpdateWorkflowRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for Workflow {
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
        if !self.application_id.is_empty() {
            len += 1;
        }
        if !self.created_by.is_empty() {
            len += 1;
        }
        if self.enabled {
            len += 1;
        }
        if !self.steps.is_empty() {
            len += 1;
        }
        if !self.variables.is_empty() {
            len += 1;
        }
        if !self.on_success.is_empty() {
            len += 1;
        }
        if !self.on_failure.is_empty() {
            len += 1;
        }
        if self.max_retries != 0 {
            len += 1;
        }
        if self.timeout_seconds != 0 {
            len += 1;
        }
        if self.created_at.is_some() {
            len += 1;
        }
        if self.updated_at.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow.Workflow", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if !self.created_by.is_empty() {
            struct_ser.serialize_field("createdBy", &self.created_by)?;
        }
        if self.enabled {
            struct_ser.serialize_field("enabled", &self.enabled)?;
        }
        if !self.steps.is_empty() {
            struct_ser.serialize_field("steps", &self.steps)?;
        }
        if !self.variables.is_empty() {
            struct_ser.serialize_field("variables", &self.variables)?;
        }
        if !self.on_success.is_empty() {
            struct_ser.serialize_field("onSuccess", &self.on_success)?;
        }
        if !self.on_failure.is_empty() {
            struct_ser.serialize_field("onFailure", &self.on_failure)?;
        }
        if self.max_retries != 0 {
            struct_ser.serialize_field("maxRetries", &self.max_retries)?;
        }
        if self.timeout_seconds != 0 {
            struct_ser.serialize_field("timeoutSeconds", &self.timeout_seconds)?;
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
impl<'de> serde::Deserialize<'de> for Workflow {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "name",
            "description",
            "application_id",
            "applicationId",
            "created_by",
            "createdBy",
            "enabled",
            "steps",
            "variables",
            "on_success",
            "onSuccess",
            "on_failure",
            "onFailure",
            "max_retries",
            "maxRetries",
            "timeout_seconds",
            "timeoutSeconds",
            "created_at",
            "createdAt",
            "updated_at",
            "updatedAt",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Name,
            Description,
            ApplicationId,
            CreatedBy,
            Enabled,
            Steps,
            Variables,
            OnSuccess,
            OnFailure,
            MaxRetries,
            TimeoutSeconds,
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
                            "name" => Ok(GeneratedField::Name),
                            "description" => Ok(GeneratedField::Description),
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            "createdBy" | "created_by" => Ok(GeneratedField::CreatedBy),
                            "enabled" => Ok(GeneratedField::Enabled),
                            "steps" => Ok(GeneratedField::Steps),
                            "variables" => Ok(GeneratedField::Variables),
                            "onSuccess" | "on_success" => Ok(GeneratedField::OnSuccess),
                            "onFailure" | "on_failure" => Ok(GeneratedField::OnFailure),
                            "maxRetries" | "max_retries" => Ok(GeneratedField::MaxRetries),
                            "timeoutSeconds" | "timeout_seconds" => Ok(GeneratedField::TimeoutSeconds),
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
            type Value = Workflow;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow.Workflow")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Workflow, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut name__ = None;
                let mut description__ = None;
                let mut application_id__ = None;
                let mut created_by__ = None;
                let mut enabled__ = None;
                let mut steps__ = None;
                let mut variables__ = None;
                let mut on_success__ = None;
                let mut on_failure__ = None;
                let mut max_retries__ = None;
                let mut timeout_seconds__ = None;
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
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CreatedBy => {
                            if created_by__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdBy"));
                            }
                            created_by__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Enabled => {
                            if enabled__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enabled"));
                            }
                            enabled__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Steps => {
                            if steps__.is_some() {
                                return Err(serde::de::Error::duplicate_field("steps"));
                            }
                            steps__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Variables => {
                            if variables__.is_some() {
                                return Err(serde::de::Error::duplicate_field("variables"));
                            }
                            variables__ = Some(
                                map_.next_value::<std::collections::HashMap<_, _>>()?
                            );
                        }
                        GeneratedField::OnSuccess => {
                            if on_success__.is_some() {
                                return Err(serde::de::Error::duplicate_field("onSuccess"));
                            }
                            on_success__ = Some(map_.next_value()?);
                        }
                        GeneratedField::OnFailure => {
                            if on_failure__.is_some() {
                                return Err(serde::de::Error::duplicate_field("onFailure"));
                            }
                            on_failure__ = Some(map_.next_value()?);
                        }
                        GeneratedField::MaxRetries => {
                            if max_retries__.is_some() {
                                return Err(serde::de::Error::duplicate_field("maxRetries"));
                            }
                            max_retries__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::TimeoutSeconds => {
                            if timeout_seconds__.is_some() {
                                return Err(serde::de::Error::duplicate_field("timeoutSeconds"));
                            }
                            timeout_seconds__ = 
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
                    }
                }
                Ok(Workflow {
                    id: id__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    application_id: application_id__.unwrap_or_default(),
                    created_by: created_by__.unwrap_or_default(),
                    enabled: enabled__.unwrap_or_default(),
                    steps: steps__.unwrap_or_default(),
                    variables: variables__.unwrap_or_default(),
                    on_success: on_success__.unwrap_or_default(),
                    on_failure: on_failure__.unwrap_or_default(),
                    max_retries: max_retries__.unwrap_or_default(),
                    timeout_seconds: timeout_seconds__.unwrap_or_default(),
                    created_at: created_at__,
                    updated_at: updated_at__,
                })
            }
        }
        deserializer.deserialize_struct("workflow.Workflow", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for WorkflowExecution {
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
        if !self.workflow_id.is_empty() {
            len += 1;
        }
        if !self.status.is_empty() {
            len += 1;
        }
        if !self.started_by.is_empty() {
            len += 1;
        }
        if !self.application_id.is_empty() {
            len += 1;
        }
        if !self.inputs.is_empty() {
            len += 1;
        }
        if !self.outputs.is_empty() {
            len += 1;
        }
        if !self.error.is_empty() {
            len += 1;
        }
        if self.started_at.is_some() {
            len += 1;
        }
        if self.completed_at.is_some() {
            len += 1;
        }
        if self.created_at.is_some() {
            len += 1;
        }
        if self.updated_at.is_some() {
            len += 1;
        }
        if !self.steps.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow.WorkflowExecution", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.workflow_id.is_empty() {
            struct_ser.serialize_field("workflowId", &self.workflow_id)?;
        }
        if !self.status.is_empty() {
            struct_ser.serialize_field("status", &self.status)?;
        }
        if !self.started_by.is_empty() {
            struct_ser.serialize_field("startedBy", &self.started_by)?;
        }
        if !self.application_id.is_empty() {
            struct_ser.serialize_field("applicationId", &self.application_id)?;
        }
        if !self.inputs.is_empty() {
            struct_ser.serialize_field("inputs", &self.inputs)?;
        }
        if !self.outputs.is_empty() {
            struct_ser.serialize_field("outputs", &self.outputs)?;
        }
        if !self.error.is_empty() {
            struct_ser.serialize_field("error", &self.error)?;
        }
        if let Some(v) = self.started_at.as_ref() {
            struct_ser.serialize_field("startedAt", v)?;
        }
        if let Some(v) = self.completed_at.as_ref() {
            struct_ser.serialize_field("completedAt", v)?;
        }
        if let Some(v) = self.created_at.as_ref() {
            struct_ser.serialize_field("createdAt", v)?;
        }
        if let Some(v) = self.updated_at.as_ref() {
            struct_ser.serialize_field("updatedAt", v)?;
        }
        if !self.steps.is_empty() {
            struct_ser.serialize_field("steps", &self.steps)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for WorkflowExecution {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "workflow_id",
            "workflowId",
            "status",
            "started_by",
            "startedBy",
            "application_id",
            "applicationId",
            "inputs",
            "outputs",
            "error",
            "started_at",
            "startedAt",
            "completed_at",
            "completedAt",
            "created_at",
            "createdAt",
            "updated_at",
            "updatedAt",
            "steps",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            WorkflowId,
            Status,
            StartedBy,
            ApplicationId,
            Inputs,
            Outputs,
            Error,
            StartedAt,
            CompletedAt,
            CreatedAt,
            UpdatedAt,
            Steps,
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
                            "workflowId" | "workflow_id" => Ok(GeneratedField::WorkflowId),
                            "status" => Ok(GeneratedField::Status),
                            "startedBy" | "started_by" => Ok(GeneratedField::StartedBy),
                            "applicationId" | "application_id" => Ok(GeneratedField::ApplicationId),
                            "inputs" => Ok(GeneratedField::Inputs),
                            "outputs" => Ok(GeneratedField::Outputs),
                            "error" => Ok(GeneratedField::Error),
                            "startedAt" | "started_at" => Ok(GeneratedField::StartedAt),
                            "completedAt" | "completed_at" => Ok(GeneratedField::CompletedAt),
                            "createdAt" | "created_at" => Ok(GeneratedField::CreatedAt),
                            "updatedAt" | "updated_at" => Ok(GeneratedField::UpdatedAt),
                            "steps" => Ok(GeneratedField::Steps),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = WorkflowExecution;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow.WorkflowExecution")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<WorkflowExecution, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut workflow_id__ = None;
                let mut status__ = None;
                let mut started_by__ = None;
                let mut application_id__ = None;
                let mut inputs__ = None;
                let mut outputs__ = None;
                let mut error__ = None;
                let mut started_at__ = None;
                let mut completed_at__ = None;
                let mut created_at__ = None;
                let mut updated_at__ = None;
                let mut steps__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::WorkflowId => {
                            if workflow_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("workflowId"));
                            }
                            workflow_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = Some(map_.next_value()?);
                        }
                        GeneratedField::StartedBy => {
                            if started_by__.is_some() {
                                return Err(serde::de::Error::duplicate_field("startedBy"));
                            }
                            started_by__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ApplicationId => {
                            if application_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("applicationId"));
                            }
                            application_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Inputs => {
                            if inputs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("inputs"));
                            }
                            inputs__ = Some(
                                map_.next_value::<std::collections::HashMap<_, _>>()?
                            );
                        }
                        GeneratedField::Outputs => {
                            if outputs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("outputs"));
                            }
                            outputs__ = Some(
                                map_.next_value::<std::collections::HashMap<_, _>>()?
                            );
                        }
                        GeneratedField::Error => {
                            if error__.is_some() {
                                return Err(serde::de::Error::duplicate_field("error"));
                            }
                            error__ = Some(map_.next_value()?);
                        }
                        GeneratedField::StartedAt => {
                            if started_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("startedAt"));
                            }
                            started_at__ = map_.next_value()?;
                        }
                        GeneratedField::CompletedAt => {
                            if completed_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("completedAt"));
                            }
                            completed_at__ = map_.next_value()?;
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
                        GeneratedField::Steps => {
                            if steps__.is_some() {
                                return Err(serde::de::Error::duplicate_field("steps"));
                            }
                            steps__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(WorkflowExecution {
                    id: id__.unwrap_or_default(),
                    workflow_id: workflow_id__.unwrap_or_default(),
                    status: status__.unwrap_or_default(),
                    started_by: started_by__.unwrap_or_default(),
                    application_id: application_id__.unwrap_or_default(),
                    inputs: inputs__.unwrap_or_default(),
                    outputs: outputs__.unwrap_or_default(),
                    error: error__.unwrap_or_default(),
                    started_at: started_at__,
                    completed_at: completed_at__,
                    created_at: created_at__,
                    updated_at: updated_at__,
                    steps: steps__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow.WorkflowExecution", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for WorkflowExecutionResponse {
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
        if self.execution.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow.WorkflowExecutionResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.execution.as_ref() {
            struct_ser.serialize_field("execution", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for WorkflowExecutionResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "execution",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Execution,
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
                            "execution" => Ok(GeneratedField::Execution),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = WorkflowExecutionResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow.WorkflowExecutionResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<WorkflowExecutionResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut execution__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Execution => {
                            if execution__.is_some() {
                                return Err(serde::de::Error::duplicate_field("execution"));
                            }
                            execution__ = map_.next_value()?;
                        }
                    }
                }
                Ok(WorkflowExecutionResponse {
                    status: status__,
                    execution: execution__,
                })
            }
        }
        deserializer.deserialize_struct("workflow.WorkflowExecutionResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for WorkflowResponse {
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
        if self.workflow.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow.WorkflowResponse", len)?;
        if let Some(v) = self.status.as_ref() {
            struct_ser.serialize_field("status", v)?;
        }
        if let Some(v) = self.workflow.as_ref() {
            struct_ser.serialize_field("workflow", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for WorkflowResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "status",
            "workflow",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Status,
            Workflow,
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
                            "workflow" => Ok(GeneratedField::Workflow),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = WorkflowResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow.WorkflowResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<WorkflowResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut status__ = None;
                let mut workflow__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = map_.next_value()?;
                        }
                        GeneratedField::Workflow => {
                            if workflow__.is_some() {
                                return Err(serde::de::Error::duplicate_field("workflow"));
                            }
                            workflow__ = map_.next_value()?;
                        }
                    }
                }
                Ok(WorkflowResponse {
                    status: status__,
                    workflow: workflow__,
                })
            }
        }
        deserializer.deserialize_struct("workflow.WorkflowResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for WorkflowStep {
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
        if !self.r#type.is_empty() {
            len += 1;
        }
        if !self.parameters.is_empty() {
            len += 1;
        }
        if !self.on_success.is_empty() {
            len += 1;
        }
        if !self.on_failure.is_empty() {
            len += 1;
        }
        if self.timeout_seconds != 0 {
            len += 1;
        }
        if self.retry_attempts != 0 {
            len += 1;
        }
        if self.r#async {
            len += 1;
        }
        if !self.outputs.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("workflow.WorkflowStep", len)?;
        if !self.id.is_empty() {
            struct_ser.serialize_field("id", &self.id)?;
        }
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if !self.r#type.is_empty() {
            struct_ser.serialize_field("type", &self.r#type)?;
        }
        if !self.parameters.is_empty() {
            struct_ser.serialize_field("parameters", &self.parameters)?;
        }
        if !self.on_success.is_empty() {
            struct_ser.serialize_field("onSuccess", &self.on_success)?;
        }
        if !self.on_failure.is_empty() {
            struct_ser.serialize_field("onFailure", &self.on_failure)?;
        }
        if self.timeout_seconds != 0 {
            struct_ser.serialize_field("timeoutSeconds", &self.timeout_seconds)?;
        }
        if self.retry_attempts != 0 {
            struct_ser.serialize_field("retryAttempts", &self.retry_attempts)?;
        }
        if self.r#async {
            struct_ser.serialize_field("async", &self.r#async)?;
        }
        if !self.outputs.is_empty() {
            struct_ser.serialize_field("outputs", &self.outputs)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for WorkflowStep {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "name",
            "description",
            "type",
            "parameters",
            "on_success",
            "onSuccess",
            "on_failure",
            "onFailure",
            "timeout_seconds",
            "timeoutSeconds",
            "retry_attempts",
            "retryAttempts",
            "async",
            "outputs",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            Name,
            Description,
            Type,
            Parameters,
            OnSuccess,
            OnFailure,
            TimeoutSeconds,
            RetryAttempts,
            Async,
            Outputs,
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
                            "type" => Ok(GeneratedField::Type),
                            "parameters" => Ok(GeneratedField::Parameters),
                            "onSuccess" | "on_success" => Ok(GeneratedField::OnSuccess),
                            "onFailure" | "on_failure" => Ok(GeneratedField::OnFailure),
                            "timeoutSeconds" | "timeout_seconds" => Ok(GeneratedField::TimeoutSeconds),
                            "retryAttempts" | "retry_attempts" => Ok(GeneratedField::RetryAttempts),
                            "async" => Ok(GeneratedField::Async),
                            "outputs" => Ok(GeneratedField::Outputs),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = WorkflowStep;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct workflow.WorkflowStep")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<WorkflowStep, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut id__ = None;
                let mut name__ = None;
                let mut description__ = None;
                let mut r#type__ = None;
                let mut parameters__ = None;
                let mut on_success__ = None;
                let mut on_failure__ = None;
                let mut timeout_seconds__ = None;
                let mut retry_attempts__ = None;
                let mut r#async__ = None;
                let mut outputs__ = None;
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
                        GeneratedField::Type => {
                            if r#type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("type"));
                            }
                            r#type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Parameters => {
                            if parameters__.is_some() {
                                return Err(serde::de::Error::duplicate_field("parameters"));
                            }
                            parameters__ = Some(
                                map_.next_value::<std::collections::HashMap<_, _>>()?
                            );
                        }
                        GeneratedField::OnSuccess => {
                            if on_success__.is_some() {
                                return Err(serde::de::Error::duplicate_field("onSuccess"));
                            }
                            on_success__ = Some(map_.next_value()?);
                        }
                        GeneratedField::OnFailure => {
                            if on_failure__.is_some() {
                                return Err(serde::de::Error::duplicate_field("onFailure"));
                            }
                            on_failure__ = Some(map_.next_value()?);
                        }
                        GeneratedField::TimeoutSeconds => {
                            if timeout_seconds__.is_some() {
                                return Err(serde::de::Error::duplicate_field("timeoutSeconds"));
                            }
                            timeout_seconds__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::RetryAttempts => {
                            if retry_attempts__.is_some() {
                                return Err(serde::de::Error::duplicate_field("retryAttempts"));
                            }
                            retry_attempts__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Async => {
                            if r#async__.is_some() {
                                return Err(serde::de::Error::duplicate_field("async"));
                            }
                            r#async__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Outputs => {
                            if outputs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("outputs"));
                            }
                            outputs__ = Some(
                                map_.next_value::<std::collections::HashMap<_, _>>()?
                            );
                        }
                    }
                }
                Ok(WorkflowStep {
                    id: id__.unwrap_or_default(),
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    r#type: r#type__.unwrap_or_default(),
                    parameters: parameters__.unwrap_or_default(),
                    on_success: on_success__.unwrap_or_default(),
                    on_failure: on_failure__.unwrap_or_default(),
                    timeout_seconds: timeout_seconds__.unwrap_or_default(),
                    retry_attempts: retry_attempts__.unwrap_or_default(),
                    r#async: r#async__.unwrap_or_default(),
                    outputs: outputs__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("workflow.WorkflowStep", FIELDS, GeneratedVisitor)
    }
}
