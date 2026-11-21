package monitor

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/wolfymaster/woofx3/common/messages/heartbeat"
)

// encodeHeartbeat builds the message a service publishes on the heartbeat
// subject. It refuses to return a message that does not fit the contract.
func encodeHeartbeat(appName string, ready bool, now time.Time) ([]byte, error) {
	event := heartbeat.HeartbeatEvent{
		Specversion: heartbeat.EventSpecVersion10,
		ID:          heartbeat.EventId(uuid.NewString()),
		Type:        heartbeat.HeartbeatEventTypeComWoofx3Heartbeat,
		Source:      heartbeat.EventSource(appName),
		Subject:     heartbeat.HeartbeatEventSubjectHEARTBEAT,
		Time:        heartbeat.EventTime(now.UTC().Format(time.RFC3339Nano)),
		Data: heartbeat.HeartbeatData{
			Application: heartbeat.EntityId(appName),
			Ready:       ready,
		},
	}
	if err := event.Validate(); err != nil {
		return nil, fmt.Errorf("heartbeat for %q does not fit its contract: %w", appName, err)
	}
	return json.Marshal(event)
}

// decodeHeartbeat reads a message from the heartbeat subject. Anything that
// does not fit the contract is an error, never a heartbeat of some other shape.
func decodeHeartbeat(payload []byte) (heartbeat.HeartbeatData, error) {
	var event heartbeat.HeartbeatEvent
	if err := event.UnmarshalJSON(payload); err != nil {
		return heartbeat.HeartbeatData{}, fmt.Errorf("decoding heartbeat: %w", err)
	}
	if err := event.Validate(); err != nil {
		return heartbeat.HeartbeatData{}, fmt.Errorf("validating heartbeat: %w", err)
	}
	return event.Data, nil
}
