package barkloader

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type ReconnectAttemptHandler func(attempt int, maxRetries int)

type InvokeResponse struct {
	Type string                 `json:"type"`
	Id   string                 `json:"id,omitempty"`
	Data map[string]interface{} `json:"data"`
}

type InvokeRequest struct {
	Type string     `json:"type"`
	Id   string     `json:"id"`
	Data InvokeData `json:"data"`
}

type InvokeData struct {
	Function string                 `json:"function"`
	Event    map[string]interface{} `json:"event"`
}

type Client struct {
	config             Config
	conn               *websocket.Conn
	reconnectTimeout   time.Duration
	maxRetries         int
	onReconnectAttempt ReconnectAttemptHandler
	currentRetryCount  int
	reconnectTimer     *time.Timer
	isConnecting       bool
	shouldReconnect    bool
	isManualClose      bool
	mu                 sync.RWMutex
	pendingInvokes     map[string]chan InvokeResponse
	pendingInvokesMu   sync.Mutex
}

func New(config Config) *Client {
	reconnectTimeout := config.ReconnectTimeout
	if reconnectTimeout == 0 {
		reconnectTimeout = 5 * time.Second
	}

	return &Client{
		config:             config,
		reconnectTimeout:   reconnectTimeout,
		maxRetries:         config.MaxRetries,
		onReconnectAttempt: config.OnReconnectAttempt,
		shouldReconnect:    true,
		pendingInvokes:     make(map[string]chan InvokeResponse),
	}
}

// newInvokeID generates a correlation id for a single invoke request. It is
// echoed back verbatim by barkloader on the matching result/error response
// so concurrent invokes on the same websocket connection can be matched to
// the caller awaiting them.
func newInvokeID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func (c *Client) Connect() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.isConnecting || (c.conn != nil) {
		return nil
	}

	c.isConnecting = true
	c.isManualClose = false
	c.shouldReconnect = true

	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	var headers http.Header
	if c.config.Token != "" {
		headers = http.Header{}
		headers.Set("Authorization", "Bearer "+c.config.Token)
	}

	conn, _, err := dialer.Dial(c.config.WSURL, headers)
	if err != nil {
		c.isConnecting = false
		c.handleConnectionFailure()
		return fmt.Errorf("failed to connect: %w", err)
	}

	c.conn = conn
	c.currentRetryCount = 0
	c.clearReconnectTimer()

	// Start message handler goroutine
	go c.messageHandler()

	if c.config.OnOpen != nil {
		c.config.OnOpen()
	}

	c.isConnecting = false
	return nil
}

func (c *Client) Disconnect() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.isManualClose = true
	c.shouldReconnect = false
	c.clearReconnectTimer()

	if c.conn != nil {
		c.conn.Close()
		c.conn = nil
	}

	c.currentRetryCount = 0
	c.isConnecting = false
}

func (c *Client) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.conn != nil
}

func (c *Client) Send(data string) error {
	c.mu.RLock()
	conn := c.conn
	c.mu.RUnlock()

	if conn == nil {
		return fmt.Errorf("websocket is not connected")
	}

	return conn.WriteMessage(websocket.TextMessage, []byte(data))
}

// Invoke calls a module function on the barkloader server and waits for the
// response. `event` is the sandbox invocation context (trigger fields plus a
// `parameters` object for workflow action inputs — see counter/twitch modules).
//
// Multiple invokes may be in flight concurrently on the same connection:
// each request carries a unique id that barkloader echoes back on its
// result/error response, so callers are matched by id rather than by call
// order.
func (c *Client) Invoke(functionName string, event map[string]interface{}) (map[string]interface{}, error) {
	c.mu.RLock()
	if !c.IsConnected() {
		c.mu.RUnlock()
		return nil, fmt.Errorf("websocket is not connected")
	}
	c.mu.RUnlock()

	id, err := newInvokeID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate invoke id: %w", err)
	}

	// Register the response channel under this invoke's id
	responseChan := make(chan InvokeResponse, 1)
	c.pendingInvokesMu.Lock()
	c.pendingInvokes[id] = responseChan
	c.pendingInvokesMu.Unlock()

	// Clean up the pending entry when done
	defer func() {
		c.pendingInvokesMu.Lock()
		delete(c.pendingInvokes, id)
		c.pendingInvokesMu.Unlock()
	}()

	// Create request
	request := InvokeRequest{
		Type: "invoke",
		Id:   id,
		Data: InvokeData{
			Function: functionName,
			Event:    event,
		},
	}

	requestJSON, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	// Send request
	if err := c.Send(string(requestJSON)); err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}

	// Wait for response with timeout
	timeout := time.After(30 * time.Second)
	select {
	case response := <-responseChan:
		if response.Type == "error" {
			errorMsg := "unknown error"
			if errStr, ok := response.Data["error"].(string); ok {
				errorMsg = errStr
			} else if dataStr, ok := response.Data["data"].(string); ok {
				errorMsg = dataStr
			}
			return nil, fmt.Errorf("barkloader error: %s", errorMsg)
		}

		if response.Type == "result" {
			resultData, hasResult := response.Data["result"]
			if !hasResult || resultData == nil {
				return nil, fmt.Errorf(
					"barkloader returned no result for %s (data=%v)",
					functionName,
					response.Data,
				)
			}
			if resultMap, ok := resultData.(map[string]interface{}); ok {
				if len(resultMap) == 0 {
					return nil, fmt.Errorf(
						"barkloader returned empty result object for %s (data=%v)",
						functionName,
						response.Data,
					)
				}
				return resultMap, nil
			}
			// Scalar / array return — wrap for workflow consumers
			return map[string]interface{}{"value": resultData}, nil
		}

		return nil, fmt.Errorf("unexpected response type: %s", response.Type)
	case <-timeout:
		return nil, fmt.Errorf("invoke timeout")
	}
}

func (c *Client) messageHandler() {
	for {
		c.mu.RLock()
		conn := c.conn
		c.mu.RUnlock()

		if conn == nil {
			return
		}

		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				c.handleConnectionFailure()
			}
			return
		}

		var response InvokeResponse
		if err := json.Unmarshal(message, &response); err != nil ||
			(response.Type != "result" && response.Type != "error") {
			continue
		}

		c.pendingInvokesMu.Lock()
		responseChan, ok := c.pendingInvokes[response.Id]
		c.pendingInvokesMu.Unlock()
		if ok {
			select {
			case responseChan <- response:
			default:
			}
		}
	}
}

func (c *Client) handleConnectionFailure() {
	if !c.shouldReconnect || c.isManualClose {
		return
	}

	if c.maxRetries > 0 && c.currentRetryCount >= c.maxRetries {
		return
	}

	c.currentRetryCount++

	if c.onReconnectAttempt != nil {
		maxRetries := c.maxRetries
		if maxRetries == 0 {
			maxRetries = -1 // represent infinity
		}
		c.onReconnectAttempt(c.currentRetryCount, maxRetries)
	}

	c.reconnectTimer = time.AfterFunc(c.reconnectTimeout, func() {
		c.Connect()
	})
}

func (c *Client) clearReconnectTimer() {
	if c.reconnectTimer != nil {
		c.reconnectTimer.Stop()
		c.reconnectTimer = nil
	}
}

func (c *Client) Destroy() {
	c.Disconnect()
	c.clearReconnectTimer()
	c.shouldReconnect = false
}
