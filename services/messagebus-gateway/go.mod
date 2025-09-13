module github.com/wolfymaster/streamlabs/services/messagebus-gateway

go 1.23.0

toolchain go1.24.4

require (
	github.com/gorilla/websocket v1.5.1
	github.com/wolfymaster/streamlabs/shared/clients/messagebus v0.0.0
)

require (
	github.com/klauspost/compress v1.17.2 // indirect
	github.com/nats-io/nats.go v1.34.0 // indirect
	github.com/nats-io/nkeys v0.4.7 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	golang.org/x/crypto v0.38.0 // indirect
	golang.org/x/net v0.21.0 // indirect
	golang.org/x/sys v0.33.0 // indirect
)

replace github.com/wolfymaster/streamlabs/shared/clients/messagebus => ../../shared/clients/messagebus
