module github.com/wolfymaster/woofx3/workflow

go 1.23.0

require (
	github.com/google/uuid v1.6.0
	github.com/robfig/cron/v3 v3.0.1
	github.com/wolfymaster/woofx3/clients/barkloader v0.0.0
	github.com/wolfymaster/woofx3/clients/db v0.0.0
	github.com/wolfymaster/woofx3/clients/nats v0.0.0
	github.com/wolfymaster/woofx3/common/cloudevents v0.0.0
	github.com/wolfymaster/woofx3/common/logging v0.0.0
	github.com/wolfymaster/woofx3/common/runtime v0.0.0
	go.opentelemetry.io/otel v1.38.0
	google.golang.org/protobuf v1.36.11
)

require (
	github.com/cenkalti/backoff/v5 v5.0.3 // indirect
	github.com/cloudevents/sdk-go/v2 v2.16.2 // indirect
	github.com/go-logr/logr v1.4.3 // indirect
	github.com/go-logr/stdr v1.2.2 // indirect
	github.com/gorilla/websocket v1.5.3 // indirect
	github.com/grpc-ecosystem/grpc-gateway/v2 v2.27.2 // indirect
	github.com/json-iterator/go v1.1.12 // indirect
	github.com/klauspost/compress v1.17.11 // indirect
	github.com/modern-go/concurrent v0.0.0-20180306012644-bacd9c7ef1dd // indirect
	github.com/modern-go/reflect2 v1.0.2 // indirect
	github.com/nats-io/nats.go v1.38.0 // indirect
	github.com/nats-io/nkeys v0.4.9 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	github.com/twitchtv/twirp v8.1.3+incompatible // indirect
	go.opentelemetry.io/auto/sdk v1.1.0 // indirect
	go.opentelemetry.io/contrib/bridges/otelslog v0.13.0 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp v0.14.0 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlptrace v1.38.0 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.38.0 // indirect
	go.opentelemetry.io/otel/exporters/stdout/stdouttrace v1.38.0 // indirect
	go.opentelemetry.io/otel/log v0.14.0 // indirect
	go.opentelemetry.io/otel/metric v1.38.0 // indirect
	go.opentelemetry.io/otel/sdk v1.38.0 // indirect
	go.opentelemetry.io/otel/sdk/log v0.14.0 // indirect
	go.opentelemetry.io/otel/trace v1.38.0 // indirect
	go.opentelemetry.io/proto/otlp v1.7.1 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	go.uber.org/zap v1.27.0 // indirect
	golang.org/x/crypto v0.41.0 // indirect
	golang.org/x/net v0.43.0 // indirect
	golang.org/x/sys v0.35.0 // indirect
	golang.org/x/text v0.28.0 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20250825161204-c5933d9347a5 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20250825161204-c5933d9347a5 // indirect
	google.golang.org/grpc v1.75.0 // indirect
)

replace (
	github.com/wolfymaster/woofx3/clients/barkloader => ../shared/clients/golang/barkloader
	github.com/wolfymaster/woofx3/clients/db => ../shared/clients/golang/db
	github.com/wolfymaster/woofx3/clients/nats => ../shared/clients/golang/nats
	github.com/wolfymaster/woofx3/common/cloudevents => ../shared/common/golang/cloudevents
	github.com/wolfymaster/woofx3/common/logging => ../shared/common/golang/logging
	github.com/wolfymaster/woofx3/common/runtime => ../shared/common/golang/runtime
)
