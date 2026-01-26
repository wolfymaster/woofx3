package cloudevents

type Subject string

const (
	SubjectWorkflowChange Subject = "workflow.change"
	SubjectWorkflowAdd    Subject = "workflow.change.add"
	SubjectWorkflowUpdate Subject = "workflow.change.update"
	SubjectWorkflowDelete Subject = "workflow.change.delete"
)
