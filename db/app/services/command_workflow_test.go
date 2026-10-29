package services

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

const helloActions = `[{"id":"greet","action":"chat.reply","parameters":{"message":"hello"}},{"action":"chat.reply","parameters":{"message":"again"}}]`

func workflowRows(t *testing.T, f *commandPermFixture) []models.WorkflowDefinition {
	t.Helper()
	var rows []models.WorkflowDefinition
	if err := f.db.Find(&rows).Error; err != nil {
		t.Fatalf("list workflows: %v", err)
	}
	return rows
}

func workflowByID(t *testing.T, f *commandPermFixture, id string) models.WorkflowDefinition {
	t.Helper()
	var wf models.WorkflowDefinition
	if err := f.db.Where("id = ?", id).First(&wf).Error; err != nil {
		t.Fatalf("read workflow %s: %v", id, err)
	}
	return wf
}

func decodeTasks(t *testing.T, stepsJSON string) []map[string]any {
	t.Helper()
	var tasks []map[string]any
	if err := json.Unmarshal([]byte(stepsJSON), &tasks); err != nil {
		t.Fatalf("decode steps %s: %v", stepsJSON, err)
	}
	return tasks
}

func createWithActions(t *testing.T, f *commandPermFixture, name, actionsJSON string) *client.Command {
	t.Helper()
	res, err := f.svc.CreateCommand(context.Background(), &client.CreateCommandRequest{
		Command:     name,
		ActionsJson: actionsJSON,
		Enabled:     true,
		Visibility:  "public",
	})
	if err != nil {
		t.Fatalf("create command %q: %v", name, err)
	}
	return res.Command
}

// insertLegacyCommand writes a command row the way a database from before
// commands had workflows holds one: actions on the row, no workflow.
func insertLegacyCommand(t *testing.T, f *commandPermFixture, name, actionsJSON string) uuid.UUID {
	t.Helper()
	cmd := models.Command{
		ID:            uuid.New(),
		Command:       name,
		Actions:       actionsJSON,
		Enabled:       true,
		CreatedByType: "USER",
		Visibility:    "public",
	}
	if err := f.db.Create(&cmd).Error; err != nil {
		t.Fatalf("insert legacy command %q: %v", name, err)
	}
	return cmd.ID
}

func commandRow(t *testing.T, f *commandPermFixture, id uuid.UUID) models.Command {
	t.Helper()
	var cmd models.Command
	if err := f.db.Where("id = ?", id).First(&cmd).Error; err != nil {
		t.Fatalf("read command %s: %v", id, err)
	}
	return cmd
}

func TestChainActions_RunsActionsInOrderKeepingWhatTheySay(t *testing.T) {
	steps, err := chainActions(`[{"id":"a","action":"x"},{"action":"y"},{"id":"c","action":"z","dependsOn":["a"]},{"id":"d","type":"workflow","workflow":{"workflowId":"w"}}]`)
	if err != nil {
		t.Fatalf("chain: %v", err)
	}
	tasks := decodeTasks(t, steps)
	type want struct {
		id, taskType string
		dependsOn    []any
	}
	wants := []want{
		{"a", "action", nil},
		{"action-2", "action", []any{"a"}},
		{"c", "action", []any{"a"}},
		{"d", "workflow", []any{"c"}},
	}
	for i, w := range wants {
		task := tasks[i]
		if task["id"] != w.id || task["type"] != w.taskType {
			t.Fatalf("task %d: id=%v type=%v, want %s %s", i, task["id"], task["type"], w.id, w.taskType)
		}
		got, _ := task["dependsOn"].([]any)
		if len(got) != len(w.dependsOn) || (len(got) == 1 && got[0] != w.dependsOn[0]) {
			t.Fatalf("task %d dependsOn=%v, want %v", i, got, w.dependsOn)
		}
	}

	if _, err := chainActions(`[{"id":"a","action":"x"},{"id":"a","action":"y"}]`); err == nil {
		t.Fatal("two actions with one id were chained")
	}
	if _, err := chainActions(`{"action":"x"}`); err == nil {
		t.Fatal("an object that is not a list was chained")
	}
}

// A command with actions gets a workflow of its own holding them, which no
// event starts: the commander runs it by id.
func TestCreateCommand_WithActionsLinksAWorkflow(t *testing.T) {
	f := newCommandPermFixture(t)
	cmd := createWithActions(t, f, "Hello", helloActions)

	if cmd.WorkflowId == "" {
		t.Fatal("a command with actions has no workflow")
	}
	if cmd.ActionsJson != "[]" {
		t.Fatalf("a linked command kept its own actions: %s", cmd.ActionsJson)
	}
	wf := workflowByID(t, f, cmd.WorkflowId)
	if !wf.Enabled {
		t.Fatal("the command's workflow was created disabled")
	}
	if wf.Trigger != `{"event":"chat.command.hello","type":"command"}` {
		t.Fatalf("trigger = %s", wf.Trigger)
	}
	if cmd.StepsJson != wf.Steps {
		t.Fatalf("snapshot steps %s differ from the workflow's %s", cmd.StepsJson, wf.Steps)
	}
	tasks := decodeTasks(t, wf.Steps)
	if len(tasks) != 2 || tasks[1]["dependsOn"].([]any)[0] != "greet" {
		t.Fatalf("actions were not chained in order: %s", wf.Steps)
	}
}

func TestCreateCommand_WithoutStepsHasNoWorkflow(t *testing.T) {
	f := newCommandPermFixture(t)
	cmd := createWithActions(t, f, "lurk", "")
	if cmd.WorkflowId != "" || cmd.StepsJson != "[]" {
		t.Fatalf("a command with no steps got a workflow: id=%q steps=%s", cmd.WorkflowId, cmd.StepsJson)
	}
	if rows := workflowRows(t, f); len(rows) != 0 {
		t.Fatalf("expected no workflows, got %d", len(rows))
	}
}

func TestCreateCommand_StepsWinOverActions(t *testing.T) {
	f := newCommandPermFixture(t)
	steps := `[{"id":"check","type":"condition","condition":{"field":"${trigger.data.chatter}","operator":"eq","value":"wolfy"},"onTrue":["pause"]},{"id":"pause","type":"wait","dependsOn":["check"],"wait":{"type":"delay","durationMs":1000}}]`
	res, err := f.svc.CreateCommand(context.Background(), &client.CreateCommandRequest{
		Command:     "hug",
		ActionsJson: helloActions,
		StepsJson:   steps,
		Enabled:     true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if res.Command.StepsJson != steps {
		t.Fatalf("steps were rewritten: %s", res.Command.StepsJson)
	}
}

func TestUpdateCommand_StepsReplaceDeleteAndKeep(t *testing.T) {
	f := newCommandPermFixture(t)
	created := createWithActions(t, f, "hello", helloActions)
	update := func(req *client.UpdateCommandRequest) *client.Command {
		t.Helper()
		req.Id = created.Id
		req.Enabled = true
		if req.Command == "" {
			req.Command = "hello"
		}
		res, err := f.svc.UpdateCommand(context.Background(), req)
		if err != nil {
			t.Fatalf("update: %v", err)
		}
		return res.Command
	}

	// Neither steps nor actions: the steps stay as they are.
	kept := update(&client.UpdateCommandRequest{Cooldown: 5})
	if kept.WorkflowId != created.WorkflowId || kept.StepsJson != created.StepsJson {
		t.Fatalf("an update without steps changed them: %s", kept.StepsJson)
	}

	replacement := `[{"id":"only","type":"action","action":"chat.reply","parameters":{"message":"hi"}}]`
	replaced := update(&client.UpdateCommandRequest{StepsJson: &replacement})
	if replaced.WorkflowId != created.WorkflowId {
		t.Fatalf("replacing the steps made a new workflow: %s -> %s", created.WorkflowId, replaced.WorkflowId)
	}
	if replaced.StepsJson != replacement {
		t.Fatalf("steps = %s", replaced.StepsJson)
	}

	renamed := update(&client.UpdateCommandRequest{Command: "Hi"})
	if wf := workflowByID(t, f, renamed.WorkflowId); wf.Trigger != `{"event":"chat.command.hi","type":"command"}` || wf.Name != "!Hi" {
		t.Fatalf("renaming the command left its workflow at %s (%s)", wf.Trigger, wf.Name)
	}

	none := "[]"
	cleared := update(&client.UpdateCommandRequest{StepsJson: &none})
	if cleared.WorkflowId != "" {
		t.Fatal("a command with no steps kept its workflow")
	}
	if rows := workflowRows(t, f); len(rows) != 0 {
		t.Fatalf("the emptied command's workflow was not deleted: %d left", len(rows))
	}

	relinked := update(&client.UpdateCommandRequest{ActionsJson: helloActions})
	if relinked.WorkflowId == "" || relinked.ActionsJson != "[]" {
		t.Fatalf("actions on an update did not become the workflow: id=%q actions=%s", relinked.WorkflowId, relinked.ActionsJson)
	}
}

func TestDeleteCommand_DeletesItsWorkflow(t *testing.T) {
	f := newCommandPermFixture(t)
	cmd := createWithActions(t, f, "hello", helloActions)
	if _, err := f.svc.DeleteCommand(context.Background(), &client.DeleteCommandRequest{Id: cmd.Id}); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if rows := workflowRows(t, f); len(rows) != 0 {
		t.Fatalf("the deleted command's workflow is still there: %d", len(rows))
	}
}

// Upgrading links every command that has actions, and starting again finds
// nothing left to link.
func TestLinkCommandWorkflows_IsIdempotent(t *testing.T) {
	f := newCommandPermFixture(t)
	helloID := insertLegacyCommand(t, f, "hello", helloActions)
	lurkID := insertLegacyCommand(t, f, "lurk", "[]")

	linked, failed := f.svc.LinkCommandWorkflows()
	if linked != 1 || failed != 0 {
		t.Fatalf("first run linked %d, failed %d; want 1, 0", linked, failed)
	}
	hello := commandRow(t, f, helloID)
	if hello.WorkflowID == nil || hello.Actions != "[]" {
		t.Fatalf("hello was not linked: workflow=%v actions=%s", hello.WorkflowID, hello.Actions)
	}
	wf := workflowByID(t, f, hello.WorkflowID.String())
	want, _ := chainActions(helloActions)
	if wf.Steps != want {
		t.Fatalf("workflow steps = %s, want %s", wf.Steps, want)
	}
	if lurk := commandRow(t, f, lurkID); lurk.WorkflowID != nil {
		t.Fatal("a command with no actions got a workflow")
	}

	linked, failed = f.svc.LinkCommandWorkflows()
	if linked != 0 || failed != 0 {
		t.Fatalf("second run linked %d, failed %d; want 0, 0", linked, failed)
	}
	if rows := workflowRows(t, f); len(rows) != 1 {
		t.Fatalf("expected one workflow after two runs, got %d", len(rows))
	}
	if again := commandRow(t, f, helloID); *again.WorkflowID != *hello.WorkflowID {
		t.Fatal("the second run relinked hello")
	}
}

// A command that cannot be converted is left as it was, so it keeps running
// its actions without a workflow.
func TestLinkCommandWorkflows_LeavesAFailureOnTheOldPath(t *testing.T) {
	f := newCommandPermFixture(t)
	brokenActions := `[{"action":"chat.reply"},`
	broken := insertLegacyCommand(t, f, "broken", brokenActions)
	badName := insertLegacyCommand(t, f, "two words", helloActions)
	good := insertLegacyCommand(t, f, "hello", helloActions)

	linked, failed := f.svc.LinkCommandWorkflows()
	if linked != 1 || failed != 2 {
		t.Fatalf("linked %d, failed %d; want 1, 2", linked, failed)
	}
	for _, id := range []uuid.UUID{broken, badName} {
		row := commandRow(t, f, id)
		if row.WorkflowID != nil {
			t.Fatalf("command %q was linked", row.Command)
		}
		if row.Actions == "[]" {
			t.Fatalf("command %q lost its actions", row.Command)
		}
	}
	if commandRow(t, f, good).WorkflowID == nil {
		t.Fatal("one failure stopped the rest from linking")
	}
	if rows := workflowRows(t, f); len(rows) != 1 {
		t.Fatalf("a failed command left a workflow behind: %d workflows", len(rows))
	}
}

// withOutbox gives the fixture's command service an outbox to publish to, and
// returns a reader of the command events written to it, oldest first.
func withOutbox(t *testing.T, f *commandPermFixture) func() []models.WorkerEvent {
	t.Helper()
	ddl := `CREATE TABLE worker_events (
		id TEXT PRIMARY KEY,
		event_type VARCHAR(255) NOT NULL,
		client_id VARCHAR(255) NOT NULL DEFAULT '',
		entity_type VARCHAR(100) NOT NULL,
		entity_id VARCHAR(255) NOT NULL,
		operation VARCHAR(50) NOT NULL,
		payload TEXT NOT NULL,
		status VARCHAR(50) NOT NULL DEFAULT 'pending',
		auto_acknowledge BOOLEAN NOT NULL DEFAULT 1,
		published_at DATETIME,
		acknowledged_at DATETIME,
		attempts INTEGER NOT NULL DEFAULT 0,
		max_attempts INTEGER NOT NULL DEFAULT 3,
		last_error TEXT,
		nats_subject VARCHAR(500) NOT NULL,
		ack_subject VARCHAR(500),
		extensions TEXT,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`
	if err := f.db.Exec(ddl).Error; err != nil {
		t.Fatalf("create outbox: %v", err)
	}
	f.svc.publisher = workers.NewEventPublisher(repo.NewDbEventRepository(f.db), slog.New(slog.DiscardHandler))
	return func() []models.WorkerEvent {
		t.Helper()
		var events []models.WorkerEvent
		if err := f.db.Where("entity_type = ?", "command").Order("created_at, rowid").Find(&events).Error; err != nil {
			t.Fatalf("read outbox: %v", err)
		}
		return events
	}
}

func eventData(t *testing.T, event models.WorkerEvent) map[string]any {
	t.Helper()
	var data map[string]any
	if err := json.Unmarshal([]byte(event.Payload), &data); err != nil {
		t.Fatalf("outbox payload: %v", err)
	}
	return data
}

func assertCode(t *testing.T, err error, code twirp.ErrorCode) {
	t.Helper()
	var twerr twirp.Error
	if !errors.As(err, &twerr) || twerr.Code() != code {
		t.Fatalf("got %v, want a twirp %s", err, code)
	}
}

// The command's own event is written with the change, so it carries the
// workflow the change linked; a refused write announces nothing.
func TestCommandEventsAreWrittenWithTheChange(t *testing.T) {
	f := newCommandPermFixture(t)
	outbox := withOutbox(t, f)

	cmd := createWithActions(t, f, "hello", helloActions)
	events := outbox()
	if len(events) != 1 || events[0].Operation != "created" {
		t.Fatalf("outbox after create: %+v", events)
	}
	if data := eventData(t, events[0]); data["workflow_id"] != cmd.WorkflowId || data["workflow_id"] == "" {
		t.Fatalf("created event names workflow %v, want %s", data["workflow_id"], cmd.WorkflowId)
	}

	bad := `[null]`
	_, err := f.svc.UpdateCommand(context.Background(), &client.UpdateCommandRequest{
		Id: cmd.Id, Command: "hello", Enabled: true, StepsJson: &bad,
	})
	assertCode(t, err, twirp.InvalidArgument)
	if events := outbox(); len(events) != 1 {
		t.Fatalf("a refused update announced %d more events", len(events)-1)
	}
}

func TestCommandWritesRefuseBadInputAsInvalidArgument(t *testing.T) {
	f := newCommandPermFixture(t)
	cases := []struct {
		name, command, steps string
	}{
		{"steps that are not JSON", "hello", `[{"id":`},
		{"a null step", "hello", `[null]`},
		{"a name that cannot be a subject segment", "two words", `[{"id":"a","type":"action","action":"x"}]`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := f.svc.CreateCommand(context.Background(), &client.CreateCommandRequest{
				Command: c.command, StepsJson: c.steps, Enabled: true,
			})
			assertCode(t, err, twirp.InvalidArgument)
		})
	}
	if rows := workflowRows(t, f); len(rows) != 0 {
		t.Fatalf("a refused create left %d workflows", len(rows))
	}
}

// A writer that read the command before another writer linked it must not
// link a second workflow over the first.
func TestSetCommandSteps_RefusesALinkThatChangedSinceItWasRead(t *testing.T) {
	f := newCommandPermFixture(t)
	created := createWithActions(t, f, "hello", helloActions)
	stale := commandRow(t, f, uuid.MustParse(created.Id))
	stale.WorkflowID = nil

	steps, _ := chainActions(helloActions)
	err := f.svc.repo.Transaction(func(tx *gorm.DB) error {
		_, err := f.svc.setCommandSteps(tx, &stale, steps)
		return err
	})
	if !errors.Is(err, repo.ErrCommandLinkChanged) {
		t.Fatalf("got %v, want ErrCommandLinkChanged", err)
	}
	if rows := workflowRows(t, f); len(rows) != 1 {
		t.Fatalf("the refused write left %d workflows, want the original one", len(rows))
	}
}

// SQLite has no foreign key to null a link to a deleted workflow: such a
// command reports why it runs nothing, and writing its steps relinks it.
func TestCommandLinkingAMissingWorkflowReportsAndRecovers(t *testing.T) {
	f := newCommandPermFixture(t)
	created := createWithActions(t, f, "hello", helloActions)
	if err := f.db.Exec(`DELETE FROM workflow_definitions WHERE id = ?`, created.WorkflowId).Error; err != nil {
		t.Fatalf("delete workflow: %v", err)
	}

	listed, err := f.svc.ListCommands(context.Background(), &client.ListCommandsRequest{IncludeDisabled: true})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if got := listed.Commands[0]; got.WorkflowId != "" || got.WorkflowError == "" {
		t.Fatalf("a command with a missing workflow listed as id=%q error=%q", got.WorkflowId, got.WorkflowError)
	}

	res, err := f.svc.UpdateCommand(context.Background(), &client.UpdateCommandRequest{
		Id: created.Id, Command: "hello", Enabled: true, ActionsJson: helloActions,
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if res.Command.WorkflowId == "" || res.Command.WorkflowId == created.WorkflowId || res.Command.WorkflowError != "" {
		t.Fatalf("not relinked: id=%q error=%q", res.Command.WorkflowId, res.Command.WorkflowError)
	}
}

// A command that cannot be converted says why, where the command is read,
// and announces that once rather than on every start.
func TestLinkCommandWorkflows_RecordsWhyACommandWasNotLinked(t *testing.T) {
	f := newCommandPermFixture(t)
	outbox := withOutbox(t, f)
	id := insertLegacyCommand(t, f, "two words", helloActions)

	for range 2 {
		if linked, failed := f.svc.LinkCommandWorkflows(); linked != 0 || failed != 1 {
			t.Fatalf("linked %d, failed %d; want 0, 1", linked, failed)
		}
	}
	if reason := commandRow(t, f, id).WorkflowError; reason == "" {
		t.Fatal("no reason was stored")
	}
	res, err := f.svc.GetCommand(context.Background(), &client.GetCommandRequest{Command: "two words"})
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if res.Command.WorkflowError == "" {
		t.Fatal("the reason is not on the command")
	}
	events := outbox()
	if len(events) != 1 || eventData(t, events[0])["workflow_error"] == "" {
		t.Fatalf("want one updated event carrying the reason, got %d", len(events))
	}
}

func TestLinkCommandWorkflows_AnnouncesTheLinkedCommand(t *testing.T) {
	f := newCommandPermFixture(t)
	outbox := withOutbox(t, f)
	insertLegacyCommand(t, f, "hello", helloActions)

	if linked, _ := f.svc.LinkCommandWorkflows(); linked != 1 {
		t.Fatalf("linked %d, want 1", linked)
	}
	events := outbox()
	if len(events) != 1 || events[0].Operation != "updated" || eventData(t, events[0])["workflow_id"] == "" {
		t.Fatalf("want one updated event naming the workflow, got %+v", events)
	}
}

// A command's workflow is changed only through the command.
func TestWorkflowService_RefusesToChangeACommandsWorkflow(t *testing.T) {
	f := newCommandPermFixture(t)
	cmd := createWithActions(t, f, "hello", helloActions)
	workflows := NewWorkflowService(repo.NewWorkflowRepository(f.db, database.RandomIDs{}), repo.NewCommandRepository(f.db), f.db, nil, nil)
	ctx := context.Background()
	disabled := false

	_, err := workflows.UpdateWorkflow(ctx, &client.UpdateWorkflowRequest{Id: cmd.WorkflowId, Name: "renamed"})
	assertCode(t, err, twirp.FailedPrecondition)
	_, err = workflows.UpdateWorkflow(ctx, &client.UpdateWorkflowRequest{Id: cmd.WorkflowId, TriggerJson: `{"type":"event","event":"chat.command.hello"}`})
	assertCode(t, err, twirp.FailedPrecondition)
	_, err = workflows.UpdateWorkflow(ctx, &client.UpdateWorkflowRequest{Id: cmd.WorkflowId, Enabled: &disabled})
	assertCode(t, err, twirp.FailedPrecondition)
	_, err = workflows.DeleteWorkflow(ctx, &client.DeleteWorkflowRequest{Id: cmd.WorkflowId})
	assertCode(t, err, twirp.FailedPrecondition)
	if wf := workflowByID(t, f, cmd.WorkflowId); wf.Name != "!hello" || !wf.Enabled {
		t.Fatalf("the command's workflow changed: %+v", wf)
	}

	commandTrigger := `{"type":"command","event":"chat.command.hello"}`
	_, err = workflows.CreateWorkflow(ctx, &client.CreateWorkflowRequest{Name: "loose", TriggerJson: commandTrigger, StepsJson: helloActions})
	assertCode(t, err, twirp.FailedPrecondition)

	other, err := workflows.CreateWorkflow(ctx, &client.CreateWorkflowRequest{Name: "other", TriggerJson: `{"type":"event","event":"channel.cheer"}`, StepsJson: helloActions})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	_, err = workflows.UpdateWorkflow(ctx, &client.UpdateWorkflowRequest{Id: other.Workflow.Id, TriggerJson: commandTrigger})
	assertCode(t, err, twirp.FailedPrecondition)
	if _, err := workflows.DeleteWorkflow(ctx, &client.DeleteWorkflowRequest{Id: other.Workflow.Id}); err != nil {
		t.Fatalf("a workflow no command runs could not be deleted: %v", err)
	}
}
