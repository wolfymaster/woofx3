package sqlite

import (
	"encoding/json"
	"testing"

	"github.com/wolfymaster/woofx3/db/database/migrate/migrations/alertworkflows"
	"gorm.io/gorm"
)

const (
	cheerWorkflowID  = "00000000-0000-0000-0000-0000000000c1"
	moduleWorkflowID = "00000000-0000-0000-0000-0000000000c2"
	sharedWorkflowID = "00000000-0000-0000-0000-0000000000c3"
)

const cheerTriggers = `[
	{"id":"rule_1","type":"condition","conditions":[{"field":"${trigger.data.amount}","operator":"gte","value":100}],"onTrue":["act_1"]},
	{"id":"act_1","type":"action","action":"function","function":"obs:function:flash","parameters":{},"dependsOn":["rule_1"]},
	{"id":"rule_2","type":"condition","disabled":true,"conditions":[{"field":"${trigger.data.amount}","operator":"gte","value":1000}],"onTrue":["act_2"]},
	{"id":"act_2","type":"action","action":"alert","parameters":{},"dependsOn":["rule_2"]}
]`

const sharedStep = `[
	{"id":"rule_1","type":"condition","conditions":[{"field":"${trigger.data.amount}","operator":"gte","value":1}],"onTrue":["act_1"]},
	{"id":"act_1","type":"action","action":"alert","parameters":{},"dependsOn":["rule_1"]},
	{"id":"rule_2","type":"condition","conditions":[{"field":"${trigger.data.amount}","operator":"gte","value":5}],"onTrue":["act_2"]},
	{"id":"act_2","type":"action","action":"alert","parameters":{},"dependsOn":["rule_2"]},
	{"id":"shared","type":"action","action":"alert","parameters":{},"dependsOn":["rule_1","rule_2"],
		"conditions":[{"field":"${rule_1.result}","operator":"eq","value":true},{"field":"${rule_2.result}","operator":"eq","value":true}],"conditionLogic":"or"}
]`

type splitRow struct {
	ID      string
	Name    string
	Steps   string
	Trigger string
	Enabled bool
}

func seedAlertWorkflows(t *testing.T) *gorm.DB {
	t.Helper()
	db := openMigratedTo(t, "0063_action_sentence")
	trigger := `{"type":"event","event":"channel.cheer"}`
	mustExec(t, db, `INSERT INTO workflow_definitions (id, name, steps, trigger, enabled, taxonomy) VALUES (?, 'Cheer triggers', ?, ?, 1, '["alert.cheer"]')`,
		cheerWorkflowID, cheerTriggers, trigger)
	mustExec(t, db, `INSERT INTO workflow_definitions (id, name, steps, trigger, enabled, created_by_type, created_by_ref, manifest_id)
		VALUES (?, 'Module cheer', ?, ?, 1, 'MODULE', 'twitch', 'cheer')`, moduleWorkflowID, cheerTriggers, trigger)
	mustExec(t, db, `INSERT INTO workflow_definitions (id, name, steps, trigger, enabled) VALUES (?, 'Shared', ?, ?, 1)`,
		sharedWorkflowID, sharedStep, trigger)
	return db
}

func workflowRows(t *testing.T, db *gorm.DB) map[string]splitRow {
	t.Helper()
	var rows []splitRow
	if err := db.Raw(`SELECT id, name, steps, trigger, enabled FROM workflow_definitions`).Scan(&rows).Error; err != nil {
		t.Fatalf("read workflows: %v", err)
	}
	byName := make(map[string]splitRow, len(rows))
	for _, row := range rows {
		byName[row.Name] = row
	}
	return byName
}

func triggerOrder(t *testing.T, row splitRow) float64 {
	t.Helper()
	var trigger struct {
		Order *float64 `json:"order"`
	}
	if err := json.Unmarshal([]byte(row.Trigger), &trigger); err != nil || trigger.Order == nil {
		t.Fatalf("%s trigger %s has no order (%v)", row.Name, row.Trigger, err)
	}
	return *trigger.Order
}

func TestSplitAlertWorkflowsGivesEachTriggerItsOwnWorkflow(t *testing.T) {
	db := seedAlertWorkflows(t)
	if err := migrateAll(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	rows := workflowRows(t, db)
	if len(rows) != 4 {
		t.Fatalf("got %d workflows, want 4: %v", len(rows), rows)
	}
	first, ok := rows["Cheer triggers"]
	if !ok || first.ID != cheerWorkflowID {
		t.Fatalf("the first trigger did not keep the workflow's id: %+v", first)
	}
	second, ok := rows["Cheer triggers (2)"]
	if !ok {
		t.Fatalf("no workflow for the second trigger: %v", rows)
	}
	if triggerOrder(t, first) != 0 || triggerOrder(t, second) != 1 {
		t.Errorf("orders = %v, %v; want 0, 1", triggerOrder(t, first), triggerOrder(t, second))
	}
	if !first.Enabled {
		t.Error("the enabled trigger's workflow is disabled")
	}
	if second.Enabled {
		t.Error("the paused trigger's workflow is enabled")
	}

	var taxonomy string
	if err := db.Raw(`SELECT taxonomy FROM workflow_definitions WHERE id = ?`, second.ID).Scan(&taxonomy).Error; err != nil {
		t.Fatalf("read taxonomy: %v", err)
	}
	if taxonomy != `["alert.cheer"]` {
		t.Errorf("new workflow's taxonomy = %s, want the original's", taxonomy)
	}

	if module := rows["Module cheer"]; module.Steps != cheerTriggers {
		t.Errorf("a module's workflow was rewritten: %s", module.Steps)
	}
	if shared := rows["Shared"]; shared.Steps != sharedStep {
		t.Errorf("a workflow with a shared step was rewritten: %s", shared.Steps)
	}

	if n := count(t, db, `SELECT COUNT(*) FROM resource_references WHERE source_type = 'workflow' AND source_id = ? AND target_name = 'obs:function:flash'`, cheerWorkflowID); n != 1 {
		t.Errorf("the first trigger's workflow has %d edges to the function it calls, want 1", n)
	}
}

// Running the rewrite again, as a run that died part way would, changes nothing.
func TestSplitAlertWorkflowsIsIdempotent(t *testing.T) {
	db := seedAlertWorkflows(t)
	if err := migrateAll(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	before := workflowRows(t, db)

	summary, err := alertworkflows.Apply(db, alertworkflows.Dialect{
		Workflows:  "workflow_definitions",
		References: "resource_references",
		JSON:       "?",
	})
	if err != nil {
		t.Fatalf("Apply again: %v", err)
	}
	if summary.Split != 0 || summary.Created != 0 {
		t.Errorf("second run = %+v, want nothing split", summary)
	}
	after := workflowRows(t, db)
	if len(after) != len(before) {
		t.Fatalf("second run left %d workflows, want %d", len(after), len(before))
	}
	for name, row := range before {
		if after[name] != row {
			t.Errorf("second run changed %s:\n  %+v\nto\n  %+v", name, row, after[name])
		}
	}
}

// A run that fails part way leaves every workflow it reached split and every
// other one as it was, and running it again finishes the job: the end state is
// the one a run that never failed leaves.
func TestSplitAlertWorkflowsResumesARunThatFailedPartWay(t *testing.T) {
	const secondCheerID = "00000000-0000-0000-0000-0000000000c4"
	dialect := alertworkflows.Dialect{Workflows: "workflow_definitions", References: "resource_references", JSON: "?"}

	db := seedAlertWorkflows(t)
	mustExec(t, db, `INSERT INTO workflow_definitions (id, name, steps, trigger, enabled) VALUES (?, 'More cheers', ?, ?, 1)`,
		secondCheerID, cheerTriggers, `{"type":"event","event":"channel.cheer"}`)
	// Fails the rewrite of the second workflow, after the first has committed.
	mustExec(t, db, `CREATE TRIGGER fail_second_split BEFORE INSERT ON resource_references
		WHEN NEW.source_id = '`+secondCheerID+`' BEGIN SELECT RAISE(ABORT, 'disk full'); END`)

	if _, err := alertworkflows.Apply(db, dialect); err == nil {
		t.Fatal("Apply succeeded through a failing insert")
	}
	rows := workflowRows(t, db)
	if _, ok := rows["Cheer triggers (2)"]; !ok {
		t.Fatalf("the workflow before the failure was not split: %v", rows)
	}
	if more := rows["More cheers"]; more.Steps != cheerTriggers {
		t.Fatalf("the failed workflow was left half rewritten: %s", more.Steps)
	}
	if _, ok := rows["More cheers (2)"]; ok {
		t.Fatal("the failed workflow's second trigger was created")
	}

	mustExec(t, db, `DROP TRIGGER fail_second_split`)
	summary, err := alertworkflows.Apply(db, dialect)
	if err != nil {
		t.Fatalf("Apply again: %v", err)
	}
	if summary.Split != 1 || summary.Created != 1 {
		t.Errorf("second run = %+v, want only the failed workflow split", summary)
	}

	rows = workflowRows(t, db)
	if len(rows) != 6 {
		t.Fatalf("got %d workflows, want 6: %v", len(rows), rows)
	}
	for _, name := range []string{"Cheer triggers", "More cheers"} {
		first, second := rows[name], rows[name+" (2)"]
		if triggerOrder(t, first) != 0 || triggerOrder(t, second) != 1 {
			t.Errorf("%s orders = %v, %v; want 0, 1", name, triggerOrder(t, first), triggerOrder(t, second))
		}
		if n := count(t, db, `SELECT COUNT(*) FROM resource_references WHERE source_type = 'workflow' AND source_id = ? AND target_name = 'obs:function:flash'`, first.ID); n != 1 {
			t.Errorf("%s has %d edges to the function it calls, want 1", name, n)
		}
	}
}
