package gladia

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/gorilla/websocket"
)

// Config holds the configuration for the Gladia client
type Config struct {
	APIKey     string
	SampleRate int    `json:"sample_rate"`
	BitDepth   int    `json:"bit_depth"`
	Channels   int    `json:"channels"`
	Encoding   string `json:"encoding"`
}

// Client represents a Gladia API client
type Client struct {
	config Config
}

// SessionResponse represents the response from initiating a real-time session
type SessionResponse struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

// WebSocketMessage represents a message received from the websocket
type WebSocketMessage struct {
	// Add specific message fields based on the API response structure
	Data json.RawMessage `json:"data"`
}

func (m WebSocketMessage) String() string {
	// First try to unmarshal into a map to check for utterance
	var data map[string]interface{}
	if err := json.Unmarshal(m.Data, &data); err != nil {
		return string(m.Data)
	}

	// Check if utterance exists and has text
	if utterance, ok := data["utterance"].(map[string]interface{}); ok {
		if text, ok := utterance["text"].(string); ok {
			return text
		}
	}

	// Fall back to pretty printing if no utterance.text found
	var prettyJSON bytes.Buffer
	if err := json.Indent(&prettyJSON, m.Data, "", "  "); err != nil {
		return string(m.Data)
	}
	return prettyJSON.String()
}

// NewClient creates a new Gladia client with the given configuration
func NewClient(config Config) *Client {
	return &Client{
		config: config,
	}
}

// InitiateSession starts a new real-time session
func (c *Client) InitiateSession() (*SessionResponse, error) {
	payload := map[string]interface{}{
		"encoding":                             c.config.Encoding,
		"sample_rate":                          c.config.SampleRate,
		"bit_depth":                            c.config.BitDepth,
		"channels":                             c.config.Channels,
		"maximum_duration_without_endpointing": 5,
		"messages_config": map[string]interface{}{
			"receive_pre_processing_events":  false,
			"receive_post_processing_events": false,
			"receive_acknowledgments":        false,
		},
		"pre_processing": map[string]interface{}{
			"speech_threshold": 0.2,
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("error marshaling request: %w", err)
	}

	req, err := http.NewRequest("POST", "https://api.gladia.io/v2/live", bytes.NewBuffer(body))
	if err != nil {
		return nil, fmt.Errorf("error creating request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Gladia-Key", c.config.APIKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("error making request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("error response (%d): %s", resp.StatusCode, string(bodyBytes))
	}

	var session SessionResponse
	if err := json.NewDecoder(resp.Body).Decode(&session); err != nil {
		return nil, fmt.Errorf("error decoding response: %w", err)
	}

	return &session, nil
}

// WSConnection represents a websocket connection to Gladia
type WSConnection struct {
	conn     *websocket.Conn
	msgChan  chan WebSocketMessage
	errChan  chan error
	stopChan chan struct{}
}

// ConnectWebSocket establishes a websocket connection and returns a WSConnection
func (c *Client) ConnectWebSocket(wsURL string, msgChan chan WebSocketMessage) (*WSConnection, error) {
	u, err := url.Parse(wsURL)
	if err != nil {
		return nil, fmt.Errorf("invalid websocket URL: %w", err)
	}

	conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("websocket dial error: %w", err)
	}

	ws := &WSConnection{
		conn:     conn,
		msgChan:  msgChan,
		errChan:  make(chan error),
		stopChan: make(chan struct{}),
	}

	// Start reading messages
	go ws.readPump()

	return ws, nil
}

// readPump reads messages from the websocket and sends them to the message channel
func (ws *WSConnection) readPump() {
	defer ws.conn.Close()

	for {
		select {
		case <-ws.stopChan:
			return
		default:
			var msg WebSocketMessage
			err := ws.conn.ReadJSON(&msg)
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					ws.errChan <- fmt.Errorf("websocket read error: %w", err)
				}
				return
			}
			ws.msgChan <- msg
		}
	}
}

// SendAudio sends an audio buffer over the websocket connection
func (ws *WSConnection) SendAudio(buffer []byte) error {
	err := ws.conn.WriteMessage(websocket.BinaryMessage, buffer)
	if err != nil {
		return fmt.Errorf("error sending audio: %w", err)
	}
	return nil
}

// Close closes the websocket connection
func (ws *WSConnection) Close() error {
	close_msg, _ := json.Marshal(map[string]interface{}{
		"type": "stop_recording",
	})
	ws.conn.WriteMessage(websocket.BinaryMessage, close_msg)
	close(ws.stopChan)
	return ws.conn.Close()
}

// Errors returns the error channel for the websocket connection
func (ws *WSConnection) Errors() <-chan error {
	return ws.errChan
}
