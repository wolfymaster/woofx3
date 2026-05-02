// Package resource_reference produces resource_references edges from
// higher-level definitions (workflows, commands). Each extractor reads the
// definition and returns a list of edges that should be persisted for that
// source. Callers are responsible for writing the edges via the repository.
//
// Edges are keyed by **canonical id** strings (`{moduleId}:{kind}:{resourceId}`,
// see `docs/barkloader/modules.md`). For workflows the canonical references
// live in the persisted JSON under `$ref` keys (trigger and per-step) and
// the `call` key (function the step invokes); the engine's execution
// fields (`eventType`, `parameters`) are not consulted by this extractor.
package resource_reference

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
)

// Supported target resource types for edge extraction. Mirrors the
// reserved kind keywords in barkloader's canonical id format.
const (
	TargetTypeAction   = "action"
	TargetTypeTrigger  = "trigger"
	TargetTypeFunction = "function"
	TargetTypeCommand  = "command"
	TargetTypeWorkflow = "workflow"
	TargetTypeWidget   = "widget"
	TargetTypeOverlay  = "overlay"
)

// canonicalIDSeparator must stay in sync with barkloader's
// `CANONICAL_ID_SEPARATOR` (see `barkloader/app/src/services/module_service/canonical_id.rs`).
const canonicalIDSeparator = ":"

// WorkflowStepJSON is the minimal shape this extractor reads from a
// persisted workflow step. Engine-side fields (parameters, etc.) are
// intentionally absent — the extractor only cares about reference
// metadata.
//
// `Function` is the top-level handler-config field for action steps
// whose `action: "function"` — it carries the canonical function id
// the step invokes. The extractor records this as a function
// dependency so deletion safety knows the workflow needs that
// function to run.
type WorkflowStepJSON struct {
	ID       string `json:"id"`
	Ref      string `json:"$ref"`
	Function string `json:"function"`
}

// WorkflowTriggerJSON is the minimal shape this extractor reads from a
// persisted workflow trigger. The `eventType` field (NATS subject the
// engine subscribes to) is execution data and not used here.
type WorkflowTriggerJSON struct {
	Ref string `json:"$ref"`
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
// returns edges for each `$ref` (and per-step `call`) it finds. Workflows
// whose JSON does not carry `$ref` values produce no edges — this is the
// expected state for workflows authored before the `$ref` convention or
// for workflows that intentionally do not bind to a specific declaration.
func ExtractWorkflowEdges(
	src WorkflowSource,
	stepsJSON string,
	triggerJSON string,
) []models.ResourceReference {
	edges := make([]models.ResourceReference, 0)

	if triggerJSON != "" && triggerJSON != "{}" {
		var trig WorkflowTriggerJSON
		if err := json.Unmarshal([]byte(triggerJSON), &trig); err == nil {
			if trig.Ref != "" {
				edges = append(edges, newEdge(src, TargetTypeTrigger, trig.Ref, "trigger"))
			}
		}
	}

	if stepsJSON != "" && stepsJSON != "[]" {
		var steps []WorkflowStepJSON
		if err := json.Unmarshal([]byte(stepsJSON), &steps); err == nil {
			for i, step := range steps {
				if step.Ref != "" {
					if kind, ok := kindFromCanonicalID(step.Ref); ok {
						edges = append(edges, newEdge(src, kind, step.Ref, fmt.Sprintf("step[%d]", i)))
					}
				}
				if step.Function != "" {
					// Top-level `function` field on action steps whose
					// `action: "function"` — the canonical function id
					// the step invokes. Recorded as a function
					// dependency for the deletion safety check.
					edges = append(edges, newEdge(src, TargetTypeFunction, step.Function, fmt.Sprintf("step[%d].function", i)))
				}
			}
		}
	}

	return edges
}

// kindFromCanonicalID parses the kind segment from a canonical id of the
// form `{moduleId}:{kind}:{resourceId}`. Returns (kind, true) when the id
// has exactly three non-empty segments and the middle segment is a
// recognized kind keyword; (_, false) otherwise. Defensive — malformed
// `$ref` values silently skip rather than crashing the extractor.
func kindFromCanonicalID(s string) (string, bool) {
	parts := strings.Split(s, canonicalIDSeparator)
	if len(parts) != 3 {
		return "", false
	}
	if parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return "", false
	}
	switch parts[1] {
	case TargetTypeAction, TargetTypeTrigger, TargetTypeFunction,
		TargetTypeCommand, TargetTypeWorkflow, TargetTypeWidget, TargetTypeOverlay:
		return parts[1], true
	default:
		return "", false
	}
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
