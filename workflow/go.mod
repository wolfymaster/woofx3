module github.com/wolfymaster/woofx3/workflow

go 1.23.0

require (
	github.com/google/uuid v1.6.0
	github.com/wolfymaster/woofx3/clients/barkloader v0.0.0
	github.com/wolfymaster/woofx3/clients/db v0.0.0
	github.com/wolfymaster/woofx3/clients/nats v0.0.0
	github.com/wolfymaster/woofx3/common/cloudevents v0.0.0
	github.com/wolfymaster/woofx3/common/runtime v0.0.0
)

require (
	github.com/cloudevents/sdk-go/v2 v2.16.2 // indirect
	github.com/gorilla/websocket v1.5.3 // indirect
	github.com/json-iterator/go v1.1.12 // indirect
	github.com/klauspost/compress v1.17.11 // indirect
	github.com/modern-go/concurrent v0.0.0-20180306012644-bacd9c7ef1dd // indirect
	github.com/modern-go/reflect2 v1.0.2 // indirect
	github.com/nats-io/nats.go v1.38.0 // indirect
	github.com/nats-io/nkeys v0.4.9 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	github.com/twitchtv/twirp v8.1.3+incompatible // indirect
	go.uber.org/multierr v1.11.0 // indirect
	go.uber.org/zap v1.27.0 // indirect
	golang.org/x/crypto v0.31.0 // indirect
	golang.org/x/sys v0.28.0 // indirect
	google.golang.org/protobuf v1.36.11 // indirect
)

replace (
	github.com/wolfymaster/woofx3/clients/barkloader => ../shared/clients/golang/barkloader
	github.com/wolfymaster/woofx3/clients/db => ../shared/clients/golang/db
	github.com/wolfymaster/woofx3/clients/nats => ../shared/clients/golang/nats
	github.com/wolfymaster/woofx3/common/cloudevents => ../shared/common/golang/cloudevents
	github.com/wolfymaster/woofx3/common/runtime => ../shared/common/golang/runtime
)
