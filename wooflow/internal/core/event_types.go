package core

import (
	"encoding/json"
	"fmt"
	"time"
)

// EventType represents the type of event
type EventType string

const (
	EventTypeBits         EventType = "bits"
	EventTypeSubscription EventType = "subscription"
)

// EventPayload represents the common fields for all events
type EventPayload struct {
	Type      EventType      `json:"type"`
	Username  string         `json:"username"`
	Timestamp time.Time      `json:"timestamp"`
	Metadata  map[string]any `json:"metadata,omitempty"`
}

// BitsEvent represents a bits donation event
type BitsEvent struct {
	EventPayload
	Amount int `json:"amount"`
}

// SubscriptionEvent represents a subscription event
type SubscriptionEvent struct {
	EventPayload
	Tier int `json:"tier"`
}

// ValidateEvent validates the event payload
func ValidateEvent(payload []byte) (EventPayload, error) {
	var base EventPayload
	if err := json.Unmarshal(payload, &base); err != nil {
		return EventPayload{}, fmt.Errorf("failed to unmarshal event: %w", err)
	}

	switch base.Type {
	case EventTypeBits:
		var event BitsEvent
		if err := json.Unmarshal(payload, &event); err != nil {
			return EventPayload{}, fmt.Errorf("invalid bits event: %w", err)
		}
		if event.Amount <= 0 {
			return EventPayload{}, fmt.Errorf("invalid bits amount: %d", event.Amount)
		}
		return event.EventPayload, nil

	case EventTypeSubscription:
		var event SubscriptionEvent
		if err := json.Unmarshal(payload, &event); err != nil {
			return EventPayload{}, fmt.Errorf("invalid subscription event: %w", err)
		}
		if event.Tier <= 0 {
			return EventPayload{}, fmt.Errorf("invalid subscription tier: %d", event.Tier)
		}
		return event.EventPayload, nil

	default:
		return EventPayload{}, fmt.Errorf("unknown event type: %s", base.Type)
	}
}
