package alertworkflows

import (
	"encoding/json"
	"fmt"
	"strings"
)

// workflowEdge is one resource_references row a split workflow gets, as the
// workflow service wrote them when this migration was written.
//
// A snapshot rather than a call into the db service's extractor, which is free
// to change with the live schema: a migration has to write the rows its own
// point in the schema history had, so an engine upgrading through it later
// gets the same result as one that ran it on release. It also keeps the
// migrations from depending on the service layer.
type workflowEdge struct {
	TargetType string
	TargetName string
	Context    string
}

// edgeKinds are the canonical id kinds a step's `$ref` may name; must match
// the kinds the workflow service recognised (db/app/services/resource_reference)
// when this migration was written.
var edgeKinds = map[string]bool{
	"action": true, "trigger": true, "function": true, "command": true,
	"workflow": true, "widget": true, "overlay": true, "theme": true,
}

// workflowEdges is what a workflow's stored trigger and steps reference: the
// trigger's `$ref`, each step's `$ref` that is a canonical id of a known kind,
// and the module function each `function` step invokes. JSON that does not
// parse yields no edges, as the workflow service treats it.
func workflowEdges(stepsJSON, triggerJSON string) []workflowEdge {
	var edges []workflowEdge

	var trigger struct {
		Ref string `json:"$ref"`
	}
	if json.Unmarshal([]byte(triggerJSON), &trigger) == nil && trigger.Ref != "" {
		edges = append(edges, workflowEdge{TargetType: "trigger", TargetName: trigger.Ref, Context: "trigger"})
	}

	var steps []struct {
		Ref      string `json:"$ref"`
		Function string `json:"function"`
	}
	if json.Unmarshal([]byte(stepsJSON), &steps) != nil {
		return edges
	}
	for i, step := range steps {
		if kind, ok := canonicalKind(step.Ref); ok {
			edges = append(edges, workflowEdge{TargetType: kind, TargetName: step.Ref, Context: fmt.Sprintf("step[%d]", i)})
		}
		if step.Function != "" {
			edges = append(edges, workflowEdge{TargetType: "function", TargetName: step.Function, Context: fmt.Sprintf("step[%d].function", i)})
		}
	}
	return edges
}

// canonicalKind is the kind segment of a `{moduleId}:{kind}:{resourceId}` id.
func canonicalKind(id string) (string, bool) {
	parts := strings.Split(id, ":")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return "", false
	}
	return parts[1], edgeKinds[parts[1]]
}
