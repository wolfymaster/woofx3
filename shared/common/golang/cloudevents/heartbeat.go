package cloudevents

import (
	"time"

	ce "github.com/cloudevents/sdk-go/v2"
)

const (
	HeartbeatType    = "com.woofx3.heartbeat"
	HeartbeatSubject = "HEARTBEAT"
)

type Heartbeat struct {
	ce.Event
}

type HeartbeatData struct {
	Application string `json:"application"`
	Ready       bool   `json:"ready"`
}

func (h *Heartbeat) Encode() ([]byte, error) {
	return Encode(h)
}

func (h *Heartbeat) Decode(data []byte) error {
	return Decode(data, h)
}

func (h *Heartbeat) Data() (*HeartbeatData, error) {
	var parsedHeartbeatData HeartbeatData
	if err := h.DataAs(&parsedHeartbeatData); err != nil {
		return nil, err
	}
	return &parsedHeartbeatData, nil
}

func NewHeartbeatEvent(appName string, ready bool) (*ce.Event, error) {
	evt := ce.NewEvent()
	evt.SetType(HeartbeatType)
	evt.SetSource(appName)
	evt.SetSubject(HeartbeatSubject)
	evt.SetTime(time.Now())

	data := HeartbeatData{
		Application: appName,
		Ready:       ready,
	}

	if err := evt.SetData(ce.ApplicationJSON, data); err != nil {
		return nil, err
	}

	return &evt, nil
}
