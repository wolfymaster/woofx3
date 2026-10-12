// @generated
/// Generated client implementations.
pub mod viewer_fact_service_client {
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
    pub struct ViewerFactServiceClient<T> {
        inner: tonic::client::Grpc<T>,
    }
    impl ViewerFactServiceClient<tonic::transport::Channel> {
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
    impl<T> ViewerFactServiceClient<T>
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
        ) -> ViewerFactServiceClient<InterceptedService<T, F>>
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
            ViewerFactServiceClient::new(InterceptedService::new(inner, interceptor))
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
        pub async fn upsert_fact_definition(
            &mut self,
            request: impl tonic::IntoRequest<super::UpsertFactDefinitionRequest>,
        ) -> std::result::Result<
            tonic::Response<super::FactDefinitionResponse>,
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
                "/viewer_fact.ViewerFactService/UpsertFactDefinition",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "viewer_fact.ViewerFactService",
                        "UpsertFactDefinition",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn delete_fact_definition(
            &mut self,
            request: impl tonic::IntoRequest<super::DeleteFactDefinitionRequest>,
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
                "/viewer_fact.ViewerFactService/DeleteFactDefinition",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "viewer_fact.ViewerFactService",
                        "DeleteFactDefinition",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn list_fact_definitions(
            &mut self,
            request: impl tonic::IntoRequest<super::ListFactDefinitionsRequest>,
        ) -> std::result::Result<
            tonic::Response<super::ListFactDefinitionsResponse>,
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
                "/viewer_fact.ViewerFactService/ListFactDefinitions",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "viewer_fact.ViewerFactService",
                        "ListFactDefinitions",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn apply_fact_deltas(
            &mut self,
            request: impl tonic::IntoRequest<super::ApplyFactDeltasRequest>,
        ) -> std::result::Result<
            tonic::Response<super::ApplyFactDeltasResponse>,
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
                "/viewer_fact.ViewerFactService/ApplyFactDeltas",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new("viewer_fact.ViewerFactService", "ApplyFactDeltas"),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn get_viewer_facts(
            &mut self,
            request: impl tonic::IntoRequest<super::GetViewerFactsRequest>,
        ) -> std::result::Result<
            tonic::Response<super::GetViewerFactsResponse>,
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
                "/viewer_fact.ViewerFactService/GetViewerFacts",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new("viewer_fact.ViewerFactService", "GetViewerFacts"),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn upsert_segment_definition(
            &mut self,
            request: impl tonic::IntoRequest<super::UpsertSegmentDefinitionRequest>,
        ) -> std::result::Result<
            tonic::Response<super::SegmentDefinitionResponse>,
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
                "/viewer_fact.ViewerFactService/UpsertSegmentDefinition",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "viewer_fact.ViewerFactService",
                        "UpsertSegmentDefinition",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn delete_segment_definition(
            &mut self,
            request: impl tonic::IntoRequest<super::DeleteSegmentDefinitionRequest>,
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
                "/viewer_fact.ViewerFactService/DeleteSegmentDefinition",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "viewer_fact.ViewerFactService",
                        "DeleteSegmentDefinition",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn list_segment_definitions(
            &mut self,
            request: impl tonic::IntoRequest<super::ListSegmentDefinitionsRequest>,
        ) -> std::result::Result<
            tonic::Response<super::ListSegmentDefinitionsResponse>,
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
                "/viewer_fact.ViewerFactService/ListSegmentDefinitions",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new(
                        "viewer_fact.ViewerFactService",
                        "ListSegmentDefinitions",
                    ),
                );
            self.inner.unary(req, path, codec).await
        }
        pub async fn get_viewer_segments(
            &mut self,
            request: impl tonic::IntoRequest<super::GetViewerSegmentsRequest>,
        ) -> std::result::Result<
            tonic::Response<super::GetViewerSegmentsResponse>,
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
                "/viewer_fact.ViewerFactService/GetViewerSegments",
            );
            let mut req = request.into_request();
            req.extensions_mut()
                .insert(
                    GrpcMethod::new("viewer_fact.ViewerFactService", "GetViewerSegments"),
                );
            self.inner.unary(req, path, codec).await
        }
    }
}
/// Generated server implementations.
pub mod viewer_fact_service_server {
    #![allow(
        unused_variables,
        dead_code,
        missing_docs,
        clippy::wildcard_imports,
        clippy::let_unit_value,
    )]
    use tonic::codegen::*;
    /// Generated trait containing gRPC methods that should be implemented for use with ViewerFactServiceServer.
    #[async_trait]
    pub trait ViewerFactService: std::marker::Send + std::marker::Sync + 'static {
        async fn upsert_fact_definition(
            &self,
            request: tonic::Request<super::UpsertFactDefinitionRequest>,
        ) -> std::result::Result<
            tonic::Response<super::FactDefinitionResponse>,
            tonic::Status,
        >;
        async fn delete_fact_definition(
            &self,
            request: tonic::Request<super::DeleteFactDefinitionRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
            tonic::Status,
        >;
        async fn list_fact_definitions(
            &self,
            request: tonic::Request<super::ListFactDefinitionsRequest>,
        ) -> std::result::Result<
            tonic::Response<super::ListFactDefinitionsResponse>,
            tonic::Status,
        >;
        async fn apply_fact_deltas(
            &self,
            request: tonic::Request<super::ApplyFactDeltasRequest>,
        ) -> std::result::Result<
            tonic::Response<super::ApplyFactDeltasResponse>,
            tonic::Status,
        >;
        async fn get_viewer_facts(
            &self,
            request: tonic::Request<super::GetViewerFactsRequest>,
        ) -> std::result::Result<
            tonic::Response<super::GetViewerFactsResponse>,
            tonic::Status,
        >;
        async fn upsert_segment_definition(
            &self,
            request: tonic::Request<super::UpsertSegmentDefinitionRequest>,
        ) -> std::result::Result<
            tonic::Response<super::SegmentDefinitionResponse>,
            tonic::Status,
        >;
        async fn delete_segment_definition(
            &self,
            request: tonic::Request<super::DeleteSegmentDefinitionRequest>,
        ) -> std::result::Result<
            tonic::Response<super::super::common::ResponseStatus>,
            tonic::Status,
        >;
        async fn list_segment_definitions(
            &self,
            request: tonic::Request<super::ListSegmentDefinitionsRequest>,
        ) -> std::result::Result<
            tonic::Response<super::ListSegmentDefinitionsResponse>,
            tonic::Status,
        >;
        async fn get_viewer_segments(
            &self,
            request: tonic::Request<super::GetViewerSegmentsRequest>,
        ) -> std::result::Result<
            tonic::Response<super::GetViewerSegmentsResponse>,
            tonic::Status,
        >;
    }
    #[derive(Debug)]
    pub struct ViewerFactServiceServer<T> {
        inner: Arc<T>,
        accept_compression_encodings: EnabledCompressionEncodings,
        send_compression_encodings: EnabledCompressionEncodings,
        max_decoding_message_size: Option<usize>,
        max_encoding_message_size: Option<usize>,
    }
    impl<T> ViewerFactServiceServer<T> {
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
    impl<T, B> tonic::codegen::Service<http::Request<B>> for ViewerFactServiceServer<T>
    where
        T: ViewerFactService,
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
                "/viewer_fact.ViewerFactService/UpsertFactDefinition" => {
                    #[allow(non_camel_case_types)]
                    struct UpsertFactDefinitionSvc<T: ViewerFactService>(pub Arc<T>);
                    impl<
                        T: ViewerFactService,
                    > tonic::server::UnaryService<super::UpsertFactDefinitionRequest>
                    for UpsertFactDefinitionSvc<T> {
                        type Response = super::FactDefinitionResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::UpsertFactDefinitionRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as ViewerFactService>::upsert_fact_definition(
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
                        let method = UpsertFactDefinitionSvc(inner);
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
                "/viewer_fact.ViewerFactService/DeleteFactDefinition" => {
                    #[allow(non_camel_case_types)]
                    struct DeleteFactDefinitionSvc<T: ViewerFactService>(pub Arc<T>);
                    impl<
                        T: ViewerFactService,
                    > tonic::server::UnaryService<super::DeleteFactDefinitionRequest>
                    for DeleteFactDefinitionSvc<T> {
                        type Response = super::super::common::ResponseStatus;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::DeleteFactDefinitionRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as ViewerFactService>::delete_fact_definition(
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
                        let method = DeleteFactDefinitionSvc(inner);
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
                "/viewer_fact.ViewerFactService/ListFactDefinitions" => {
                    #[allow(non_camel_case_types)]
                    struct ListFactDefinitionsSvc<T: ViewerFactService>(pub Arc<T>);
                    impl<
                        T: ViewerFactService,
                    > tonic::server::UnaryService<super::ListFactDefinitionsRequest>
                    for ListFactDefinitionsSvc<T> {
                        type Response = super::ListFactDefinitionsResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::ListFactDefinitionsRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as ViewerFactService>::list_fact_definitions(
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
                        let method = ListFactDefinitionsSvc(inner);
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
                "/viewer_fact.ViewerFactService/ApplyFactDeltas" => {
                    #[allow(non_camel_case_types)]
                    struct ApplyFactDeltasSvc<T: ViewerFactService>(pub Arc<T>);
                    impl<
                        T: ViewerFactService,
                    > tonic::server::UnaryService<super::ApplyFactDeltasRequest>
                    for ApplyFactDeltasSvc<T> {
                        type Response = super::ApplyFactDeltasResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::ApplyFactDeltasRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as ViewerFactService>::apply_fact_deltas(&inner, request)
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
                        let method = ApplyFactDeltasSvc(inner);
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
                "/viewer_fact.ViewerFactService/GetViewerFacts" => {
                    #[allow(non_camel_case_types)]
                    struct GetViewerFactsSvc<T: ViewerFactService>(pub Arc<T>);
                    impl<
                        T: ViewerFactService,
                    > tonic::server::UnaryService<super::GetViewerFactsRequest>
                    for GetViewerFactsSvc<T> {
                        type Response = super::GetViewerFactsResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::GetViewerFactsRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as ViewerFactService>::get_viewer_facts(&inner, request)
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
                        let method = GetViewerFactsSvc(inner);
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
                "/viewer_fact.ViewerFactService/UpsertSegmentDefinition" => {
                    #[allow(non_camel_case_types)]
                    struct UpsertSegmentDefinitionSvc<T: ViewerFactService>(pub Arc<T>);
                    impl<
                        T: ViewerFactService,
                    > tonic::server::UnaryService<super::UpsertSegmentDefinitionRequest>
                    for UpsertSegmentDefinitionSvc<T> {
                        type Response = super::SegmentDefinitionResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<
                                super::UpsertSegmentDefinitionRequest,
                            >,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as ViewerFactService>::upsert_segment_definition(
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
                        let method = UpsertSegmentDefinitionSvc(inner);
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
                "/viewer_fact.ViewerFactService/DeleteSegmentDefinition" => {
                    #[allow(non_camel_case_types)]
                    struct DeleteSegmentDefinitionSvc<T: ViewerFactService>(pub Arc<T>);
                    impl<
                        T: ViewerFactService,
                    > tonic::server::UnaryService<super::DeleteSegmentDefinitionRequest>
                    for DeleteSegmentDefinitionSvc<T> {
                        type Response = super::super::common::ResponseStatus;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<
                                super::DeleteSegmentDefinitionRequest,
                            >,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as ViewerFactService>::delete_segment_definition(
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
                        let method = DeleteSegmentDefinitionSvc(inner);
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
                "/viewer_fact.ViewerFactService/ListSegmentDefinitions" => {
                    #[allow(non_camel_case_types)]
                    struct ListSegmentDefinitionsSvc<T: ViewerFactService>(pub Arc<T>);
                    impl<
                        T: ViewerFactService,
                    > tonic::server::UnaryService<super::ListSegmentDefinitionsRequest>
                    for ListSegmentDefinitionsSvc<T> {
                        type Response = super::ListSegmentDefinitionsResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::ListSegmentDefinitionsRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as ViewerFactService>::list_segment_definitions(
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
                        let method = ListSegmentDefinitionsSvc(inner);
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
                "/viewer_fact.ViewerFactService/GetViewerSegments" => {
                    #[allow(non_camel_case_types)]
                    struct GetViewerSegmentsSvc<T: ViewerFactService>(pub Arc<T>);
                    impl<
                        T: ViewerFactService,
                    > tonic::server::UnaryService<super::GetViewerSegmentsRequest>
                    for GetViewerSegmentsSvc<T> {
                        type Response = super::GetViewerSegmentsResponse;
                        type Future = BoxFuture<
                            tonic::Response<Self::Response>,
                            tonic::Status,
                        >;
                        fn call(
                            &mut self,
                            request: tonic::Request<super::GetViewerSegmentsRequest>,
                        ) -> Self::Future {
                            let inner = Arc::clone(&self.0);
                            let fut = async move {
                                <T as ViewerFactService>::get_viewer_segments(
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
                        let method = GetViewerSegmentsSvc(inner);
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
    impl<T> Clone for ViewerFactServiceServer<T> {
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
    pub const SERVICE_NAME: &str = "viewer_fact.ViewerFactService";
    impl<T> tonic::server::NamedService for ViewerFactServiceServer<T> {
        const NAME: &'static str = SERVICE_NAME;
    }
}
