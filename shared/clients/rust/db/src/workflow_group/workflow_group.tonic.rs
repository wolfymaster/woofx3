// @generated
/// Generated client implementations.
pub mod workflow_group_service_client {
    #![allow(
        unused_variables,
        dead_code,
        missing_docs,
        clippy::wildcard_imports,
        clippy::let_unit_value,
    )]
    use tonic::codegen::*;
    use tonic::codegen::http::Uri;
    #[derive(Debug, Clone)]
    pub struct WorkflowGroupServiceClient<T> {
        inner: tonic::client::Grpc<T>,
    }
    impl WorkflowGroupServiceClient<tonic::transport::Channel> {
        /// Attempt to create a new client by connecting to a given endpoint.
        pub async fn connect<D>(dst: D) -> Result<Self, tonic::transport::Error>
        where
            D: TryInto<tonic::transport::Endpoint>,
            D::Error: Into<StdError>,
        {
            let conn = tonic::transport::Endpoint::new(dst)?.connect().await?;
            Ok(Self::new(conn))
        }
    }
    impl<T> WorkflowGroupServiceClient<T>
    where
        T: tonic::client::GrpcService<tonic::body::Body>,
        T::Error: Into<StdError>,
        T::ResponseBody: Body<Data = Bytes> + std::marker::Send + 'static,
        <T::ResponseBody as Body>::Error: Into<StdError> + std::marker::Send,
    {
        pub fn new(inner: T) -> Self {
            let inner = tonic::client::Grpc::new(inner);
            Self { inner }
        }
        pub fn with_origin(inner: T, origin: Uri) -> Self {
            let inner = tonic::client::Grpc::with_origin(inner, origin);
            Self { inner }
        }
        pub fn with_interceptor<F>(
            inner: T,
            interceptor: F,
        ) -> WorkflowGroupServiceClient<InterceptedService<T, F>>
        where
            F: tonic::service::Interceptor,
            T::ResponseBody: Default,
            T: tonic::codegen::Service<
                http::Request<tonic::body::Body>,
                Response = http::Response<
                    <T as tonic::client::GrpcService<tonic::body::Body>>::ResponseBody,
                >,
            >,
            <T as tonic::codegen::Service<
                http::Request<tonic::body::Body>,
            >>::Error: Into<StdError> + std::marker::Send + std::marker::Sync,
        {
            WorkflowGroupServiceClient::new(InterceptedService::new(inner, interceptor))
        }
        /// Compress requests with the given encoding.
        ///
        /// This requires the server to support it otherwise it might respond with an
        /// error.
        #[must_use]
        pub fn send_compressed(mut self, encoding: CompressionEncoding) -> Self {
            self.inner = self.inner.send_compressed(encoding);
            self
        }
        /// Enable decompressing responses.
        #[must_use]
        pub fn accept_compressed(mut self, encoding: CompressionEncoding) -> Self {
            self.inner = self.inner.accept_compressed(encoding);
            self
        }
        /// Limits the maximum size of a decoded message.
        ///
        /// Default: `4MB`
        #[must_use]
        pub fn max_decoding_message_size(mut self, limit: usize) -> Self {
            self.inner = self.inner.max_decoding_message_size(limit);
            self
        }
        /// Limits the maximum size of an encoded message.
        ///
        /// Default: `usize::MAX`
        #[must_use]
        pub fn max_encoding_message_size(mut self, limit: usize) -> Self {
            self.inner = self.inner.max_encoding_message_size(limit);
            self
        }
        pub async fn list_workflow_groups(
            &mut self,
            request: impl tonic::IntoRequest<super::ListWorkflowGroupsRequest>,
        ) -> std::result::Result<
            tonic::Response<super::ListWorkflowGroupsResponse>,
            tonic::Status,
        > {
            self.inner
                .ready()
                .await
                .map_err(|e| {
                    tonic::Status::unknown(
                        format!("Service was not ready: {}", e.into()),
                    )
                })?;
            let codec = tonic_prost::ProstCodec::default();
            let path = http::uri::PathAndQuery::from_static(
                "/workflow_group.WorkflowGroupService/ListWorkflowGroups",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "workflow_group.WorkflowGroupService",
                        "ListWorkflowGroups",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn create_workflow_group(
            &mut self,
            request: impl tonic::IntoRequest<super::CreateWorkflowGroupRequest>,
        ) -> std::result::Result<
            tonic::Response<super::CreateWorkflowGroupResponse>,
            tonic::Status,
        > {
            self.inner
                .ready()
                .await
                .map_err(|e| {
                    tonic::Status::unknown(
                        format!("Service was not ready: {}", e.into()),
                    )
                })?;
            let codec = tonic_prost::ProstCodec::default();
            let path = http::uri::PathAndQuery::from_static(
                "/workflow_group.WorkflowGroupService/CreateWorkflowGroup",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "workflow_group.WorkflowGroupService",
                        "CreateWorkflowGroup",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn update_workflow_group(
            &mut self,
            request: impl tonic::IntoRequest<super::UpdateWorkflowGroupRequest>,
        ) -> std::result::Result<
            tonic::Response<super::UpdateWorkflowGroupResponse>,
            tonic::Status,
        > {
            self.inner
                .ready()
                .await
                .map_err(|e| {
                    tonic::Status::unknown(
                        format!("Service was not ready: {}", e.into()),
                    )
                })?;
            let codec = tonic_prost::ProstCodec::default();
            let path = http::uri::PathAndQuery::from_static(
                "/workflow_group.WorkflowGroupService/UpdateWorkflowGroup",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "workflow_group.WorkflowGroupService",
                        "UpdateWorkflowGroup",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn delete_workflow_group(
            &mut self,
            request: impl tonic::IntoRequest<super::DeleteWorkflowGroupRequest>,
        ) -> std::result::Result<
            tonic::Response<super::DeleteWorkflowGroupResponse>,
            tonic::Status,
        > {
            self.inner
                .ready()
                .await
                .map_err(|e| {
                    tonic::Status::unknown(
                        format!("Service was not ready: {}", e.into()),
                    )
                })?;
            let codec = tonic_prost::ProstCodec::default();
            let path = http::uri::PathAndQuery::from_static(
                "/workflow_group.WorkflowGroupService/DeleteWorkflowGroup",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "workflow_group.WorkflowGroupService",
                        "DeleteWorkflowGroup",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn set_workflow_group_enabled(
            &mut self,
            request: impl tonic::IntoRequest<super::SetWorkflowGroupEnabledRequest>,
        ) -> std::result::Result<
            tonic::Response<super::SetWorkflowGroupEnabledResponse>,
            tonic::Status,
        > {
            self.inner
                .ready()
                .await
                .map_err(|e| {
                    tonic::Status::unknown(
                        format!("Service was not ready: {}", e.into()),
                    )
                })?;
            let codec = tonic_prost::ProstCodec::default();
            let path = http::uri::PathAndQuery::from_static(
                "/workflow_group.WorkflowGroupService/SetWorkflowGroupEnabled",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "workflow_group.WorkflowGroupService",
                        "SetWorkflowGroupEnabled",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn add_workflow_group_members(
            &mut self,
            request: impl tonic::IntoRequest<super::AddWorkflowGroupMembersRequest>,
        ) -> std::result::Result<
            tonic::Response<super::AddWorkflowGroupMembersResponse>,
            tonic::Status,
        > {
            self.inner
                .ready()
                .await
                .map_err(|e| {
                    tonic::Status::unknown(
                        format!("Service was not ready: {}", e.into()),
                    )
                })?;
            let codec = tonic_prost::ProstCodec::default();
            let path = http::uri::PathAndQuery::from_static(
                "/workflow_group.WorkflowGroupService/AddWorkflowGroupMembers",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "workflow_group.WorkflowGroupService",
                        "AddWorkflowGroupMembers",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn remove_workflow_group_members(
            &mut self,
            request: impl tonic::IntoRequest<super::RemoveWorkflowGroupMembersRequest>,
        ) -> std::result::Result<
            tonic::Response<super::RemoveWorkflowGroupMembersResponse>,
            tonic::Status,
        > {
            self.inner
                .ready()
                .await
                .map_err(|e| {
                    tonic::Status::unknown(
                        format!("Service was not ready: {}", e.into()),
                    )
                })?;
            let codec = tonic_prost::ProstCodec::default();
            let path = http::uri::PathAndQuery::from_static(
                "/workflow_group.WorkflowGroupService/RemoveWorkflowGroupMembers",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "workflow_group.WorkflowGroupService",
                        "RemoveWorkflowGroupMembers",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
    }
}
/// Generated server implementations.
pub mod workflow_group_service_server {
    #![allow(
        unused_variables,
        dead_code,
        missing_docs,
        clippy::wildcard_imports,
        clippy::let_unit_value,
    )]
    use tonic::codegen::*;
    /// Generated trait containing gRPC methods that should be implemented for use with WorkflowGroupServiceServer.
    #[async_trait]
    pub trait WorkflowGroupService: std::marker::Send + std::marker::Sync + 'static {
        async fn list_workflow_groups(
            &self,
            request: tonic::Request<super::ListWorkflowGroupsRequest>,
        ) -> std::result::Result<
            tonic::Response<super::ListWorkflowGroupsResponse>,
            tonic::Status,
        >;
        async fn create_workflow_group(
            &self,
            request: tonic::Request<super::CreateWorkflowGroupRequest>,
        ) -> std::result::Result<
            tonic::Response<super::CreateWorkflowGroupResponse>,
            tonic::Status,
        >;
        async fn update_workflow_group(
            &self,
            request: tonic::Request<super::UpdateWorkflowGroupRequest>,
        ) -> std::result::Result<
            tonic::Response<super::UpdateWorkflowGroupResponse>,
            tonic::Status,
        >;
        async fn delete_workflow_group(
            &self,
            request: tonic::Request<super::DeleteWorkflowGroupRequest>,
        ) -> std::result::Result<
            tonic::Response<super::DeleteWorkflowGroupResponse>,
            tonic::Status,
        >;
        async fn set_workflow_group_enabled(
            &self,
            request: tonic::Request<super::SetWorkflowGroupEnabledRequest>,
        ) -> std::result::Result<
            tonic::Response<super::SetWorkflowGroupEnabledResponse>,
            tonic::Status,
        >;
        async fn add_workflow_group_members(
            &self,
            request: tonic::Request<super::AddWorkflowGroupMembersRequest>,
        ) -> std::result::Result<
            tonic::Response<super::AddWorkflowGroupMembersResponse>,
            tonic::Status,
        >;
        async fn remove_workflow_group_members(
            &self,
            request: tonic::Request<super::RemoveWorkflowGroupMembersRequest>,
        ) -> std::result::Result<
            tonic::Response<super::RemoveWorkflowGroupMembersResponse>,
            tonic::Status,
        >;
    }
    #[derive(Debug)]
    pub struct WorkflowGroupServiceServer<T> {
        inner: Arc<T>,
        accept_compression_encodings: EnabledCompressionEncodings,
        send_compression_encodings: EnabledCompressionEncodings,
        max_decoding_message_size: Option<usize>,
        max_encoding_message_size: Option<usize>,
    }
    impl<T> WorkflowGroupServiceServer<T> {
        pub fn new(inner: T) -> Self {
            Self::from_arc(Arc::new(inner))
        }
        pub fn from_arc(inner: Arc<T>) -> Self {
            Self {
                inner,
                accept_compression_encodings: Default::default(),
                send_compression_encodings: Default::default(),
                max_decoding_message_size: None,
                max_encoding_message_size: None,
            }
        }
        pub fn with_interceptor<F>(
            inner: T,
            interceptor: F,
        ) -> InterceptedService<Self, F>
        where
            F: tonic::service::Interceptor,
        {
            InterceptedService::new(Self::new(inner), interceptor)
        }
        /// Enable decompressing requests with the given encoding.
        #[must_use]
        pub fn accept_compressed(mut self, encoding: CompressionEncoding) -> Self {
            self.accept_compression_encodings.enable(encoding);
            self
        }
        /// Compress responses with the given encoding, if the client supports it.
        #[must_use]
        pub fn send_compressed(mut self, encoding: CompressionEncoding) -> Self {
            self.send_compression_encodings.enable(encoding);
            self
        }
        /// Limits the maximum size of a decoded message.
        ///
        /// Default: `4MB`
        #[must_use]
        pub fn max_decoding_message_size(mut self, limit: usize) -> Self {
            self.max_decoding_message_size = Some(limit);
            self
        }
        /// Limits the maximum size of an encoded message.
        ///
        /// Default: `usize::MAX`
        #[must_use]
        pub fn max_encoding_message_size(mut self, limit: usize) -> Self {
            self.max_encoding_message_size = Some(limit);
            self
        }
    }
    impl<T, B> tonic::codegen::Service<http::Request<B>>
    for WorkflowGroupServiceServer<T>
    where
        T: WorkflowGroupService,
        B: Body + std::marker::Send + 'static,
        B::Error: Into<StdError> + std::marker::Send + 'static,
    {
        type Response = http::Response<tonic::body::Body>;
        type Error = std::convert::Infallible;
        type Future = BoxFuture<Self::Response, Self::Error>;
        fn poll_ready(
            &mut self,
            _cx: &mut Context<'_>,
        ) -> Poll<std::result::Result<(), Self::Error>> {
            Poll::Ready(Ok(()))
        }
        fn call(&mut self, req: http::Request<B>) -> Self::Future {
            match req.uri().path() {
                "/workflow_group.WorkflowGroupService/ListWorkflowGroups" => {
                    #[allow(non_camel_case_types)]
                    struct ListWorkflowGroupsSvc<T: WorkflowGroupService>(pub Arc<T>);
                    impl<
                        T: WorkflowGroupService,
                    > tonic::server::UnaryService<super::ListWorkflowGroupsRequest>
                    for ListWorkflowGroupsSvc<T> {
                        type Response = super::ListWorkflowGroupsResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::ListWorkflowGroupsRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as WorkflowGroupService>::list_workflow_groups(
                                        &inner,
                                        request,
                                    )
                                    .await
                            };
                            Box::pin(fut)
                        }
                    }
                    let accept_compression_encodings = self.accept_compression_encodings;
                    let send_compression_encodings = self.send_compression_encodings;
                    let max_decoding_message_size = self.max_decoding_message_size;
                    let max_encoding_message_size = self.max_encoding_message_size;
                    let inner = self.inner.clone();
                    let fut = async move {
                        let method = ListWorkflowGroupsSvc(inner);
                        let codec = tonic_prost::ProstCodec::default();
                        let mut grpc = tonic::server::Grpc::new(codec)
                            .apply_compression_config(
                                accept_compression_encodings,
                                send_compression_encodings,
                            )
                            .apply_max_message_size_config(
                                max_decoding_message_size,
                                max_encoding_message_size,
                            );
                        let res = grpc.unary(method, req).await;
                        Ok(res)
                    };
                    Box::pin(fut)
                }
                "/workflow_group.WorkflowGroupService/CreateWorkflowGroup" => {
                    #[allow(non_camel_case_types)]
                    struct CreateWorkflowGroupSvc<T: WorkflowGroupService>(pub Arc<T>);
                    impl<
                        T: WorkflowGroupService,
                    > tonic::server::UnaryService<super::CreateWorkflowGroupRequest>
                    for CreateWorkflowGroupSvc<T> {
                        type Response = super::CreateWorkflowGroupResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::CreateWorkflowGroupRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as WorkflowGroupService>::create_workflow_group(
                                        &inner,
                                        request,
                                    )
                                    .await
                            };
                            Box::pin(fut)
                        }
                    }
                    let accept_compression_encodings = self.accept_compression_encodings;
                    let send_compression_encodings = self.send_compression_encodings;
                    let max_decoding_message_size = self.max_decoding_message_size;
                    let max_encoding_message_size = self.max_encoding_message_size;
                    let inner = self.inner.clone();
                    let fut = async move {
                        let method = CreateWorkflowGroupSvc(inner);
                        let codec = tonic_prost::ProstCodec::default();
                        let mut grpc = tonic::server::Grpc::new(codec)
                            .apply_compression_config(
                                accept_compression_encodings,
                                send_compression_encodings,
                            )
                            .apply_max_message_size_config(
                                max_decoding_message_size,
                                max_encoding_message_size,
                            );
                        let res = grpc.unary(method, req).await;
                        Ok(res)
                    };
                    Box::pin(fut)
                }
                "/workflow_group.WorkflowGroupService/UpdateWorkflowGroup" => {
                    #[allow(non_camel_case_types)]
                    struct UpdateWorkflowGroupSvc<T: WorkflowGroupService>(pub Arc<T>);
                    impl<
                        T: WorkflowGroupService,
                    > tonic::server::UnaryService<super::UpdateWorkflowGroupRequest>
                    for UpdateWorkflowGroupSvc<T> {
                        type Response = super::UpdateWorkflowGroupResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::UpdateWorkflowGroupRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as WorkflowGroupService>::update_workflow_group(
                                        &inner,
                                        request,
                                    )
                                    .await
                            };
                            Box::pin(fut)
                        }
                    }
                    let accept_compression_encodings = self.accept_compression_encodings;
                    let send_compression_encodings = self.send_compression_encodings;
                    let max_decoding_message_size = self.max_decoding_message_size;
                    let max_encoding_message_size = self.max_encoding_message_size;
                    let inner = self.inner.clone();
                    let fut = async move {
                        let method = UpdateWorkflowGroupSvc(inner);
                        let codec = tonic_prost::ProstCodec::default();
                        let mut grpc = tonic::server::Grpc::new(codec)
                            .apply_compression_config(
                                accept_compression_encodings,
                                send_compression_encodings,
                            )
                            .apply_max_message_size_config(
                                max_decoding_message_size,
                                max_encoding_message_size,
                            );
                        let res = grpc.unary(method, req).await;
                        Ok(res)
                    };
                    Box::pin(fut)
                }
                "/workflow_group.WorkflowGroupService/DeleteWorkflowGroup" => {
                    #[allow(non_camel_case_types)]
                    struct DeleteWorkflowGroupSvc<T: WorkflowGroupService>(pub Arc<T>);
                    impl<
                        T: WorkflowGroupService,
                    > tonic::server::UnaryService<super::DeleteWorkflowGroupRequest>
                    for DeleteWorkflowGroupSvc<T> {
                        type Response = super::DeleteWorkflowGroupResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::DeleteWorkflowGroupRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as WorkflowGroupService>::delete_workflow_group(
                                        &inner,
                                        request,
                                    )
                                    .await
                            };
                            Box::pin(fut)
                        }
                    }
                    let accept_compression_encodings = self.accept_compression_encodings;
                    let send_compression_encodings = self.send_compression_encodings;
                    let max_decoding_message_size = self.max_decoding_message_size;
                    let max_encoding_message_size = self.max_encoding_message_size;
                    let inner = self.inner.clone();
                    let fut = async move {
                        let method = DeleteWorkflowGroupSvc(inner);
                        let codec = tonic_prost::ProstCodec::default();
                        let mut grpc = tonic::server::Grpc::new(codec)
                            .apply_compression_config(
                                accept_compression_encodings,
                                send_compression_encodings,
                            )
                            .apply_max_message_size_config(
                                max_decoding_message_size,
                                max_encoding_message_size,
                            );
                        let res = grpc.unary(method, req).await;
                        Ok(res)
                    };
                    Box::pin(fut)
                }
                "/workflow_group.WorkflowGroupService/SetWorkflowGroupEnabled" => {
                    #[allow(non_camel_case_types)]
                    struct SetWorkflowGroupEnabledSvc<T: WorkflowGroupService>(
                        pub Arc<T>,
                    );
                    impl<
                        T: WorkflowGroupService,
                    > tonic::server::UnaryService<super::SetWorkflowGroupEnabledRequest>
                    for SetWorkflowGroupEnabledSvc<T> {
                        type Response = super::SetWorkflowGroupEnabledResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<
                                super::SetWorkflowGroupEnabledRequest,
                            >,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as WorkflowGroupService>::set_workflow_group_enabled(
                                        &inner,
                                        request,
                                    )
                                    .await
                            };
                            Box::pin(fut)
                        }
                    }
                    let accept_compression_encodings = self.accept_compression_encodings;
                    let send_compression_encodings = self.send_compression_encodings;
                    let max_decoding_message_size = self.max_decoding_message_size;
                    let max_encoding_message_size = self.max_encoding_message_size;
                    let inner = self.inner.clone();
                    let fut = async move {
                        let method = SetWorkflowGroupEnabledSvc(inner);
                        let codec = tonic_prost::ProstCodec::default();
                        let mut grpc = tonic::server::Grpc::new(codec)
                            .apply_compression_config(
                                accept_compression_encodings,
                                send_compression_encodings,
                            )
                            .apply_max_message_size_config(
                                max_decoding_message_size,
                                max_encoding_message_size,
                            );
                        let res = grpc.unary(method, req).await;
                        Ok(res)
                    };
                    Box::pin(fut)
                }
                "/workflow_group.WorkflowGroupService/AddWorkflowGroupMembers" => {
                    #[allow(non_camel_case_types)]
                    struct AddWorkflowGroupMembersSvc<T: WorkflowGroupService>(
                        pub Arc<T>,
                    );
                    impl<
                        T: WorkflowGroupService,
                    > tonic::server::UnaryService<super::AddWorkflowGroupMembersRequest>
                    for AddWorkflowGroupMembersSvc<T> {
                        type Response = super::AddWorkflowGroupMembersResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<
                                super::AddWorkflowGroupMembersRequest,
                            >,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as WorkflowGroupService>::add_workflow_group_members(
                                        &inner,
                                        request,
                                    )
                                    .await
                            };
                            Box::pin(fut)
                        }
                    }
                    let accept_compression_encodings = self.accept_compression_encodings;
                    let send_compression_encodings = self.send_compression_encodings;
                    let max_decoding_message_size = self.max_decoding_message_size;
                    let max_encoding_message_size = self.max_encoding_message_size;
                    let inner = self.inner.clone();
                    let fut = async move {
                        let method = AddWorkflowGroupMembersSvc(inner);
                        let codec = tonic_prost::ProstCodec::default();
                        let mut grpc = tonic::server::Grpc::new(codec)
                            .apply_compression_config(
                                accept_compression_encodings,
                                send_compression_encodings,
                            )
                            .apply_max_message_size_config(
                                max_decoding_message_size,
                                max_encoding_message_size,
                            );
                        let res = grpc.unary(method, req).await;
                        Ok(res)
                    };
                    Box::pin(fut)
                }
                "/workflow_group.WorkflowGroupService/RemoveWorkflowGroupMembers" => {
                    #[allow(non_camel_case_types)]
                    struct RemoveWorkflowGroupMembersSvc<T: WorkflowGroupService>(
                        pub Arc<T>,
                    );
                    impl<
                        T: WorkflowGroupService,
                    > tonic::server::UnaryService<
                        super::RemoveWorkflowGroupMembersRequest,
                    > for RemoveWorkflowGroupMembersSvc<T> {
                        type Response = super::RemoveWorkflowGroupMembersResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<
                                super::RemoveWorkflowGroupMembersRequest,
                            >,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as WorkflowGroupService>::remove_workflow_group_members(
                                        &inner,
                                        request,
                                    )
                                    .await
                            };
                            Box::pin(fut)
                        }
                    }
                    let accept_compression_encodings = self.accept_compression_encodings;
                    let send_compression_encodings = self.send_compression_encodings;
                    let max_decoding_message_size = self.max_decoding_message_size;
                    let max_encoding_message_size = self.max_encoding_message_size;
                    let inner = self.inner.clone();
                    let fut = async move {
                        let method = RemoveWorkflowGroupMembersSvc(inner);
                        let codec = tonic_prost::ProstCodec::default();
                        let mut grpc = tonic::server::Grpc::new(codec)
                            .apply_compression_config(
                                accept_compression_encodings,
                                send_compression_encodings,
                            )
                            .apply_max_message_size_config(
                                max_decoding_message_size,
                                max_encoding_message_size,
                            );
                        let res = grpc.unary(method, req).await;
                        Ok(res)
                    };
                    Box::pin(fut)
                }
                _ => {
                    Box::pin(async move {
                        let mut response = http::Response::new(
                            tonic::body::Body::default(),
                        );
                        let headers = response.headers_mut();
                        headers
                            .insert(
                                tonic::Status::GRPC_STATUS,
                                (tonic::Code::Unimplemented as i32).into(),
                            );
                        headers
                            .insert(
                                http::header::CONTENT_TYPE,
                                tonic::metadata::GRPC_CONTENT_TYPE,
                            );
                        Ok(response)
                    })
                }
            }
        }
    }
    impl<T> Clone for WorkflowGroupServiceServer<T> {
        fn clone(&self) -> Self {
            let inner = self.inner.clone();
            Self {
                inner,
                accept_compression_encodings: self.accept_compression_encodings,
                send_compression_encodings: self.send_compression_encodings,
                max_decoding_message_size: self.max_decoding_message_size,
                max_encoding_message_size: self.max_encoding_message_size,
            }
        }
    }
    /// Generated gRPC service name
    pub const SERVICE_NAME: &str = "workflow_group.WorkflowGroupService";
    impl<T> tonic::server::NamedService for WorkflowGroupServiceServer<T> {
        const NAME: &'static str = SERVICE_NAME;
    }
}
