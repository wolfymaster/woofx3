// @generated
/// Generated client implementations.
pub mod permission_service_client {
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
    pub struct PermissionServiceClient<T> {
        inner: tonic::client::Grpc<T>,
    }
    impl PermissionServiceClient<tonic::transport::Channel> {
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
    impl<T> PermissionServiceClient<T>
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
        ) -> PermissionServiceClient<InterceptedService<T, F>>
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
            PermissionServiceClient::new(InterceptedService::new(inner, interceptor))
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
        ///
        pub async fn has_permission(
            &mut self,
            request: impl tonic::IntoRequest<super::HasPermissionRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
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
                "/permission.PermissionService/HasPermission",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new("permission.PermissionService", "HasPermission"),
                );
            self.inner.unary(req, path, codec).await
        }
        ///
        pub async fn add_permission(
            &mut self,
            request: impl tonic::IntoRequest<super::PermissionRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
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
                "/permission.PermissionService/AddPermission",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new("permission.PermissionService", "AddPermission"),
                );
            self.inner.unary(req, path, codec).await
        }
        ///
        pub async fn add_user_to_resource(
            &mut self,
            request: impl tonic::IntoRequest<super::UserResourceRoleRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
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
                "/permission.PermissionService/AddUserToResource",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new("permission.PermissionService", "AddUserToResource"),
                );
            self.inner.unary(req, path, codec).await
        }
        ///
        pub async fn add_user_to_group(
            &mut self,
            request: impl tonic::IntoRequest<super::UserResourceRoleRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
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
                "/permission.PermissionService/AddUserToGroup",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new("permission.PermissionService", "AddUserToGroup"),
                );
            self.inner.unary(req, path, codec).await
        }
        ///
        pub async fn add_user_to_role(
            &mut self,
            request: impl tonic::IntoRequest<super::UserResourceRoleRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
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
                "/permission.PermissionService/AddUserToRole",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new("permission.PermissionService", "AddUserToRole"),
                );
            self.inner.unary(req, path, codec).await
        }
        ///
        pub async fn add_role_to_group(
            &mut self,
            request: impl tonic::IntoRequest<super::UserResourceRoleRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
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
                "/permission.PermissionService/AddRoleToGroup",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new("permission.PermissionService", "AddRoleToGroup"),
                );
            self.inner.unary(req, path, codec).await
        }
        ///
        pub async fn add_group_to_resource(
            &mut self,
            request: impl tonic::IntoRequest<super::UserResourceRoleRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
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
                "/permission.PermissionService/AddGroupToResource",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new("permission.PermissionService", "AddGroupToResource"),
                );
            self.inner.unary(req, path, codec).await
        }
        ///
        pub async fn remove_permission(
            &mut self,
            request: impl tonic::IntoRequest<super::PermissionRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
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
                "/permission.PermissionService/RemovePermission",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new("permission.PermissionService", "RemovePermission"),
                );
            self.inner.unary(req, path, codec).await
        }
        ///
        pub async fn remove_user_from_resource(
            &mut self,
            request: impl tonic::IntoRequest<super::UserResourceRoleRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
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
                "/permission.PermissionService/RemoveUserFromResource",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "permission.PermissionService",
                        "RemoveUserFromResource",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        ///
        pub async fn remove_user_from_group(
            &mut self,
            request: impl tonic::IntoRequest<super::UserResourceRoleRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
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
                "/permission.PermissionService/RemoveUserFromGroup",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "permission.PermissionService",
                        "RemoveUserFromGroup",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        ///
        pub async fn remove_role_from_group(
            &mut self,
            request: impl tonic::IntoRequest<super::UserResourceRoleRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
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
                "/permission.PermissionService/RemoveRoleFromGroup",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "permission.PermissionService",
                        "RemoveRoleFromGroup",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        ///
        pub async fn remove_group_from_resource(
            &mut self,
            request: impl tonic::IntoRequest<super::UserResourceRoleRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
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
                "/permission.PermissionService/RemoveGroupFromResource",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "permission.PermissionService",
                        "RemoveGroupFromResource",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
    }
}
/// Generated server implementations.
pub mod permission_service_server {
    #![allow(
        unused_variables,
        dead_code,
        missing_docs,
        clippy::wildcard_imports,
        clippy::let_unit_value,
    )]
    use tonic::codegen::*;
    /// Generated trait containing gRPC methods that should be implemented for use with PermissionServiceServer.
    #[async_trait]
    pub trait PermissionService: std::marker::Send + std::marker::Sync + 'static {
        ///
        async fn has_permission(
            &self,
            request: tonic::Request<super::HasPermissionRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
            tonic::Status,
        >;
        ///
        async fn add_permission(
            &self,
            request: tonic::Request<super::PermissionRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
            tonic::Status,
        >;
        ///
        async fn add_user_to_resource(
            &self,
            request: tonic::Request<super::UserResourceRoleRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
            tonic::Status,
        >;
        ///
        async fn add_user_to_group(
            &self,
            request: tonic::Request<super::UserResourceRoleRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
            tonic::Status,
        >;
        ///
        async fn add_user_to_role(
            &self,
            request: tonic::Request<super::UserResourceRoleRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
            tonic::Status,
        >;
        ///
        async fn add_role_to_group(
            &self,
            request: tonic::Request<super::UserResourceRoleRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
            tonic::Status,
        >;
        ///
        async fn add_group_to_resource(
            &self,
            request: tonic::Request<super::UserResourceRoleRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
            tonic::Status,
        >;
        ///
        async fn remove_permission(
            &self,
            request: tonic::Request<super::PermissionRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
            tonic::Status,
        >;
        ///
        async fn remove_user_from_resource(
            &self,
            request: tonic::Request<super::UserResourceRoleRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
            tonic::Status,
        >;
        ///
        async fn remove_user_from_group(
            &self,
            request: tonic::Request<super::UserResourceRoleRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
            tonic::Status,
        >;
        ///
        async fn remove_role_from_group(
            &self,
            request: tonic::Request<super::UserResourceRoleRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
            tonic::Status,
        >;
        ///
        async fn remove_group_from_resource(
            &self,
            request: tonic::Request<super::UserResourceRoleRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
            tonic::Status,
        >;
    }
    #[derive(Debug)]
    pub struct PermissionServiceServer<T> {
        inner: Arc<T>,
        accept_compression_encodings: EnabledCompressionEncodings,
        send_compression_encodings: EnabledCompressionEncodings,
        max_decoding_message_size: Option<usize>,
        max_encoding_message_size: Option<usize>,
    }
    impl<T> PermissionServiceServer<T> {
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
    impl<T, B> tonic::codegen::Service<http::Request<B>> for PermissionServiceServer<T>
    where
        T: PermissionService,
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
                "/permission.PermissionService/HasPermission" => {
                    #[allow(non_camel_case_types)]
                    struct HasPermissionSvc<T: PermissionService>(pub Arc<T>);
                    impl<
                        T: PermissionService,
                    > tonic::server::UnaryService<super::HasPermissionRequest>
                    for HasPermissionSvc<T> {
                        type Response = super::super::common::ResponseStatus;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::HasPermissionRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as PermissionService>::has_permission(&inner, request)
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
                        let method = HasPermissionSvc(inner);
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
                "/permission.PermissionService/AddPermission" => {
                    #[allow(non_camel_case_types)]
                    struct AddPermissionSvc<T: PermissionService>(pub Arc<T>);
                    impl<
                        T: PermissionService,
                    > tonic::server::UnaryService<super::PermissionRequest>
                    for AddPermissionSvc<T> {
                        type Response = super::super::common::ResponseStatus;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::PermissionRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as PermissionService>::add_permission(&inner, request)
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
                        let method = AddPermissionSvc(inner);
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
                "/permission.PermissionService/AddUserToResource" => {
                    #[allow(non_camel_case_types)]
                    struct AddUserToResourceSvc<T: PermissionService>(pub Arc<T>);
                    impl<
                        T: PermissionService,
                    > tonic::server::UnaryService<super::UserResourceRoleRequest>
                    for AddUserToResourceSvc<T> {
                        type Response = super::super::common::ResponseStatus;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::UserResourceRoleRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as PermissionService>::add_user_to_resource(
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
                        let method = AddUserToResourceSvc(inner);
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
                "/permission.PermissionService/AddUserToGroup" => {
                    #[allow(non_camel_case_types)]
                    struct AddUserToGroupSvc<T: PermissionService>(pub Arc<T>);
                    impl<
                        T: PermissionService,
                    > tonic::server::UnaryService<super::UserResourceRoleRequest>
                    for AddUserToGroupSvc<T> {
                        type Response = super::super::common::ResponseStatus;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::UserResourceRoleRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as PermissionService>::add_user_to_group(&inner, request)
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
                        let method = AddUserToGroupSvc(inner);
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
                "/permission.PermissionService/AddUserToRole" => {
                    #[allow(non_camel_case_types)]
                    struct AddUserToRoleSvc<T: PermissionService>(pub Arc<T>);
                    impl<
                        T: PermissionService,
                    > tonic::server::UnaryService<super::UserResourceRoleRequest>
                    for AddUserToRoleSvc<T> {
                        type Response = super::super::common::ResponseStatus;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::UserResourceRoleRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as PermissionService>::add_user_to_role(&inner, request)
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
                        let method = AddUserToRoleSvc(inner);
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
                "/permission.PermissionService/AddRoleToGroup" => {
                    #[allow(non_camel_case_types)]
                    struct AddRoleToGroupSvc<T: PermissionService>(pub Arc<T>);
                    impl<
                        T: PermissionService,
                    > tonic::server::UnaryService<super::UserResourceRoleRequest>
                    for AddRoleToGroupSvc<T> {
                        type Response = super::super::common::ResponseStatus;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::UserResourceRoleRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as PermissionService>::add_role_to_group(&inner, request)
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
                        let method = AddRoleToGroupSvc(inner);
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
                "/permission.PermissionService/AddGroupToResource" => {
                    #[allow(non_camel_case_types)]
                    struct AddGroupToResourceSvc<T: PermissionService>(pub Arc<T>);
                    impl<
                        T: PermissionService,
                    > tonic::server::UnaryService<super::UserResourceRoleRequest>
                    for AddGroupToResourceSvc<T> {
                        type Response = super::super::common::ResponseStatus;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::UserResourceRoleRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as PermissionService>::add_group_to_resource(
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
                        let method = AddGroupToResourceSvc(inner);
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
                "/permission.PermissionService/RemovePermission" => {
                    #[allow(non_camel_case_types)]
                    struct RemovePermissionSvc<T: PermissionService>(pub Arc<T>);
                    impl<
                        T: PermissionService,
                    > tonic::server::UnaryService<super::PermissionRequest>
                    for RemovePermissionSvc<T> {
                        type Response = super::super::common::ResponseStatus;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::PermissionRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as PermissionService>::remove_permission(&inner, request)
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
                        let method = RemovePermissionSvc(inner);
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
                "/permission.PermissionService/RemoveUserFromResource" => {
                    #[allow(non_camel_case_types)]
                    struct RemoveUserFromResourceSvc<T: PermissionService>(pub Arc<T>);
                    impl<
                        T: PermissionService,
                    > tonic::server::UnaryService<super::UserResourceRoleRequest>
                    for RemoveUserFromResourceSvc<T> {
                        type Response = super::super::common::ResponseStatus;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::UserResourceRoleRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as PermissionService>::remove_user_from_resource(
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
                        let method = RemoveUserFromResourceSvc(inner);
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
                "/permission.PermissionService/RemoveUserFromGroup" => {
                    #[allow(non_camel_case_types)]
                    struct RemoveUserFromGroupSvc<T: PermissionService>(pub Arc<T>);
                    impl<
                        T: PermissionService,
                    > tonic::server::UnaryService<super::UserResourceRoleRequest>
                    for RemoveUserFromGroupSvc<T> {
                        type Response = super::super::common::ResponseStatus;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::UserResourceRoleRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as PermissionService>::remove_user_from_group(
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
                        let method = RemoveUserFromGroupSvc(inner);
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
                "/permission.PermissionService/RemoveRoleFromGroup" => {
                    #[allow(non_camel_case_types)]
                    struct RemoveRoleFromGroupSvc<T: PermissionService>(pub Arc<T>);
                    impl<
                        T: PermissionService,
                    > tonic::server::UnaryService<super::UserResourceRoleRequest>
                    for RemoveRoleFromGroupSvc<T> {
                        type Response = super::super::common::ResponseStatus;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::UserResourceRoleRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as PermissionService>::remove_role_from_group(
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
                        let method = RemoveRoleFromGroupSvc(inner);
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
                "/permission.PermissionService/RemoveGroupFromResource" => {
                    #[allow(non_camel_case_types)]
                    struct RemoveGroupFromResourceSvc<T: PermissionService>(pub Arc<T>);
                    impl<
                        T: PermissionService,
                    > tonic::server::UnaryService<super::UserResourceRoleRequest>
                    for RemoveGroupFromResourceSvc<T> {
                        type Response = super::super::common::ResponseStatus;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::UserResourceRoleRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as PermissionService>::remove_group_from_resource(
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
                        let method = RemoveGroupFromResourceSvc(inner);
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
    impl<T> Clone for PermissionServiceServer<T> {
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
    pub const SERVICE_NAME: &str = "permission.PermissionService";
    impl<T> tonic::server::NamedService for PermissionServiceServer<T> {
        const NAME: &'static str = SERVICE_NAME;
    }
}
