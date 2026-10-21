// @generated
/// Generated client implementations.
pub mod local_ui_setting_service_client {
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
    pub struct LocalUiSettingServiceClient<T> {
        inner: tonic::client::Grpc<T>,
    }
    impl LocalUiSettingServiceClient<tonic::transport::Channel> {
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
    impl<T> LocalUiSettingServiceClient<T>
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
        ) -> LocalUiSettingServiceClient<InterceptedService<T, F>>
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
            LocalUiSettingServiceClient::new(InterceptedService::new(inner, interceptor))
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
        pub async fn list_local_ui_settings(
            &mut self,
            request: impl tonic::IntoRequest<super::ListLocalUiSettingsRequest>,
        ) -> std::result::Result<
            tonic::Response<super::ListLocalUiSettingsResponse>,
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
                "/local_ui_setting.LocalUISettingService/ListLocalUISettings",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "local_ui_setting.LocalUISettingService",
                        "ListLocalUISettings",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn get_local_ui_setting(
            &mut self,
            request: impl tonic::IntoRequest<super::GetLocalUiSettingRequest>,
        ) -> std::result::Result<
            tonic::Response<super::GetLocalUiSettingResponse>,
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
                "/local_ui_setting.LocalUISettingService/GetLocalUISetting",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "local_ui_setting.LocalUISettingService",
                        "GetLocalUISetting",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn set_local_ui_setting(
            &mut self,
            request: impl tonic::IntoRequest<super::SetLocalUiSettingRequest>,
        ) -> std::result::Result<
            tonic::Response<super::WriteLocalUiSettingResponse>,
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
                "/local_ui_setting.LocalUISettingService/SetLocalUISetting",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "local_ui_setting.LocalUISettingService",
                        "SetLocalUISetting",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn delete_local_ui_setting(
            &mut self,
            request: impl tonic::IntoRequest<super::DeleteLocalUiSettingRequest>,
        ) -> std::result::Result<
            tonic::Response<super::WriteLocalUiSettingResponse>,
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
                "/local_ui_setting.LocalUISettingService/DeleteLocalUISetting",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "local_ui_setting.LocalUISettingService",
                        "DeleteLocalUISetting",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn list_local_ui_setting_changes(
            &mut self,
            request: impl tonic::IntoRequest<super::ListLocalUiSettingChangesRequest>,
        ) -> std::result::Result<
            tonic::Response<super::ListLocalUiSettingChangesResponse>,
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
                "/local_ui_setting.LocalUISettingService/ListLocalUISettingChanges",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "local_ui_setting.LocalUISettingService",
                        "ListLocalUISettingChanges",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
    }
}
/// Generated server implementations.
pub mod local_ui_setting_service_server {
    #![allow(
        unused_variables,
        dead_code,
        missing_docs,
        clippy::wildcard_imports,
        clippy::let_unit_value,
    )]
    use tonic::codegen::*;
    /// Generated trait containing gRPC methods that should be implemented for use with LocalUiSettingServiceServer.
    #[async_trait]
    pub trait LocalUiSettingService: std::marker::Send + std::marker::Sync + 'static {
        async fn list_local_ui_settings(
            &self,
            request: tonic::Request<super::ListLocalUiSettingsRequest>,
        ) -> std::result::Result<
            tonic::Response<super::ListLocalUiSettingsResponse>,
            tonic::Status,
        >;
        async fn get_local_ui_setting(
            &self,
            request: tonic::Request<super::GetLocalUiSettingRequest>,
        ) -> std::result::Result<
            tonic::Response<super::GetLocalUiSettingResponse>,
            tonic::Status,
        >;
        async fn set_local_ui_setting(
            &self,
            request: tonic::Request<super::SetLocalUiSettingRequest>,
        ) -> std::result::Result<
            tonic::Response<super::WriteLocalUiSettingResponse>,
            tonic::Status,
        >;
        async fn delete_local_ui_setting(
            &self,
            request: tonic::Request<super::DeleteLocalUiSettingRequest>,
        ) -> std::result::Result<
            tonic::Response<super::WriteLocalUiSettingResponse>,
            tonic::Status,
        >;
        async fn list_local_ui_setting_changes(
            &self,
            request: tonic::Request<super::ListLocalUiSettingChangesRequest>,
        ) -> std::result::Result<
            tonic::Response<super::ListLocalUiSettingChangesResponse>,
            tonic::Status,
        >;
    }
    #[derive(Debug)]
    pub struct LocalUiSettingServiceServer<T> {
        inner: Arc<T>,
        accept_compression_encodings: EnabledCompressionEncodings,
        send_compression_encodings: EnabledCompressionEncodings,
        max_decoding_message_size: Option<usize>,
        max_encoding_message_size: Option<usize>,
    }
    impl<T> LocalUiSettingServiceServer<T> {
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
    for LocalUiSettingServiceServer<T>
    where
        T: LocalUiSettingService,
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
                "/local_ui_setting.LocalUISettingService/ListLocalUISettings" => {
                    #[allow(non_camel_case_types)]
                    struct ListLocalUISettingsSvc<T: LocalUiSettingService>(pub Arc<T>);
                    impl<
                        T: LocalUiSettingService,
                    > tonic::server::UnaryService<super::ListLocalUiSettingsRequest>
                    for ListLocalUISettingsSvc<T> {
                        type Response = super::ListLocalUiSettingsResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::ListLocalUiSettingsRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as LocalUiSettingService>::list_local_ui_settings(
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
                        let method = ListLocalUISettingsSvc(inner);
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
                "/local_ui_setting.LocalUISettingService/GetLocalUISetting" => {
                    #[allow(non_camel_case_types)]
                    struct GetLocalUISettingSvc<T: LocalUiSettingService>(pub Arc<T>);
                    impl<
                        T: LocalUiSettingService,
                    > tonic::server::UnaryService<super::GetLocalUiSettingRequest>
                    for GetLocalUISettingSvc<T> {
                        type Response = super::GetLocalUiSettingResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::GetLocalUiSettingRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as LocalUiSettingService>::get_local_ui_setting(
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
                        let method = GetLocalUISettingSvc(inner);
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
                "/local_ui_setting.LocalUISettingService/SetLocalUISetting" => {
                    #[allow(non_camel_case_types)]
                    struct SetLocalUISettingSvc<T: LocalUiSettingService>(pub Arc<T>);
                    impl<
                        T: LocalUiSettingService,
                    > tonic::server::UnaryService<super::SetLocalUiSettingRequest>
                    for SetLocalUISettingSvc<T> {
                        type Response = super::WriteLocalUiSettingResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::SetLocalUiSettingRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as LocalUiSettingService>::set_local_ui_setting(
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
                        let method = SetLocalUISettingSvc(inner);
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
                "/local_ui_setting.LocalUISettingService/DeleteLocalUISetting" => {
                    #[allow(non_camel_case_types)]
                    struct DeleteLocalUISettingSvc<T: LocalUiSettingService>(pub Arc<T>);
                    impl<
                        T: LocalUiSettingService,
                    > tonic::server::UnaryService<super::DeleteLocalUiSettingRequest>
                    for DeleteLocalUISettingSvc<T> {
                        type Response = super::WriteLocalUiSettingResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::DeleteLocalUiSettingRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as LocalUiSettingService>::delete_local_ui_setting(
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
                        let method = DeleteLocalUISettingSvc(inner);
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
                "/local_ui_setting.LocalUISettingService/ListLocalUISettingChanges" => {
                    #[allow(non_camel_case_types)]
                    struct ListLocalUISettingChangesSvc<T: LocalUiSettingService>(
                        pub Arc<T>,
                    );
                    impl<
                        T: LocalUiSettingService,
                    > tonic::server::UnaryService<
                        super::ListLocalUiSettingChangesRequest,
                    > for ListLocalUISettingChangesSvc<T> {
                        type Response = super::ListLocalUiSettingChangesResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<
                                super::ListLocalUiSettingChangesRequest,
                            >,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as LocalUiSettingService>::list_local_ui_setting_changes(
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
                        let method = ListLocalUISettingChangesSvc(inner);
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
    impl<T> Clone for LocalUiSettingServiceServer<T> {
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
    pub const SERVICE_NAME: &str = "local_ui_setting.LocalUISettingService";
    impl<T> tonic::server::NamedService for LocalUiSettingServiceServer<T> {
        const NAME: &'static str = SERVICE_NAME;
    }
}
