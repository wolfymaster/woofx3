package messagebus

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// HTTPBackend implements MessageBus interface using WebSocket connection
type HTTPBackend struct {
	config              HTTPConfig
	logger              Logger
	conn                *websocket.Conn
	subscriptions       map[string]map[int]Handler // subject -> subscription_id -> handler
	subscriptionCounter int
	reconnectTimer      *time.Timer
	shouldReconnect     bool
	currentRetryCount   int
	isConnecting        bool
	mu                  sync.RWMutex
	ctx                 context.Context
	cancel              context.CancelFunc
	wg                  sync.WaitGroup
}

// WebSocketMessage represents incoming WebSocket messages
type WebSocketMessage struct {
	Type    string      `json:"type"`
	Subject string      `json:"subject,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

// HTTPSubscription represents a subscription to a subject
type HTTPSubscription struct {
	id      int
	subject string
	handler Handler
	backend *HTTPBackend
	logger  Logger
}

// NewHTTPBackend creates a new HTTP backend instance
func NewHTTPBackend(config HTTPConfig, logger Logger) *HTTPBackend {
	if logger == nil {
		logger = DefaultLogger()
	}

	ctx, cancel := context.WithCancel(context.Background())

	return &HTTPBackend{
		config:              config,
		logger:              logger,
		subscriptions:       make(map[string]map[int]Handler),
		subscriptionCounter: 0,
		shouldReconnect:     true,
		currentRetryCount:   0,
		isConnecting:        false,
		ctx:                 ctx,
		cancel:              cancel,
	}
}

// Connect establishes WebSocket connection
func (h *HTTPBackend) Connect() error {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.isConnecting || (h.conn != nil && h.conn.WriteMessage != nil) {
		return nil
	}

	h.isConnecting = true
	defer func() { h.isConnecting = false }()

	wsURL := h.config.URL
	if wsURL == "" {
		wsURL = "ws://localhost:8080/ws"
	}

	// Parse and validate URL
	u, err := url.Parse(wsURL)
	if err != nil {
		return fmt.Errorf("invalid WebSocket URL: %w", err)
	}

	// Connect to WebSocket
	dialer := websocket.DefaultDialer
	conn, _, err := dialer.Dial(u.String(), nil)
	if err != nil {
		h.logger.Error("Failed to connect to HTTP message bus: %v", err)
		return fmt.Errorf("WebSocket connection failed: %w", err)
	}

	h.conn = conn
	h.currentRetryCount = 0
	h.logger.Info("Connected to HTTP message bus", "url", wsURL)

	// Start message reader goroutine
	h.wg.Add(1)
	go h.messageReader()

	// Re-establish subscriptions
	if err := h.reestablishSubscriptions(); err != nil {
		h.logger.Error("Failed to re-establish subscriptions: %v", err)
		return err
	}

	return nil
}

// messageReader handles incoming WebSocket messages
func (h *HTTPBackend) messageReader() {
	defer h.wg.Done()
	defer func() {
		if h.shouldReconnect {
			h.scheduleReconnect()
		}
	}()

	for {
		select {
		case <-h.ctx.Done():
			return
		default:
		}

		var message WebSocketMessage
		err := h.conn.ReadJSON(&message)
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				h.logger.Error("WebSocket read error: %v", err)
			}
			h.logger.Info("WebSocket connection closed")
			return
		}

		h.handleMessage(message)
	}
}

// handleMessage processes incoming messages
func (h *HTTPBackend) handleMessage(message WebSocketMessage) {
	if message.Type != "message" || message.Subject == "" || message.Data == nil {
		return
	}

	msg, err := CreateMessage(message.Subject, message.Data)
	if err != nil {
		h.logger.Error("Failed to create message: %v", err)
		return
	}

	h.mu.RLock()
	handlers := h.subscriptions[message.Subject]
	h.mu.RUnlock()

	// Call direct handlers
	for _, handler := range handlers {
		go func(h Handler) {
			defer func() {
				if r := recover(); r != nil {
					h.logger.Error("Handler panic: %v", r)
				}
			}()
			handler(msg)
		}(handler)
	}

	// Handle wildcard subscriptions
	h.matchWildcardSubscriptions(message.Subject, msg)
}

// matchWildcardSubscriptions handles wildcard pattern matching
func (h *HTTPBackend) matchWildcardSubscriptions(subject string, msg Msg) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for pattern, handlers := range h.subscriptions {
		if pattern != subject && h.matchesWildcard(pattern, subject) {
			for _, handler := range handlers {
				go func(h Handler) {
					defer func() {
						if r := recover(); r != nil {
							h.logger.Error("Wildcard handler panic: %v", r)
						}
					}()
					handler(msg)
				}(handler)
			}
		}
	}
}

// matchesWildcard checks if a pattern matches a subject
func (h *HTTPBackend) matchesWildcard(pattern, subject string) bool {
	patternTokens := strings.Split(pattern, ".")
	subjectTokens := strings.Split(subject, ".")

	pi, si := 0, 0

	for pi < len(patternTokens) && si < len(subjectTokens) {
		switch patternTokens[pi] {
		case "*":
			// '*' matches exactly one token
			pi++
			si++
		case ">":
			// '>' matches one or more remaining tokens (must be last in pattern)
			if pi == len(patternTokens)-1 {
				return si < len(subjectTokens)
			}
			return false
		default:
			// Exact match required
			if patternTokens[pi] != subjectTokens[si] {
				return false
			}
			pi++
			si++
		}
	}

	// Handle remaining pattern tokens
	if pi < len(patternTokens) {
		return len(patternTokens)-pi == 1 &&
			patternTokens[pi] == ">" &&
			si < len(subjectTokens)
	}

	return pi == len(patternTokens) && si == len(subjectTokens)
}

// reestablishSubscriptions re-subscribes to all subjects after reconnection
func (h *HTTPBackend) reestablishSubscriptions() error {
	h.mu.RLock()
	subjects := make([]string, 0, len(h.subscriptions))
	for subject := range h.subscriptions {
		subjects = append(subjects, subject)
	}
	h.mu.RUnlock()

	for _, subject := range subjects {
		if err := h.sendSubscribeMessage(subject); err != nil {
			return err
		}
	}
	return nil
}

// sendSubscribeMessage sends a subscribe message to the server
func (h *HTTPBackend) sendSubscribeMessage(subject string) error {
	if h.conn == nil {
		return fmt.Errorf("WebSocket not connected")
	}

	message := map[string]interface{}{
		"type":    "subscribe",
		"subject": subject,
	}

	if err := h.conn.WriteJSON(message); err != nil {
		return fmt.Errorf("failed to send subscribe message: %w", err)
	}

	h.logger.Debug("Sent subscribe message", "subject", subject)
	return nil
}

// scheduleReconnect schedules a reconnection attempt
func (h *HTTPBackend) scheduleReconnect() {
	maxRetries := h.config.MaxRetries
	if maxRetries <= 0 {
		maxRetries = -1 // Infinite retries
	}

	if !h.shouldReconnect || (maxRetries > 0 && h.currentRetryCount >= maxRetries) {
		h.logger.Warn("Max reconnection attempts reached or reconnect disabled")
		return
	}

	h.currentRetryCount++
	timeout := time.Duration(h.config.ReconnectTimeout) * time.Millisecond
	if timeout <= 0 {
		timeout = 5 * time.Second
	}

	h.reconnectTimer = time.AfterFunc(timeout, func() {
		maxRetriesStr := "∞"
		if maxRetries > 0 {
			maxRetriesStr = fmt.Sprintf("%d", maxRetries)
		}

		h.logger.Info("Attempting to reconnect", "attempt", h.currentRetryCount, "max", maxRetriesStr)
		if err := h.Connect(); err != nil {
			h.logger.Error("Reconnection attempt failed: %v", err)
		}
	})
}

// Publish sends a message to a subject
func (h *HTTPBackend) Publish(subject string, data []byte) error {
	h.mu.RLock()
	conn := h.conn
	h.mu.RUnlock()

	if conn == nil {
		if err := h.Connect(); err != nil {
			return err
		}
		h.mu.RLock()
		conn = h.conn
		h.mu.RUnlock()
	}

	if conn == nil {
		return fmt.Errorf("HTTP message bus connection not available")
	}

	// Convert []byte to []int for JSON serialization
	dataArray := make([]int, len(data))
	for i, b := range data {
		dataArray[i] = int(b)
	}

	message := map[string]interface{}{
		"type":    "publish",
		"subject": subject,
		"data":    dataArray,
	}

	if err := conn.WriteJSON(message); err != nil {
		return fmt.Errorf("failed to publish message: %w", err)
	}

	h.logger.Debug("Published message", "subject", subject, "size", len(data))
	return nil
}

// Subscribe subscribes to a subject with a handler
func (h *HTTPBackend) Subscribe(subject string, handler Handler, opts *SubscribeOptions) (Subscription, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	// Initialize subject map if it doesn't exist
	if h.subscriptions[subject] == nil {
		h.subscriptions[subject] = make(map[int]Handler)

		// Send subscribe message to server if connected
		if h.conn != nil {
			if err := h.sendSubscribeMessage(subject); err != nil {
				return nil, err
			}
		} else {
			// Connect first
			if err := h.Connect(); err != nil {
				return nil, err
			}
			if err := h.sendSubscribeMessage(subject); err != nil {
				return nil, err
			}
		}
	}

	h.subscriptionCounter++
	subscriptionID := h.subscriptionCounter
	h.subscriptions[subject][subscriptionID] = handler

	h.logger.Debug("Subscribed to subject", "subject", subject, "id", subscriptionID)

	return &HTTPSubscription{
		id:      subscriptionID,
		subject: subject,
		handler: handler,
		backend: h,
		logger:  h.logger,
	}, nil
}

// unsubscribeHandler removes a specific handler from a subject
func (h *HTTPBackend) unsubscribeHandler(subject string, subscriptionID int) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	handlers := h.subscriptions[subject]
	if handlers == nil {
		return nil
	}

	delete(handlers, subscriptionID)

	// If no more handlers for this subject, unsubscribe from server
	if len(handlers) == 0 {
		delete(h.subscriptions, subject)

		if h.conn != nil {
			message := map[string]interface{}{
				"type":    "unsubscribe",
				"subject": subject,
			}
			if err := h.conn.WriteJSON(message); err != nil {
				h.logger.Error("Failed to send unsubscribe message: %v", err)
				return err
			}
			h.logger.Debug("Sent unsubscribe message", "subject", subject)
		}
	}

	return nil
}

// Close closes the HTTP backend and all connections
func (h *HTTPBackend) Close() error {
	h.shouldReconnect = false

	if h.reconnectTimer != nil {
		h.reconnectTimer.Stop()
		h.reconnectTimer = nil
	}

	h.cancel() // Cancel context to stop goroutines

	h.mu.Lock()
	if h.conn != nil {
		h.conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "Client closing"))
		h.conn.Close()
		h.conn = nil
	}
	h.subscriptions = make(map[string]map[int]Handler)
	h.mu.Unlock()

	h.wg.Wait() // Wait for goroutines to finish

	h.logger.Info("HTTP message bus connection closed")
	return nil
}

// AsNATS returns the underlying NATS connection (always nil for HTTP backend)
func (h *HTTPBackend) AsNATS() interface{} {
	return nil
}

// Unsubscribe removes the subscription
func (s *HTTPSubscription) Unsubscribe() error {
	err := s.backend.unsubscribeHandler(s.subject, s.id)
	if err == nil {
		s.logger.Debug("Unsubscribed from subject", "subject", s.subject, "id", s.id)
	}
	return err
}

// Drain gracefully drains the subscription (equivalent to unsubscribe for HTTP backend)
func (s *HTTPSubscription) Drain() error {
	return s.Unsubscribe()
}
