module github.com/wolfymaster/woofx3/common/runtime

go 1.23.0

require (
	github.com/wolfymaster/woofx3/clients/cloudevents v0.0.0
	github.com/wolfymaster/woofx3/clients/nats v0.0.0
)

require (
	github.com/google/uuid v1.6.0 // indirect
	github.com/klauspost/compress v1.17.11 // indirect
	github.com/nats-io/nats.go v1.38.0 // indirect
	github.com/nats-io/nkeys v0.4.9 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	golang.org/x/crypto v0.31.0 // indirect
	golang.org/x/sys v0.28.0 // indirect
)

replace (
	github.com/wolfymaster/woofx3/clients/cloudevents => ../../../clients/golang/cloudevents
	github.com/wolfymaster/woofx3/clients/nats => ../../../clients/golang/nats
)
