package barkloader

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type MessageHandler func(msg MessageResponse)
type ReconnectAttemptHandler func(attempt int, maxRetries int)

type MessageResponse struct {
	Args    map[string]interface{} `json:"args"`
	Command string                 `json:"command"`
	Error   string                 `json:"error"`
	Message string                 `json:"message"`
}

type InvokeResponse struct {
	Type string                 `json:"type"`
	Data map[string]interface{} `json:"data"`
}

type InvokeRequest struct {
	Type string     `json:"type"`
	Data InvokeData `json:"data"`
}

type InvokeData struct {
	Function string                 `json:"function"`
	Event    map[string]interface{} `json:"event"`
	// Legacy fields — still accepted by barkloader websocket for older callers.
	Func string        `json:"func,omitempty"`
	Args []interface{} `json:"args,omitempty"`
}

type Client struct {
	config             Config
	conn               *websocket.Conn
	onMessage          MessageHandler
	reconnectTimeout   time.Duration
	maxRetries         int
	onReconnectAttempt ReconnectAttemptHandler
	currentRetryCount  int
	reconnectTimer     *time.Timer
	isConnecting       bool
	shouldReconnect    bool
	isManualClose      bool
	mu                 sync.RWMutex
	pendingResponse    chan InvokeResponse
	pendingResponseMu  sync.Mutex
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
	}
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

func (c *Client) RegisterHandler(event string, handler MessageHandler) {
	switch event {
	case "onMessage":
		c.onMessage = handler
	}
}

// Invoke calls a module function on the barkloader server and waits for the
// response. `event` is the sandbox invocation context (trigger fields plus a
// `parameters` object for workflow action inputs — see counter/twitch modules).
func (c *Client) Invoke(functionName string, event map[string]interface{}) (map[string]interface{}, error) {
	c.mu.RLock()
	if !c.IsConnected() {
		c.mu.RUnlock()
		return nil, fmt.Errorf("websocket is not connected")
	}
	c.mu.RUnlock()

	// Set up response channel
	responseChan := make(chan InvokeResponse, 1)
	c.pendingResponseMu.Lock()
	if c.pendingResponse != nil {
		c.pendingResponseMu.Unlock()
		return nil, fmt.Errorf("another invoke is already pending")
	}
	c.pendingResponse = responseChan
	c.pendingResponseMu.Unlock()

	// Clean up channel when done
	defer func() {
		c.pendingResponseMu.Lock()
		c.pendingResponse = nil
		close(responseChan)
		c.pendingResponseMu.Unlock()
	}()

	// Create request
	request := InvokeRequest{
		Type: "invoke",
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

		// Prefer explicit invoke envelopes (`type` + `data`) over legacy MessageResponse.
		var response InvokeResponse
		if err := json.Unmarshal(message, &response); err == nil &&
			(response.Type == "result" || response.Type == "error") {
			c.pendingResponseMu.Lock()
			if c.pendingResponse != nil {
				select {
				case c.pendingResponse <- response:
				default:
				}
			}
			c.pendingResponseMu.Unlock()
			continue
		}

		var msgResp MessageResponse
		if err := json.Unmarshal(message, &msgResp); err == nil &&
			(msgResp.Command != "" || msgResp.Error != "" || msgResp.Message != "" || msgResp.Args != nil) {
			if c.pendingResponse != nil {
				invokeResp := InvokeResponse{
					Type: "result",
					Data: make(map[string]interface{}),
				}
				if msgResp.Error != "" {
					invokeResp.Type = "error"
					invokeResp.Data["error"] = msgResp.Error
				} else {
					invokeResp.Data["result"] = msgResp.Args
				}
				c.pendingResponseMu.Lock()
				select {
				case c.pendingResponse <- invokeResp:
				default:
				}
				c.pendingResponseMu.Unlock()
			}
			if c.onMessage != nil {
				c.onMessage(msgResp)
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
