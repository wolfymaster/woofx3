package cloudevents

import (
	"fmt"
	"time"

	ce "github.com/cloudevents/sdk-go/v2"
)

const (
	InitSubject = "MESSAGEBUS_INIT"
	RequestType = "woofx3.messagebus.init"
)

// MessageBusRequest is a wrapper around ce.Event for messagebus request events
type MessageBusRequest struct {
	ce.Event
}

// MessageBusResponse is a wrapper around ce.Event for messagebus response events
type MessageBusResponse struct {
	ce.Event
}

// SubjectPatternRequest represents the request data for subject pattern requests
type SubjectPatternRequest struct {
	Subjects []string `json:"subjects"`
}

// SubjectPatternResponse represents the response data with subject patterns
type SubjectPatternResponse struct {
	Subjects []string `json:"subjects"`
}

// Encode encodes the messagebus request event to JSON bytes
func (r *MessageBusRequest) Encode() ([]byte, error) {
	return Encode(r)
}

// Decode decodes JSON data into the messagebus request event
func (r *MessageBusRequest) Decode(data []byte) error {
	return Decode(data, r)
}

// Data extracts SubjectPatternRequest from the messagebus request event
func (r *MessageBusRequest) Data() (*SubjectPatternRequest, error) {
	var requestData SubjectPatternRequest
	if err := r.DataAs(&requestData); err != nil {
		return nil, fmt.Errorf("failed to parse request data: %w", err)
	}
	return &requestData, nil
}

// Encode encodes the messagebus response event to JSON bytes
func (r *MessageBusResponse) Encode() ([]byte, error) {
	return Encode(r)
}

// Decode decodes JSON data into the messagebus response event
func (r *MessageBusResponse) Decode(data []byte) error {
	return Decode(data, r)
}

// Data extracts SubjectPatternResponse from the messagebus response event
func (r *MessageBusResponse) Data() (*SubjectPatternResponse, error) {
	var responseData SubjectPatternResponse
	if err := r.DataAs(&responseData); err != nil {
		return nil, fmt.Errorf("failed to parse response data: %w", err)
	}
	return &responseData, nil
}

// NewMessageBusRequest creates a new messagebus request event
func NewMessageBusRequest(source string, subjects []string) (*MessageBusRequest, error) {
	evt := ce.NewEvent()
	evt.SetSource(source)
	evt.SetType(RequestType)
	evt.SetTime(time.Now())

	data := SubjectPatternRequest{
		Subjects: subjects,
	}

	if err := evt.SetData(ce.ApplicationJSON, data); err != nil {
		return nil, fmt.Errorf("failed to set request data: %w", err)
	}

	return &MessageBusRequest{Event: evt}, nil
}

// NewMessageBusResponse creates a new messagebus response event
func NewMessageBusResponse(requestID, source string, subjects []string) (*MessageBusResponse, error) {
	evt := ce.NewEvent()
	evt.SetID(requestID)
	evt.SetSource(source)
	evt.SetType(RequestType)
	evt.SetTime(time.Now())

	data := SubjectPatternResponse{
		Subjects: subjects,
	}

	if err := evt.SetData(ce.ApplicationJSON, data); err != nil {
		return nil, fmt.Errorf("failed to set response data: %w", err)
	}

	return &MessageBusResponse{Event: evt}, nil
}
