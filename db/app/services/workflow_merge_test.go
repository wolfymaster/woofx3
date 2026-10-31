package services

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

const reply = `{"id":"step_1","type":"action","action":"chat.reply","parameters":{}}`

func cheerTrigger(extra string) string {
	return `{"type":"event","event":"channel.cheer"` + extra + `}`
}

func ownWorkflow(t *testing.T, svc client.WorkflowService, name, trigger, steps string, enabled bool) *client.Workflow {
	t.Helper()
	wf := createWorkflow(t, svc, &client.CreateWorkflowRequest{Name: name, TriggerJson: trigger, StepsJson: steps})
	if !enabled {
		return wf
	}
	return setEnabled(t, svc, wf.Id)
}

func setEnabled(t *testing.T, svc client.WorkflowService, id string) *client.Workflow {
	t.Helper()
	on := true
	res, err := svc.UpdateWorkflow(context.Background(), &client.UpdateWorkflowRequest{Id: id, Enabled: &on})
	if err != nil {
		t.Fatalf("enable workflow: %v", err)
	}
	return res.Workflow
}

func workflowCount(t *testing.T, db *gorm.DB) int64 {
	t.Helper()
	var count int64
	if err := db.Model(&models.WorkflowDefinition{}).Count(&count).Error; err != nil {
		t.Fatalf("count workflows: %v", err)
	}
	return count
}

func stepIDs(t *testing.T, wf *client.Workflow) []string {
	t.Helper()
	tasks, err := decodeMergeTasks(wf.StepsJson)
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 0, len(tasks))
	for _, task := range tasks {
		ids = append(ids, taskID(task))
	}
	return ids
}

func TestTriggerIdentity(t *testing.T) {
	a := `{"field":"${trigger.data.amount}","operator":"gte","value":100}`
	b := `{"field":"${trigger.data.userName}","operator":"eq","value":"wolfy"}`
	cases := []struct {
		name        string
		left, right string
		same        bool
	}{
		{"no conditions match", cheerTrigger(""), cheerTrigger(`,"conditions":[]`), true},
		{"order is not identity", cheerTrigger(`,"order":1`), cheerTrigger(`,"order":9`), true},
		{"condition order is not identity", cheerTrigger(`,"conditions":[` + a + `,` + b + `]`), cheerTrigger(`,"conditions":[` + b + `,` + a + `]`), true},
		{"a different value differs", cheerTrigger(`,"conditions":[` + a + `]`), cheerTrigger(""), false},
		{"another event differs", cheerTrigger(""), `{"type":"event","event":"channel.follow"}`, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			left, ok := triggerIdentity(tc.left)
			if !ok {
				t.Fatal("left does not merge")
			}
			right, ok := triggerIdentity(tc.right)
			if !ok {
				t.Fatal("right does not merge")
			}
			if (left == right) != tc.same {
				t.Fatalf("same = %v, want %v", left == right, tc.same)
			}
		})
	}
	for _, unmergeable := range []string{
		`{`,
		`{"type":"command","event":"chat.command.x"}`,
		`{"type":"schedule","event":"x"}`,
		`{"type":"event","event":"x","debounce":5}`,
	} {
		if _, ok := triggerIdentity(unmergeable); ok {
			t.Fatalf("%s should not merge", unmergeable)
		}
	}
}

func TestAppendTasks(t *testing.T) {
	decode := func(raw string) []mergeTask {
		tasks, err := decodeMergeTasks(raw)
		if err != nil {
			t.Fatal(err)
		}
		return tasks
	}

	t.Run("renames a taken id and everything naming it", func(t *testing.T) {
		merged := decode(`[{"id":"step_1","type":"action"}]`)
		next := decode(`[
			{"id":"step_1","type":"action","parameters":{"n":100}},
			{"id":"step_2","type":"action","dependsOn":["step_1"],"parameters":{
				"message":"${step_1.text} ${trigger.data.step_1} ${upper(step_1.text)} step_1"}}
		]`)
		out, err := appendTasks(merged, next)
		if err != nil {
			t.Fatal(err)
		}
		written, _ := json.Marshal(out)
		text := string(written)
		for _, want := range []string{
			`"id":"step_1_2"`,
			`"dependsOn":["step_1_2"]`,
			`${step_1_2.text} ${trigger.data.step_1} ${upper(step_1_2.text)} step_1`,
			`"n":100`,
		} {
			if !strings.Contains(text, want) {
				t.Fatalf("missing %s in %s", want, text)
			}
		}
		if got := stringList(out[1]["dependsOn"]); len(got) != 1 || got[0] != "step_1" {
			t.Fatalf("appended steps must start after the last step: %v", got)
		}
	})

	t.Run("starts after a condition, not inside its branch", func(t *testing.T) {
		merged := decode(`[
			{"id":"check","type":"condition","onTrue":["yes"]},
			{"id":"yes","type":"action","dependsOn":["check"]}
		]`)
		out, err := appendTasks(merged, decode(`[{"id":"next","type":"action"}]`))
		if err != nil {
			t.Fatal(err)
		}
		if got := stringList(out[2]["dependsOn"]); len(got) != 1 || got[0] != "check" {
			t.Fatalf("dependsOn = %v, want check", got)
		}
	})

	refused := []struct{ name, merged, next string }{
		{"side by side", `[{"id":"a"},{"id":"b"}]`, `[{"id":"c"}]`},
		{"next side by side", `[{"id":"a"}]`, `[{"id":"b"},{"id":"c"}]`},
		{"waits for two", `[{"id":"a"}]`, `[{"id":"b"},{"id":"c","dependsOn":["b","x"]}]`},
		{"same export", `[{"id":"a","exports":{"x":"1"}}]`, `[{"id":"b","exports":{"x":"2"}}]`},
	}
	for _, tc := range refused {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := appendTasks(decode(tc.merged), decode(tc.next)); !errors.Is(err, errNotMergeable) {
				t.Fatalf("err = %v, want errNotMergeable", err)
			}
		})
	}
}

func TestUpdateWorkflow_SwitchingOnMergesASharedTrigger(t *testing.T) {
	svc, db := newWorkflowTestService(t)
	first := ownWorkflow(t, svc, "first", cheerTrigger(`,"order":0`), `[`+reply+`]`, true)
	second := ownWorkflow(t, svc, "second", cheerTrigger(`,"order":1`), `[`+reply+`]`, true)

	if second.Id == first.Id {
		t.Fatal("the saved workflow must keep its own id")
	}
	if got := workflowCount(t, db); got != 1 {
		t.Fatalf("workflows = %d, want 1", got)
	}
	if got := stepIDs(t, second); len(got) != 2 || got[0] != "step_1" || got[1] != "step_1_2" {
		t.Fatalf("steps = %v, want the lower order's first", got)
	}
	if order := triggerOrder(t, second); order == nil || *order != 0 {
		t.Fatalf("order = %v, want the earliest place", order)
	}
}

func TestUpdateWorkflow_MergeKeepsRunsAndAlerts(t *testing.T) {
	svc, db := newWorkflowTestService(t)
	first := ownWorkflow(t, svc, "first", cheerTrigger(""), `[`+reply+`]`, true)
	firstID := uuid.MustParse(first.Id)
	run := models.WorkflowExecution{ID: uuid.New(), WorkflowID: firstID, Status: models.WorkflowStatusCompleted}
	if err := db.Omit("Workflow").Create(&run).Error; err != nil {
		t.Fatalf("seed run: %v", err)
	}

	alert := models.Alert{ID: uuid.New(), Payload: "{}", WorkflowID: &firstID}
	if err := db.Create(&alert).Error; err != nil {
		t.Fatalf("seed alert: %v", err)
	}

	second := ownWorkflow(t, svc, "second", cheerTrigger(""), `[`+reply+`]`, true)

	var keptAlert models.Alert
	if err := db.First(&keptAlert, "id = ?", alert.ID).Error; err != nil {
		t.Fatalf("read alert: %v", err)
	}
	if keptAlert.WorkflowID == nil || keptAlert.WorkflowID.String() != second.Id {
		t.Fatalf("alert belongs to %v, want %s", keptAlert.WorkflowID, second.Id)
	}

	var kept models.WorkflowExecution
	if err := db.First(&kept, "id = ?", run.ID).Error; err != nil {
		t.Fatalf("the run was lost: %v", err)
	}
	if kept.WorkflowID.String() != second.Id {
		t.Fatalf("run belongs to %s, want %s", kept.WorkflowID, second.Id)
	}
}

func TestUpdateWorkflow_KeepsApart(t *testing.T) {
	cases := []struct {
		name  string
		setup func(t *testing.T, svc client.WorkflowService, db *gorm.DB, other *client.Workflow)
		other string
		steps string
		want  int64
	}{
		{name: "other conditions", other: cheerTrigger(`,"conditions":[{"field":"${trigger.data.amount}","operator":"gte","value":100}]`), want: 2},
		{name: "steps that aren't a list", other: cheerTrigger(""), steps: `[{"id":"a"},{"id":"b"}]`, want: 2},
		{
			name:  "a run in flight",
			other: cheerTrigger(""),
			setup: func(t *testing.T, _ client.WorkflowService, db *gorm.DB, other *client.Workflow) {
				run := models.WorkflowExecution{ID: uuid.New(), WorkflowID: uuid.MustParse(other.Id), Status: models.WorkflowStatusRunning}
				if err := db.Omit("Workflow").Create(&run).Error; err != nil {
					t.Fatalf("seed run: %v", err)
				}
			},
			want: 2,
		},
		{
			name:  "called by another workflow",
			other: cheerTrigger(""),
			setup: func(t *testing.T, svc client.WorkflowService, _ *gorm.DB, other *client.Workflow) {
				createWorkflow(t, svc, &client.CreateWorkflowRequest{
					Name:        "caller",
					TriggerJson: `{"type":"event","event":"channel.follow"}`,
					StepsJson:   `[{"id":"call","type":"workflow","workflow":{"workflowId":"` + other.Id + `"}}]`,
				})
			},
			want: 3,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc, db := newWorkflowTestService(t)
			steps := tc.steps
			if steps == "" {
				steps = `[` + reply + `]`
			}
			other := ownWorkflow(t, svc, "other", tc.other, steps, true)
			if tc.setup != nil {
				tc.setup(t, svc, db, other)
			}
			ownWorkflow(t, svc, "mine", cheerTrigger(""), `[`+reply+`]`, true)
			if got := workflowCount(t, db); got != tc.want {
				t.Fatalf("workflows = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestUpdateWorkflow_NeverMergesPausedOrModuleWorkflows(t *testing.T) {
	svc, db := newWorkflowTestService(t)
	ownWorkflow(t, svc, "paused", cheerTrigger(""), `[`+reply+`]`, false)
	createWorkflow(t, svc, moduleWorkflowRequest("board", "cheers", "channel.cheer"))
	mine := ownWorkflow(t, svc, "mine", cheerTrigger(""), `[`+reply+`]`, true)

	if got := workflowCount(t, db); got != 3 {
		t.Fatalf("workflows = %d, want 3", got)
	}
	if got := stepIDs(t, mine); len(got) != 1 {
		t.Fatalf("steps = %v, want only its own", got)
	}
}

func TestUpdateWorkflow_ResumingMergesThePausedWorkflow(t *testing.T) {
	svc, db := newWorkflowTestService(t)
	paused := ownWorkflow(t, svc, "paused", cheerTrigger(""), `[`+reply+`]`, false)
	ownWorkflow(t, svc, "mine", cheerTrigger(""), `[`+reply+`]`, true)

	resumed := setEnabled(t, svc, paused.Id)
	if resumed.Id != paused.Id {
		t.Fatalf("id = %s, want %s", resumed.Id, paused.Id)
	}
	if got := workflowCount(t, db); got != 1 {
		t.Fatalf("workflows = %d, want 1", got)
	}
}

func TestMergeOwnWorkflows_ConvertsExistingAndIsRepeatable(t *testing.T) {
	_, db := newWorkflowTestService(t)
	workflows := repo.NewWorkflowRepository(db, database.RandomIDs{})
	for _, name := range []string{"a", "b", "c"} {
		wf := &models.WorkflowDefinition{
			Name: name, Steps: `[` + reply + `]`, Trigger: cheerTrigger(""), CreatedByType: "USER", Enabled: true, Taxonomy: "[]",
		}
		if err := workflows.Create(wf); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	merged, failed := MergeOwnWorkflows(workflows, db, nil, nil)
	if merged != 2 || failed != 0 {
		t.Fatalf("merged = %d, failed = %d", merged, failed)
	}
	if got := workflowCount(t, db); got != 1 {
		t.Fatalf("workflows = %d, want 1", got)
	}
	if merged, failed := MergeOwnWorkflows(workflows, db, nil, nil); merged != 0 || failed != 0 {
		t.Fatalf("second run merged = %d, failed = %d", merged, failed)
	}
}

func TestUpdateWorkflow_ExpectedRevision(t *testing.T) {
	svc, _ := newWorkflowTestService(t)
	ctx := context.Background()
	wf := ownWorkflow(t, svc, "first", cheerTrigger(`,"order":0`), `[`+reply+`]`, false)
	updateSteps := func(expected *int32) (*client.WorkflowResponse, error) {
		return svc.UpdateWorkflow(ctx, &client.UpdateWorkflowRequest{
			Id:               wf.Id,
			StepsJson:        `[` + strings.Replace(reply, `"step_1"`, `"step_2"`, 1) + `]`,
			ExpectedRevision: expected,
		})
	}

	stale := wf.Revision - 1
	if _, err := updateSteps(&stale); err == nil {
		t.Fatal("a save from an older revision must be refused")
	} else {
		wantTwirpCode(t, err, twirp.Aborted)
	}
	stored, err := svc.GetWorkflow(ctx, &client.GetWorkflowRequest{Id: wf.Id})
	if err != nil {
		t.Fatal(err)
	}
	if stored.Workflow.StepsJson != wf.StepsJson || stored.Workflow.Revision != wf.Revision {
		t.Fatal("a refused save must change nothing")
	}

	saved, err := updateSteps(&wf.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Workflow.Revision != wf.Revision+1 {
		t.Fatalf("revision = %d, want %d", saved.Workflow.Revision, wf.Revision+1)
	}
	on := setEnabled(t, svc, wf.Id)
	if on.Revision != saved.Workflow.Revision {
		t.Fatalf("switching on moved the revision to %d, want %d", on.Revision, saved.Workflow.Revision)
	}
}

func TestUpdateWorkflow_MergeRefusesASaveFromBeforeIt(t *testing.T) {
	svc, _ := newWorkflowTestService(t)
	ownWorkflow(t, svc, "first", cheerTrigger(`,"order":0`), `[`+reply+`]`, true)
	beforeMerge := ownWorkflow(t, svc, "second", cheerTrigger(`,"order":1`), `[`+reply+`]`, false)

	merged := setEnabled(t, svc, beforeMerge.Id)
	if merged.Revision == beforeMerge.Revision {
		t.Fatal("a merge must move the revision")
	}

	_, err := svc.UpdateWorkflow(context.Background(), &client.UpdateWorkflowRequest{
		Id:               merged.Id,
		StepsJson:        `[` + reply + `]`,
		ExpectedRevision: &beforeMerge.Revision,
	})
	wantTwirpCode(t, err, twirp.Aborted)
}
