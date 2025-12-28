package cloudevents

import (
	"time"

	"github.com/google/uuid"
)

type BaseEvent[T any] struct {
	SpecVersion string    `json:"specversion"`
	Type        string    `json:"type"`
	Source      string    `json:"source"`
	ID          string    `json:"id"`
	Subject     string    `json:"subject,omitempty"`
	Time        time.Time `json:"time"`
	Data        T         `json:"data"`
}

func NewEvent[T any](eventType, source string, data T) *BaseEvent[T] {
	return &BaseEvent[T]{
		SpecVersion: "1.0",
		Type:        eventType,
		Source:      source,
		ID:          uuid.New().String(),
		Time:        time.Now().UTC(),
		Data:        data,
	}
}

func NewEventWithSubject[T any](eventType, source, subject string, data T) *BaseEvent[T] {
	return &BaseEvent[T]{
		SpecVersion: "1.0",
		Type:        eventType,
		Source:      source,
		ID:          uuid.New().String(),
		Subject:     subject,
		Time:        time.Now().UTC(),
		Data:        data,
	}
}
