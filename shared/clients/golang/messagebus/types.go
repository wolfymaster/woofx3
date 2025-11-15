package messagebus

import (
	"encoding/json"
)

// Msg represents a message interface compatible with NATS messages
type Msg interface {
	Subject() string
	Data() []byte
	JSON(v interface{}) error
	String() string
}

// Handler function for processing messages
type Handler func(msg Msg)

// Subscription interface for managing subscriptions
type Subscription interface {
	// Unsubscribe from the subject
	Unsubscribe() error

	// Drain the subscription gracefully
	Drain() error
}

// SubscribeOptions for configuring subscriptions
type SubscribeOptions struct {
	// Future options like queue groups can be added here
}

// MessageBus interface
type MessageBus interface {
	// Publish data to a subject
	Publish(subject string, data []byte) error

	// Subscribe to a subject with a handler
	Subscribe(subject string, handler Handler, opts *SubscribeOptions) (Subscription, error)

	// Close the message bus and all connections
	Close() error

	// AsNATS returns the underlying NATS connection if available
	AsNATS() interface{}
}

// Backend type for message bus
type Backend string

const (
	BackendNATS Backend = "nats"
	BackendHTTP Backend = "http"
)

// NATSConfig configuration for NATS backend
type NATSConfig struct {
	URL      string `json:"url,omitempty"`
	Name     string `json:"name,omitempty"`
	JWT      string `json:"jwt,omitempty"`
	NKeySeed string `json:"nkeySeed,omitempty"`
}

// HTTPConfig configuration for HTTP backend
type HTTPConfig struct {
	URL              string `json:"url,omitempty"`
	ReconnectTimeout int    `json:"reconnectTimeout,omitempty"`
	MaxRetries       int    `json:"maxRetries,omitempty"`
}

// MessageBusConfig configuration for message bus
type MessageBusConfig struct {
	Backend Backend     `json:"backend"`
	NATS    *NATSConfig `json:"nats,omitempty"`
	HTTP    *HTTPConfig `json:"http,omitempty"`
	Logger  Logger      `json:"-"` // Don't serialize logger
}

// Logger interface for logging
type Logger interface {
	Info(message string, args ...interface{})
	Error(message string, args ...interface{})
	Warn(message string, args ...interface{})
	Debug(message string, args ...interface{})
}

// BasicMsg is a concrete implementation of the Msg interface
type BasicMsg struct {
	subject string
	data    []byte
}

// NewBasicMsg creates a new BasicMsg
func NewBasicMsg(subject string, data []byte) *BasicMsg {
	return &BasicMsg{
		subject: subject,
		data:    data,
	}
}

// Subject returns the message subject
func (m *BasicMsg) Subject() string {
	return m.subject
}

// Data returns the message data
func (m *BasicMsg) Data() []byte {
	return m.data
}

// JSON unmarshals the message data into the provided interface
func (m *BasicMsg) JSON(v interface{}) error {
	return json.Unmarshal(m.data, v)
}

// String returns the message data as a string
func (m *BasicMsg) String() string {
	return string(m.data)
}

// NoOpLogger is a logger that does nothing
type NoOpLogger struct{}

// Info implements Logger interface
func (l *NoOpLogger) Info(message string, args ...interface{}) {}

// Error implements Logger interface
func (l *NoOpLogger) Error(message string, args ...interface{}) {}

// Warn implements Logger interface
func (l *NoOpLogger) Warn(message string, args ...interface{}) {}

// Debug implements Logger interface
func (l *NoOpLogger) Debug(message string, args ...interface{}) {}

// DefaultLogger returns a no-op logger
func DefaultLogger() Logger {
	return &NoOpLogger{}
}
