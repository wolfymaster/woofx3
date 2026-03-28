package cloudevents

import ce "github.com/cloudevents/sdk-go/v2"

var ApplicationEvent = struct {
	HeartbeatEvent         func(string, bool) (*ce.Event, error)
	MessageBusInitRequest  func(string, []string) (*MessageBusRequest, error)
	MessageBusInitResponse func(string, string, []string) (*MessageBusResponse, error)
}{
	HeartbeatEvent: func(appName string, ready bool) (*ce.Event, error) {
		return NewHeartbeatEvent(appName, ready)
	},
	MessageBusInitRequest: func(source string, subjects []string) (*MessageBusRequest, error) {
		return NewMessageBusRequest(source, subjects)
	},
	MessageBusInitResponse: func(requestID string, source string, subjects []string) (*MessageBusResponse, error) {
		return NewMessageBusResponse(requestID, source, subjects)
	},
}

var WorkflowEvent = struct {
	WorkflowChangeEvent func(string, string, string) (*WorkflowChangeEvent, error)
}{
	WorkflowChangeEvent: func(operation string, entityId string, source string) (*WorkflowChangeEvent, error) {
		return NewWorkflowChangeEvent(operation, entityId, source)
	},
}
