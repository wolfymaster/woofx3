// @generated
/// Generated client implementations.
pub mod database_record_service_client {
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
    pub struct DatabaseRecordServiceClient<T> {
        inner: tonic::client::Grpc<T>,
    }
    impl DatabaseRecordServiceClient<tonic::transport::Channel> {
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
    impl<T> DatabaseRecordServiceClient<T>
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
        ) -> DatabaseRecordServiceClient<InterceptedService<T, F>>
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
            DatabaseRecordServiceClient::new(InterceptedService::new(inner, interceptor))
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
        pub async fn create_database_record(
            &mut self,
            request: impl tonic::IntoRequest<super::CreateDatabaseRecordRequest>,
        ) -> std::result::Result<
            tonic::Response<super::CreateDatabaseRecordResponse>,
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
                "/database_record.DatabaseRecordService/CreateDatabaseRecord",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "database_record.DatabaseRecordService",
                        "CreateDatabaseRecord",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn update_database_record(
            &mut self,
            request: impl tonic::IntoRequest<super::UpdateDatabaseRecordRequest>,
        ) -> std::result::Result<
            tonic::Response<super::UpdateDatabaseRecordResponse>,
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
                "/database_record.DatabaseRecordService/UpdateDatabaseRecord",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "database_record.DatabaseRecordService",
                        "UpdateDatabaseRecord",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn delete_database_record(
            &mut self,
            request: impl tonic::IntoRequest<super::DeleteDatabaseRecordRequest>,
        ) -> std::result::Result<
            tonic::Response<super::DeleteDatabaseRecordResponse>,
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
                "/database_record.DatabaseRecordService/DeleteDatabaseRecord",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "database_record.DatabaseRecordService",
                        "DeleteDatabaseRecord",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn get_database_record(
            &mut self,
            request: impl tonic::IntoRequest<super::GetDatabaseRecordRequest>,
        ) -> std::result::Result<
            tonic::Response<super::GetDatabaseRecordResponse>,
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
                "/database_record.DatabaseRecordService/GetDatabaseRecord",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "database_record.DatabaseRecordService",
                        "GetDatabaseRecord",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn list_database_records(
            &mut self,
            request: impl tonic::IntoRequest<super::ListDatabaseRecordsRequest>,
        ) -> std::result::Result<
            tonic::Response<super::ListDatabaseRecordsResponse>,
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
                "/database_record.DatabaseRecordService/ListDatabaseRecords",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "database_record.DatabaseRecordService",
                        "ListDatabaseRecords",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn find_database_record(
            &mut self,
            request: impl tonic::IntoRequest<super::FindDatabaseRecordRequest>,
        ) -> std::result::Result<
            tonic::Response<super::FindDatabaseRecordResponse>,
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
                "/database_record.DatabaseRecordService/FindDatabaseRecord",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "database_record.DatabaseRecordService",
                        "FindDatabaseRecord",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn list_public_database_records(
            &mut self,
            request: impl tonic::IntoRequest<super::ListPublicDatabaseRecordsRequest>,
        ) -> std::result::Result<
            tonic::Response<super::ListPublicDatabaseRecordsResponse>,
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
                "/database_record.DatabaseRecordService/ListPublicDatabaseRecords",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "database_record.DatabaseRecordService",
                        "ListPublicDatabaseRecords",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
    }
}
/// Generated server implementations.
pub mod database_record_service_server {
    #![allow(
        unused_variables,
        dead_code,
        missing_docs,
        clippy::wildcard_imports,
        clippy::let_unit_value,
    )]
    use tonic::codegen::*;
    /// Generated trait containing gRPC methods that should be implemented for use with DatabaseRecordServiceServer.
    #[async_trait]
    pub trait DatabaseRecordService: std::marker::Send + std::marker::Sync + 'static {
        async fn create_database_record(
            &self,
            request: tonic::Request<super::CreateDatabaseRecordRequest>,
        ) -> std::result::Result<
            tonic::Response<super::CreateDatabaseRecordResponse>,
            tonic::Status,
        >;
        async fn update_database_record(
            &self,
            request: tonic::Request<super::UpdateDatabaseRecordRequest>,
        ) -> std::result::Result<
            tonic::Response<super::UpdateDatabaseRecordResponse>,
            tonic::Status,
        >;
        async fn delete_database_record(
            &self,
            request: tonic::Request<super::DeleteDatabaseRecordRequest>,
        ) -> std::result::Result<
            tonic::Response<super::DeleteDatabaseRecordResponse>,
            tonic::Status,
        >;
        async fn get_database_record(
            &self,
            request: tonic::Request<super::GetDatabaseRecordRequest>,
        ) -> std::result::Result<
            tonic::Response<super::GetDatabaseRecordResponse>,
            tonic::Status,
        >;
        async fn list_database_records(
            &self,
            request: tonic::Request<super::ListDatabaseRecordsRequest>,
        ) -> std::result::Result<
            tonic::Response<super::ListDatabaseRecordsResponse>,
            tonic::Status,
        >;
        async fn find_database_record(
            &self,
            request: tonic::Request<super::FindDatabaseRecordRequest>,
        ) -> std::result::Result<
            tonic::Response<super::FindDatabaseRecordResponse>,
            tonic::Status,
        >;
        async fn list_public_database_records(
            &self,
            request: tonic::Request<super::ListPublicDatabaseRecordsRequest>,
        ) -> std::result::Result<
            tonic::Response<super::ListPublicDatabaseRecordsResponse>,
            tonic::Status,
        >;
    }
    #[derive(Debug)]
    pub struct DatabaseRecordServiceServer<T> {
        inner: Arc<T>,
        accept_compression_encodings: EnabledCompressionEncodings,
        send_compression_encodings: EnabledCompressionEncodings,
        max_decoding_message_size: Option<usize>,
        max_encoding_message_size: Option<usize>,
    }
    impl<T> DatabaseRecordServiceServer<T> {
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
    for DatabaseRecordServiceServer<T>
    where
        T: DatabaseRecordService,
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
                "/database_record.DatabaseRecordService/CreateDatabaseRecord" => {
                    #[allow(non_camel_case_types)]
                    struct CreateDatabaseRecordSvc<T: DatabaseRecordService>(pub Arc<T>);
                    impl<
                        T: DatabaseRecordService,
                    > tonic::server::UnaryService<super::CreateDatabaseRecordRequest>
                    for CreateDatabaseRecordSvc<T> {
                        type Response = super::CreateDatabaseRecordResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::CreateDatabaseRecordRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as DatabaseRecordService>::create_database_record(
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
                        let method = CreateDatabaseRecordSvc(inner);
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
                "/database_record.DatabaseRecordService/UpdateDatabaseRecord" => {
                    #[allow(non_camel_case_types)]
                    struct UpdateDatabaseRecordSvc<T: DatabaseRecordService>(pub Arc<T>);
                    impl<
                        T: DatabaseRecordService,
                    > tonic::server::UnaryService<super::UpdateDatabaseRecordRequest>
                    for UpdateDatabaseRecordSvc<T> {
                        type Response = super::UpdateDatabaseRecordResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::UpdateDatabaseRecordRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as DatabaseRecordService>::update_database_record(
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
                        let method = UpdateDatabaseRecordSvc(inner);
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
                "/database_record.DatabaseRecordService/DeleteDatabaseRecord" => {
                    #[allow(non_camel_case_types)]
                    struct DeleteDatabaseRecordSvc<T: DatabaseRecordService>(pub Arc<T>);
                    impl<
                        T: DatabaseRecordService,
                    > tonic::server::UnaryService<super::DeleteDatabaseRecordRequest>
                    for DeleteDatabaseRecordSvc<T> {
                        type Response = super::DeleteDatabaseRecordResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::DeleteDatabaseRecordRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as DatabaseRecordService>::delete_database_record(
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
                        let method = DeleteDatabaseRecordSvc(inner);
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
                "/database_record.DatabaseRecordService/GetDatabaseRecord" => {
                    #[allow(non_camel_case_types)]
                    struct GetDatabaseRecordSvc<T: DatabaseRecordService>(pub Arc<T>);
                    impl<
                        T: DatabaseRecordService,
                    > tonic::server::UnaryService<super::GetDatabaseRecordRequest>
                    for GetDatabaseRecordSvc<T> {
                        type Response = super::GetDatabaseRecordResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::GetDatabaseRecordRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as DatabaseRecordService>::get_database_record(
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
                        let method = GetDatabaseRecordSvc(inner);
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
                "/database_record.DatabaseRecordService/ListDatabaseRecords" => {
                    #[allow(non_camel_case_types)]
                    struct ListDatabaseRecordsSvc<T: DatabaseRecordService>(pub Arc<T>);
                    impl<
                        T: DatabaseRecordService,
                    > tonic::server::UnaryService<super::ListDatabaseRecordsRequest>
                    for ListDatabaseRecordsSvc<T> {
                        type Response = super::ListDatabaseRecordsResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::ListDatabaseRecordsRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as DatabaseRecordService>::list_database_records(
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
                        let method = ListDatabaseRecordsSvc(inner);
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
                "/database_record.DatabaseRecordService/FindDatabaseRecord" => {
                    #[allow(non_camel_case_types)]
                    struct FindDatabaseRecordSvc<T: DatabaseRecordService>(pub Arc<T>);
                    impl<
                        T: DatabaseRecordService,
                    > tonic::server::UnaryService<super::FindDatabaseRecordRequest>
                    for FindDatabaseRecordSvc<T> {
                        type Response = super::FindDatabaseRecordResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::FindDatabaseRecordRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as DatabaseRecordService>::find_database_record(
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
                        let method = FindDatabaseRecordSvc(inner);
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
                "/database_record.DatabaseRecordService/ListPublicDatabaseRecords" => {
                    #[allow(non_camel_case_types)]
                    struct ListPublicDatabaseRecordsSvc<T: DatabaseRecordService>(
                        pub Arc<T>,
                    );
                    impl<
                        T: DatabaseRecordService,
                    > tonic::server::UnaryService<
                        super::ListPublicDatabaseRecordsRequest,
                    > for ListPublicDatabaseRecordsSvc<T> {
                        type Response = super::ListPublicDatabaseRecordsResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<
                                super::ListPublicDatabaseRecordsRequest,
                            >,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as DatabaseRecordService>::list_public_database_records(
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
                        let method = ListPublicDatabaseRecordsSvc(inner);
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
    impl<T> Clone for DatabaseRecordServiceServer<T> {
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
    pub const SERVICE_NAME: &str = "database_record.DatabaseRecordService";
    impl<T> tonic::server::NamedService for DatabaseRecordServiceServer<T> {
        const NAME: &'static str = SERVICE_NAME;
    }
}
