package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	refsvc "github.com/wolfymaster/woofx3/db/app/services/resource_reference"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

// commandTriggerType is the trigger type of the workflow a command runs. No
// trigger registrar subscribes it to anything: the commander starts the
// workflow by id once the command has matched and passed its checks. That is
// what keeps one chat message from running it twice, since every match also
// announces itself on chat.command.<slug> for other workflows to react to.
// Must match types.TriggerTypeCommand in workflow/internal/types.
const commandTriggerType = "command"

// errLinkedWorkflowMissing is a command linking to a workflow row that does
// not exist. The postgres foreign key nulls the link when the row is
// deleted; SQLite has none, so this is a link left by a deletion there.
var errLinkedWorkflowMissing = errors.New("the workflow this command runs no longer exists")

// invalidArgument is a write refused for what the caller sent rather than for
// anything that went wrong in db-proxy. Carried as a plain error so the reason
// can also be stored as a command's workflow_error; twirpError turns it into
// an InvalidArgument at the RPC boundary.
type invalidArgument struct {
	argument string
	err      error
}

func (e *invalidArgument) Error() string { return e.err.Error() }

func (e *invalidArgument) Unwrap() error { return e.err }

// twirpError is err as an RPC returns it: a refused argument as
// InvalidArgument, and a twirp error as it is.
func twirpError(err error) error {
	var invalid *invalidArgument
	if errors.As(err, &invalid) {
		return twirp.InvalidArgumentError(invalid.argument, invalid.Error())
	}
	return err
}

// commandWorkflowChange is what writing a command's steps did to its
// workflow, for the caller to announce once the transaction commits.
type commandWorkflowChange struct {
	workflow  *models.WorkflowDefinition
	operation string
}

// commandSubjectSegment is a command name as the segment of its
// chat.command.<slug> subject: no leading "!", lowercased. Must match
// commandNameToSubjectSegment in shared/common/typescript/cloudevents/slug.ts.
func commandSubjectSegment(name string) (string, error) {
	stripped := strings.TrimPrefix(name, "!")
	if stripped == "" {
		return "", &invalidArgument{"command", fmt.Errorf("invalid command name: empty after stripping \"!\"")}
	}
	if strings.ContainsAny(stripped, ".*>") || strings.ContainsFunc(stripped, isSubjectSpace) {
		return "", &invalidArgument{"command", fmt.Errorf("invalid command name %q: a subject segment may not contain \".\" \"*\" \">\" or whitespace", name)}
	}
	return strings.ToLower(stripped), nil
}

func isSubjectSpace(r rune) bool {
	return r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '\f' || r == '\v'
}

// commandWorkflowTrigger is the trigger JSON of the workflow command `name`
// runs. `event` names the event the run starts from, so `${trigger.data...}`
// in its steps reads the same payload a workflow listening for the command
// reads.
func commandWorkflowTrigger(name string) (string, error) {
	segment, err := commandSubjectSegment(name)
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal(map[string]string{
		"type":  commandTriggerType,
		"event": "chat.command." + segment,
	})
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func commandWorkflowName(name string) string {
	return "!" + name
}

// chainActions turns a command's action list into the tasks of a workflow
// that runs them in order: each gets an id and the type "action" when it has
// none, and waits for the one before it unless it already says what it waits
// for. Mirrors sequentialTasks in workflow/internal/engine/actions_run.go,
// which is how the same list runs when no workflow holds it.
func chainActions(actionsJSON string) (string, error) {
	if strings.TrimSpace(actionsJSON) == "" {
		return "[]", nil
	}
	var actions []map[string]any
	if err := json.Unmarshal([]byte(actionsJSON), &actions); err != nil {
		return "", fmt.Errorf("actions are not a JSON array of objects: %w", err)
	}
	seen := make(map[string]bool, len(actions))
	previous := ""
	for i, action := range actions {
		if action == nil {
			return "", fmt.Errorf("action %d is null", i+1)
		}
		id, _ := action["id"].(string)
		if id == "" {
			id = fmt.Sprintf("action-%d", i+1)
			action["id"] = id
		}
		if seen[id] {
			return "", fmt.Errorf("two actions share the id %q", id)
		}
		seen[id] = true
		if taskType, _ := action["type"].(string); taskType == "" {
			action["type"] = "action"
		}
		if dependsOn, _ := action["dependsOn"].([]any); len(dependsOn) == 0 && previous != "" {
			action["dependsOn"] = []string{previous}
		}
		previous = id
	}
	raw, err := json.Marshal(actions)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// countSteps is how many tasks a workflow's steps JSON holds.
func countSteps(stepsJSON string) (int, error) {
	if strings.TrimSpace(stepsJSON) == "" {
		return 0, nil
	}
	var steps []map[string]any
	if err := json.Unmarshal([]byte(stepsJSON), &steps); err != nil {
		return 0, &invalidArgument{"steps_json", fmt.Errorf("steps are not a JSON array of objects: %w", err)}
	}
	for i, step := range steps {
		if step == nil {
			return 0, &invalidArgument{"steps_json", fmt.Errorf("step %d is null", i+1)}
		}
	}
	return len(steps), nil
}

// setCommandSteps makes the workflow linked to cmd hold stepsJSON, inside tx.
//
// A command with steps has a workflow and an empty action list; one without
// has neither, since a workflow must have at least one task. So steps create
// the workflow when cmd has none, and no steps delete it. The workflow is
// always enabled: whether the command runs is the command's own `enabled`.
//
// It is owned by USER whoever made the command, so that removing a module
// removes the workflow of the module's command along with the command
// (DeleteCommand) rather than through the module's own workflows.
//
// cmd's row must already exist, read inside tx: the link is written with a
// conditional UPDATE that fails with repo.ErrCommandLinkChanged when another
// writer changed it since. cmd is changed to match but not saved; the caller
// saves it in the same transaction.
func (s *commandService) setCommandSteps(tx *gorm.DB, cmd *models.Command, stepsJSON string) (*commandWorkflowChange, error) {
	count, err := countSteps(stepsJSON)
	if err != nil {
		return nil, err
	}

	existing, err := s.currentWorkflow(tx, cmd)
	if err != nil {
		return nil, err
	}
	commands := s.repo.WithDB(tx)
	cmd.WorkflowError = ""

	if count == 0 {
		cmd.Actions = "[]"
		if existing == nil {
			return nil, nil
		}
		if err := commands.UnlinkWorkflow(cmd.ID, existing.ID); err != nil {
			return nil, fmt.Errorf("unlink the workflow of command %q: %w", cmd.Command, err)
		}
		cmd.WorkflowID = nil
		if err := tx.Delete(existing).Error; err != nil {
			return nil, fmt.Errorf("delete the workflow of command %q: %w", cmd.Command, err)
		}
		return &commandWorkflowChange{workflow: existing, operation: "deleted"}, nil
	}

	trigger, err := commandWorkflowTrigger(cmd.Command)
	if err != nil {
		return nil, err
	}
	cmd.Actions = "[]"

	if existing != nil {
		existing.Name = commandWorkflowName(cmd.Command)
		existing.Steps = stepsJSON
		existing.Trigger = trigger
		existing.Enabled = true
		if err := tx.Save(existing).Error; err != nil {
			return nil, fmt.Errorf("update the workflow of command %q: %w", cmd.Command, err)
		}
		return &commandWorkflowChange{workflow: existing, operation: "updated"}, nil
	}

	wf := &models.WorkflowDefinition{
		ID:            uuid.New(),
		Name:          commandWorkflowName(cmd.Command),
		Steps:         stepsJSON,
		Trigger:       trigger,
		CreatedByType: "USER",
		Taxonomy:      "[]",
		Enabled:       true,
	}
	if err := tx.Create(wf).Error; err != nil {
		return nil, fmt.Errorf("create the workflow of command %q: %w", cmd.Command, err)
	}
	if err := commands.LinkWorkflow(cmd.ID, wf.ID); err != nil {
		return nil, fmt.Errorf("link command %q to its workflow: %w", cmd.Command, err)
	}
	cmd.WorkflowID = &wf.ID
	return &commandWorkflowChange{workflow: wf, operation: "created"}, nil
}

// renameCommandWorkflow points cmd's workflow at the command's current name,
// inside tx. Returns nil when cmd has no workflow.
func (s *commandService) renameCommandWorkflow(tx *gorm.DB, cmd *models.Command) (*commandWorkflowChange, error) {
	existing, err := s.currentWorkflow(tx, cmd)
	if err != nil || existing == nil {
		return nil, err
	}
	trigger, err := commandWorkflowTrigger(cmd.Command)
	if err != nil {
		return nil, err
	}
	existing.Name = commandWorkflowName(cmd.Command)
	existing.Trigger = trigger
	if err := tx.Save(existing).Error; err != nil {
		return nil, fmt.Errorf("rename the workflow of command %q: %w", cmd.Command, err)
	}
	return &commandWorkflowChange{workflow: existing, operation: "updated"}, nil
}

// currentWorkflow is the workflow cmd links to, read inside tx, or nil when it
// links to none. A link to a row that no longer exists is cleared, so that
// writing the command's steps gives it a workflow again instead of failing on
// the missing one forever.
func (s *commandService) currentWorkflow(tx *gorm.DB, cmd *models.Command) (*models.WorkflowDefinition, error) {
	wf, err := linkedWorkflow(tx, cmd)
	if !errors.Is(err, errLinkedWorkflowMissing) {
		return wf, err
	}
	s.logger.Warn("Command links to a workflow that no longer exists; clearing the link",
		"command", cmd.Command, "id", cmd.ID, "workflow_id", *cmd.WorkflowID)
	if err := s.repo.WithDB(tx).UnlinkWorkflow(cmd.ID, *cmd.WorkflowID); err != nil {
		return nil, fmt.Errorf("unlink the missing workflow of command %q: %w", cmd.Command, err)
	}
	cmd.WorkflowID = nil
	return nil, nil
}

// linkedWorkflow is the workflow cmd links to, or nil when it links to none.
// errLinkedWorkflowMissing when the row it links to does not exist.
func linkedWorkflow(tx *gorm.DB, cmd *models.Command) (*models.WorkflowDefinition, error) {
	if cmd.WorkflowID == nil {
		return nil, nil
	}
	var wf models.WorkflowDefinition
	err := tx.Where("id = ?", *cmd.WorkflowID).First(&wf).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("command %q, workflow %s: %w", cmd.Command, *cmd.WorkflowID, errLinkedWorkflowMissing)
	}
	if err != nil {
		return nil, fmt.Errorf("read the workflow of command %q: %w", cmd.Command, err)
	}
	return &wf, nil
}

// announceIn writes change's workflow lifecycle event to the outbox inside
// tx, so the engine registers the workflow and the UI hears of it exactly
// when the change commits.
func (c *commandWorkflowChange) announceIn(tx *gorm.DB, publisher *workers.EventPublisher) error {
	if c == nil || publisher == nil {
		return nil
	}
	data := buildWorkflowChangeData(c.workflow)
	if c.operation == "deleted" {
		data = map[string]any{"id": c.workflow.ID.String()}
	}
	return publisher.PublishIn(tx, workers.PublishOptions{
		EntityType:      "workflow",
		EntityID:        c.workflow.ID.String(),
		Operation:       c.operation,
		Data:            data,
		AutoAcknowledge: true,
	})
}

// syncEdges recomputes the resource_references edges of change's workflow.
// Best effort, like the workflow service's own: the edges are a secondary
// index, and the workflow has already been written.
func (c *commandWorkflowChange) syncEdges(refRepo *repo.ResourceReferenceRepository, logger *slog.Logger) {
	if c == nil || refRepo == nil {
		return
	}
	if c.operation == "deleted" {
		if err := refRepo.DeleteEdgesBySource("workflow", c.workflow.ID); err != nil {
			logger.Error("Delete the edges of a command's workflow", "workflow_id", c.workflow.ID, "error", err)
		}
		return
	}
	src := refsvc.WorkflowSource{
		ID:                  c.workflow.ID,
		Name:                c.workflow.Name,
		SourceCreatedByType: c.workflow.CreatedByType,
		SourceCreatedByRef:  c.workflow.CreatedByRef,
	}
	edges := refsvc.ExtractWorkflowEdges(src, c.workflow.Steps, c.workflow.Trigger)
	if err := refRepo.ReplaceEdgesForSource("workflow", c.workflow.ID, edges); err != nil {
		logger.Error("Replace the edges of a command's workflow", "workflow_id", c.workflow.ID, "error", err)
	}
}
