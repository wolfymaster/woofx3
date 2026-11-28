module github.com/wolfymaster/woofx3/common/runtime

go 1.26.0

require (
	github.com/google/uuid v1.6.0
	github.com/nats-io/nats.go v1.38.0
	github.com/wolfymaster/woofx3/clients/barkloader v0.0.0
	github.com/wolfymaster/woofx3/clients/db v0.0.0
	github.com/wolfymaster/woofx3/clients/nats v0.0.0
	github.com/wolfymaster/woofx3/common/config v0.0.0
	github.com/wolfymaster/woofx3/common/messages v0.0.0
	go.opentelemetry.io/otel/metric v1.47.0
)

require (
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/dlclark/regexp2 v1.12.0 // indirect
	github.com/go-faster/errors v0.8.0 // indirect
	github.com/go-faster/jx v1.2.0 // indirect
	github.com/go-logr/logr v1.4.4 // indirect
	github.com/go-logr/stdr v1.2.2 // indirect
	github.com/gorilla/websocket v1.5.3 // indirect
	github.com/klauspost/compress v1.20.3 // indirect
	github.com/nats-io/nkeys v0.4.9 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	github.com/ogen-go/ogen v1.25.0 // indirect
	github.com/segmentio/asm v1.2.1 // indirect
	github.com/shopspring/decimal v1.4.0 // indirect
	github.com/twitchtv/twirp v8.1.3+incompatible // indirect
	go.opentelemetry.io/auto/sdk v1.2.1 // indirect
	go.opentelemetry.io/otel v1.47.0 // indirect
	go.opentelemetry.io/otel/log v1.47.0 // indirect
	go.opentelemetry.io/otel/trace v1.47.0 // indirect
	golang.org/x/crypto v0.31.0 // indirect
	golang.org/x/sys v0.49.0 // indirect
	golang.org/x/text v0.43.0 // indirect
	google.golang.org/protobuf v1.36.11 // indirect
)

replace (
	github.com/wolfymaster/woofx3/clients/barkloader => ../../../clients/golang/barkloader
	github.com/wolfymaster/woofx3/clients/db => ../../../clients/golang/db
	github.com/wolfymaster/woofx3/clients/nats => ../../../clients/golang/nats
	github.com/wolfymaster/woofx3/common/cloudevents => ../../../common/golang/cloudevents
	github.com/wolfymaster/woofx3/common/config => ../../../common/golang/config
	github.com/wolfymaster/woofx3/common/messages => ../../../common/golang/messages
)
