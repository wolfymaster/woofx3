module github.com/wolfymaster/woofx3/workflow

go 1.26.0

require (
	github.com/google/uuid v1.6.0
	github.com/nats-io/nats-server/v2 v2.12.2
	github.com/nats-io/nats.go v1.47.0
	github.com/robfig/cron/v3 v3.0.1
	github.com/twitchtv/twirp v8.1.3+incompatible
	github.com/wolfymaster/woofx3/clients/barkloader v0.0.0
	github.com/wolfymaster/woofx3/clients/db v0.0.0
	github.com/wolfymaster/woofx3/clients/nats v0.0.0
	github.com/wolfymaster/woofx3/common/cloudevents v0.0.0
	github.com/wolfymaster/woofx3/common/conditions v0.0.0
	github.com/wolfymaster/woofx3/common/config v0.0.0
	github.com/wolfymaster/woofx3/common/logging v0.0.0
	github.com/wolfymaster/woofx3/common/messages v0.0.0
	github.com/wolfymaster/woofx3/common/platformgateway v0.0.0
	github.com/wolfymaster/woofx3/common/runtime v0.0.0
	go.opentelemetry.io/otel v1.47.0
	google.golang.org/protobuf v1.36.12
)

require (
	github.com/antithesishq/antithesis-sdk-go v0.4.3-default-no-op // indirect
	github.com/cenkalti/backoff/v5 v5.0.3 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/cloudevents/sdk-go/v2 v2.16.2 // indirect
	github.com/dlclark/regexp2 v1.12.0 // indirect
	github.com/go-faster/errors v0.8.0 // indirect
	github.com/go-faster/jx v1.2.0 // indirect
	github.com/go-logr/logr v1.4.4 // indirect
	github.com/go-logr/stdr v1.2.2 // indirect
	github.com/google/go-tpm v0.9.6 // indirect
	github.com/gorilla/websocket v1.5.3 // indirect
	github.com/grpc-ecosystem/grpc-gateway/v2 v2.30.0 // indirect
	github.com/json-iterator/go v1.1.12 // indirect
	github.com/klauspost/compress v1.20.3 // indirect
	github.com/minio/highwayhash v1.0.4-0.20251030100505-070ab1a87a76 // indirect
	github.com/modern-go/concurrent v0.0.0-20180306012644-bacd9c7ef1dd // indirect
	github.com/modern-go/reflect2 v1.0.2 // indirect
	github.com/nats-io/jwt/v2 v2.8.0 // indirect
	github.com/nats-io/nkeys v0.4.11 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	github.com/ogen-go/ogen v1.25.0 // indirect
	github.com/segmentio/asm v1.2.1 // indirect
	github.com/shopspring/decimal v1.4.0 // indirect
	go.opentelemetry.io/auto/sdk v1.2.1 // indirect
	go.opentelemetry.io/contrib/bridges/otelslog v0.21.0 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp v0.23.0 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlptrace v1.47.0 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.47.0 // indirect
	go.opentelemetry.io/otel/exporters/stdout/stdouttrace v1.47.0 // indirect
	go.opentelemetry.io/otel/log v1.47.0 // indirect
	go.opentelemetry.io/otel/metric v1.47.0 // indirect
	go.opentelemetry.io/otel/sdk v1.47.0 // indirect
	go.opentelemetry.io/otel/sdk/log v1.47.0 // indirect
	go.opentelemetry.io/otel/trace v1.47.0 // indirect
	go.opentelemetry.io/proto/otlp v1.11.0 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	go.uber.org/zap v1.28.0 // indirect
	golang.org/x/crypto v0.58.0 // indirect
	golang.org/x/net v0.62.0 // indirect
	golang.org/x/sys v0.49.0 // indirect
	golang.org/x/text v0.43.0 // indirect
	golang.org/x/time v0.14.0 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20260928230214-8a89bd6388cc // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260928230214-8a89bd6388cc // indirect
	google.golang.org/grpc v1.83.2 // indirect
)

replace (
	github.com/wolfymaster/woofx3/clients/barkloader => ../shared/clients/golang/barkloader
	github.com/wolfymaster/woofx3/clients/db => ../shared/clients/golang/db
	github.com/wolfymaster/woofx3/clients/nats => ../shared/clients/golang/nats
	github.com/wolfymaster/woofx3/common/cloudevents => ../shared/common/golang/cloudevents
	github.com/wolfymaster/woofx3/common/conditions => ../shared/common/golang/conditions
	github.com/wolfymaster/woofx3/common/config => ../shared/common/golang/config
	github.com/wolfymaster/woofx3/common/logging => ../shared/common/golang/logging
	github.com/wolfymaster/woofx3/common/messages => ../shared/common/golang/messages
	github.com/wolfymaster/woofx3/common/platformgateway => ../shared/common/golang/platformgateway
	github.com/wolfymaster/woofx3/common/runtime => ../shared/common/golang/runtime
)
