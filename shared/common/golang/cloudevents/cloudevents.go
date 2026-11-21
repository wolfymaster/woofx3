package cloudevents

var ApplicationEvent = struct {
	MessageBusInitRequest  func(string, []string) (*MessageBusRequest, error)
	MessageBusInitResponse func(string, string, []string) (*MessageBusResponse, error)
}{
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
	WorkflowChangeEvent: func(operation, workflowID, source string) (*WorkflowChangeEvent, error) {
		return NewWorkflowChangeEvent(operation, workflowID, source)
	},
}
