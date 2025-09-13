module github.com/wolfymaster/streamlabs/services/messagebus-gateway

go 1.22

require (
	github.com/gorilla/websocket v1.5.1
	github.com/nats-io/nats.go v1.34.0
	github.com/wolfymaster/streamlabs/shared/clients/messagebus v0.0.0
)

require (
	github.com/klauspost/compress v1.17.2 // indirect
	github.com/nats-io/nkeys v0.4.7 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	golang.org/x/crypto v0.18.0 // indirect
	golang.org/x/net v0.17.0 // indirect
	golang.org/x/sys v0.16.0 // indirect
	golang.org/x/text v0.14.0 // indirect
)

replace github.com/wolfymaster/streamlabs/shared/clients/messagebus => ../../shared/clients/messagebus