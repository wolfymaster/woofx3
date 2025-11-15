package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/nats-io/nats.go"
	"github.com/wolfymaster/woofx3/clients/messagebus"
	"github.com/wolfymaster/woofx3/messagebus/internal/config"
)

// Gateway handles WebSocket connections and bridges them to NATS
type Gateway struct {
	config   *config.Config
	logger   *slog.Logger
	bus      messagebus.MessageBus
	upgrader websocket.Upgrader
	clients  map[*Client]bool
	mutex    sync.RWMutex
	ctx      context.Context
	cancel   context.CancelFunc
}

// Client represents a WebSocket client connection
type Client struct {
	gateway       *Gateway
	conn          *websocket.Conn
	send          chan []byte
	subscriptions map[string]messagebus.Subscription
	mutex         sync.RWMutex
	logger        *slog.Logger
}

// Message represents the WebSocket message format
type Message struct {
	Type    string      `json:"type"`
	Subject string      `json:"subject,omitempty"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// New creates a new Gateway instance
func New(cfg *config.Config, logger *slog.Logger) (*Gateway, error) {
	ctx, cancel := context.WithCancel(context.Background())

	// Create message bus connection
	busConfig := messagebus.MessageBusConfig{
		Backend: messagebus.BackendNATS,
		Logger:  logger,
		NATS: &messagebus.NATSConfig{
			URL:      cfg.NATS.URL,
			Name:     cfg.NATS.Name,
			JWT:      cfg.NATS.JWT,
			NKeySeed: cfg.NATS.NKeySeed,
		},
	}

	// Try NATS first, fallback to memory if no credentials
	if cfg.NATS.JWT == "" || cfg.NATS.NKeySeed == "" {
		busConfig.Backend = messagebus.BackendHTTP
		logger.Info("Using memory backend (NATS credentials not provided)")
	}

	bus, err := messagebus.New(ctx, busConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create message bus: %w", err)
	}

	gw := &Gateway{
		config: cfg,
		logger: logger,
		bus:    bus,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				// TODO: Implement proper origin checking for production
				return true
			},
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
		},
		clients: make(map[*Client]bool),
		ctx:     ctx,
		cancel:  cancel,
	}

	return gw, nil
}

// HandleWebSocket handles WebSocket upgrade and client management
func (gw *Gateway) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := gw.upgrader.Upgrade(w, r, nil)
	if err != nil {
		gw.logger.Error("WebSocket upgrade failed", "error", err)
		return
	}

	client := &Client{
		gateway:       gw,
		conn:          conn,
		send:          make(chan []byte, 256),
		subscriptions: make(map[string]messagebus.Subscription),
		logger:        gw.logger.With("client", conn.RemoteAddr().String()),
	}

	gw.mutex.Lock()
	gw.clients[client] = true
	gw.mutex.Unlock()

	client.logger.Info("Client connected")

	// Start client goroutines
	go client.writePump()
	go client.readPump()
}

// Close shuts down the gateway
func (gw *Gateway) Close() {
	gw.cancel()

	gw.mutex.Lock()
	defer gw.mutex.Unlock()

	// Close all client connections
	for client := range gw.clients {
		client.close()
	}

	// Close message bus
	if gw.bus != nil {
		gw.bus.Close()
	}

	gw.logger.Info("Gateway closed")
}

// IsHealthy returns true if the gateway can connect to NATS
func (gw *Gateway) IsHealthy() bool {
	if gw.bus == nil {
		return false
	}

	// Try to publish a test message
	testData := []byte("health-check")
	err := gw.bus.Publish("_health.check", testData)
	return err == nil
}

// GetConnectedClients returns the number of connected clients
func (gw *Gateway) GetConnectedClients() int {
	gw.mutex.RLock()
	defer gw.mutex.RUnlock()
	return len(gw.clients)
}

// readPump handles incoming WebSocket messages from client
func (c *Client) readPump() {
	defer func() {
		c.gateway.removeClient(c)
		c.conn.Close()
	}()

	// c.conn.SetReadLimit(512)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, messageData, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				c.logger.Error("WebSocket error", "error", err)
			}
			break
		}

		var msg Message
		if err := json.Unmarshal(messageData, &msg); err != nil {
			c.sendError("Invalid JSON format")
			continue
		}

		c.handleMessage(&msg)
	}
}

// writePump handles outgoing WebSocket messages to client
func (c *Client) writePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// handleMessage processes incoming client messages
func (c *Client) handleMessage(msg *Message) {
	switch msg.Type {
	case "subscribe":
		c.handleSubscribe(msg.Subject)
	case "unsubscribe":
		c.handleUnsubscribe(msg.Subject)
	case "publish":
		c.handlePublish(msg.Subject, msg.Data)
	default:
		c.sendError(fmt.Sprintf("Unknown message type: %s", msg.Type))
	}
}

// handleSubscribe creates a subscription to a subject
func (c *Client) handleSubscribe(subject string) {
	if subject == "" {
		c.sendError("Subject is required for subscribe")
		return
	}

	c.mutex.Lock()
	defer c.mutex.Unlock()

	// Check if already subscribed
	if _, exists := c.subscriptions[subject]; exists {
		return
	}

	// Create subscription
	sub, err := c.gateway.bus.Subscribe(subject, func(msg *nats.Msg) {
		// Convert message data to format expected by TypeScript client
		var data interface{}
		if len(msg.Data) > 0 {
			// Send as number array for TypeScript compatibility
			dataBytes := make([]int, len(msg.Data))
			for i, b := range msg.Data {
				dataBytes[i] = int(b)
			}
			data = dataBytes
		}

		response := Message{
			Type:    "message",
			Subject: msg.Subject,
			Data:    data,
		}

		c.sendMessage(&response)
	})

	if err != nil {
		c.sendError(fmt.Sprintf("Failed to subscribe to %s: %v", subject, err))
		return
	}

	c.subscriptions[subject] = sub
	c.logger.Debug("Client subscribed", "subject", subject)
}

// handleUnsubscribe removes a subscription
func (c *Client) handleUnsubscribe(subject string) {
	c.mutex.Lock()
	defer c.mutex.Unlock()

	sub, exists := c.subscriptions[subject]
	if !exists {
		return
	}

	sub.Unsubscribe()
	delete(c.subscriptions, subject)
	c.logger.Debug("Client unsubscribed", "subject", subject)
}

// handlePublish publishes a message to a subject
func (c *Client) handlePublish(subject string, data interface{}) {
	if subject == "" {
		c.sendError("Subject is required for publish")
		return
	}

	// Convert data to bytes
	var bytes []byte
	switch v := data.(type) {
	case string:
		bytes = []byte(v)
	case []any:
		// Handle number array from TypeScript client
		bytes = make([]byte, len(v))
		for i, val := range v {
			if num, ok := val.(float64); ok {
				bytes[i] = byte(num)
			}
		}
	default:
		// Try JSON encoding
		jsonData, err := json.Marshal(v)
		if err != nil {
			c.sendError(fmt.Sprintf("Failed to encode data: %v", err))
			return
		}
		bytes = jsonData
	}

	// Publish to message bus
	if err := c.gateway.bus.Publish(subject, bytes); err != nil {
		c.sendError(fmt.Sprintf("Failed to publish to %s: %v", subject, err))
		return
	}

	c.logger.Debug("Client published", "subject", subject, "size", len(bytes))
}

// sendMessage sends a message to the client
func (c *Client) sendMessage(msg *Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		c.logger.Error("Failed to marshal message", "error", err)
		return
	}

	select {
	case c.send <- data:
	default:
		close(c.send)
	}
}

// sendError sends an error message to the client
func (c *Client) sendError(errMsg string) {
	c.logger.Warn("Client error", "error", errMsg)
	c.sendMessage(&Message{
		Type:  "error",
		Error: errMsg,
	})
}

// close closes the client connection and cleans up subscriptions
func (c *Client) close() {
	c.mutex.Lock()
	defer c.mutex.Unlock()

	// Unsubscribe from all subjects
	for subject, sub := range c.subscriptions {
		sub.Unsubscribe()
		delete(c.subscriptions, subject)
	}

	close(c.send)
	c.logger.Info("Client disconnected")
}

// removeClient removes a client from the gateway's client list
func (gw *Gateway) removeClient(client *Client) {
	gw.mutex.Lock()
	defer gw.mutex.Unlock()

	if _, exists := gw.clients[client]; exists {
		delete(gw.clients, client)
	}
}
