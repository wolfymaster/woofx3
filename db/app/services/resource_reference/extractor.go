// Package resource_reference produces resource_references edges from
// higher-level definitions (workflows, commands). Each extractor reads the
// definition and returns a list of edges that should be persisted for that
// source. Callers are responsible for writing the edges via the repository.
package resource_reference

import (
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
)

// Supported target resource types for edge extraction.
const (
	TargetTypeAction   = "action"
	TargetTypeTrigger  = "trigger"
	TargetTypeFunction = "function"
	TargetTypeCommand  = "command"
	TargetTypeWorkflow = "workflow"
)

// WorkflowStepJSON is a minimal shape used to decode persisted workflow steps.
// We do not try to re-use the proto type because the DB stores the raw JSONB.
type WorkflowStepJSON struct {
	ID         string            `json:"id"`
	Name       string            `json:"name"`
	Type       string            `json:"type"`
	Parameters map[string]string `json:"parameters"`
}

// WorkflowTriggerJSON is the minimal shape used to decode the trigger JSONB.
type WorkflowTriggerJSON struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// WorkflowSource captures the identity of the workflow that owns the edges.
type WorkflowSource struct {
	ID                  uuid.UUID
	Name                string
	ApplicationID       *uuid.UUID
	SourceCreatedByType string
	SourceCreatedByRef  string
}

// ExtractWorkflowEdges parses the workflow's trigger and steps JSONB and
// returns edges for each referenced resource. Unknown step types and rows
// without a resolvable target name are skipped silently.
func ExtractWorkflowEdges(
	src WorkflowSource,
	stepsJSON string,
	triggerJSON string,
) []models.ResourceReference {
	edges := make([]models.ResourceReference, 0)

	if triggerJSON != "" && triggerJSON != "{}" {
		var trig WorkflowTriggerJSON
		if err := json.Unmarshal([]byte(triggerJSON), &trig); err == nil {
			if trig.Name != "" {
				edges = append(edges, newEdge(src, TargetTypeTrigger, trig.Name, "trigger"))
			}
		}
	}

	if stepsJSON != "" && stepsJSON != "[]" {
		var steps []WorkflowStepJSON
		if err := json.Unmarshal([]byte(stepsJSON), &steps); err == nil {
			for i, step := range steps {
				target, name, ok := resolveStepTarget(step)
				if !ok {
					continue
				}
				edges = append(edges, newEdge(src, target, name, fmt.Sprintf("step[%d]", i)))
			}
		}
	}

	return edges
}

// resolveStepTarget maps a workflow step to (target_type, target_name) if the
// step type is one of our known resource kinds. The target name is looked up
// in parameters using conventional keys.
func resolveStepTarget(step WorkflowStepJSON) (string, string, bool) {
	targetType := ""
	switch step.Type {
	case "action":
		targetType = TargetTypeAction
	case "function":
		targetType = TargetTypeFunction
	case "command":
		targetType = TargetTypeCommand
	case "workflow":
		targetType = TargetTypeWorkflow
	default:
		return "", "", false
	}

	candidates := []string{"name", step.Type, "target", targetType + "_name"}
	for _, k := range candidates {
		if v, ok := step.Parameters[k]; ok && v != "" {
			return targetType, v, true
		}
	}
	return "", "", false
}

// CommandSource captures the identity of the command that owns the edges.
type CommandSource struct {
	ID                  uuid.UUID
	Name                string
	ApplicationID       *uuid.UUID
	SourceCreatedByType string
	SourceCreatedByRef  string
}

// ExtractCommandEdges yields at most one edge per command: if the command's
// type is a known resource kind and its type_value names a target, we record
// a single reference to that target.
func ExtractCommandEdges(
	src CommandSource,
	cmdType string,
	typeValue string,
) []models.ResourceReference {
	if typeValue == "" {
		return nil
	}
	var targetType string
	switch cmdType {
	case "action":
		targetType = TargetTypeAction
	case "function":
		targetType = TargetTypeFunction
	case "workflow":
		targetType = TargetTypeWorkflow
	default:
		return nil
	}
	return []models.ResourceReference{
		newEdgeFromCommand(src, targetType, typeValue, "type_value"),
	}
}

func newEdge(src WorkflowSource, targetType, targetName, context string) models.ResourceReference {
	return models.ResourceReference{
		ID:                  uuid.New(),
		ApplicationID:       src.ApplicationID,
		SourceType:          "workflow",
		SourceID:            src.ID,
		SourceName:          src.Name,
		SourceCreatedByType: defaultString(src.SourceCreatedByType, "USER"),
		SourceCreatedByRef:  src.SourceCreatedByRef,
		TargetType:          targetType,
		TargetName:          targetName,
		Context:             context,
	}
}

func newEdgeFromCommand(src CommandSource, targetType, targetName, context string) models.ResourceReference {
	return models.ResourceReference{
		ID:                  uuid.New(),
		ApplicationID:       src.ApplicationID,
		SourceType:          "command",
		SourceID:            src.ID,
		SourceName:          src.Name,
		SourceCreatedByType: defaultString(src.SourceCreatedByType, "USER"),
		SourceCreatedByRef:  src.SourceCreatedByRef,
		TargetType:          targetType,
		TargetName:          targetName,
		Context:             context,
	}
}

func defaultString(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}
