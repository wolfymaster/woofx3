package postgres

import (
	"testing"

	"github.com/go-gormigrate/gormigrate/v2"
)

// The rewrite itself is tested against sqlite and in the alertworkflows
// package; this checks the postgres placeholders and casts hold.
func TestSplitAlertWorkflowsOnPostgres(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).MigrateTo("0063_action_sentence"); err != nil {
		t.Fatalf("migrate to 0063: %v", err)
	}
	const workflow = "00000000-0000-0000-0000-0000000000c1"
	mustExec(t, db, `INSERT INTO workflow_definitions (id, name, steps, trigger, enabled) VALUES (?, 'Cheer triggers', ?::jsonb, ?::jsonb, true)`,
		workflow, `[
			{"id":"rule_1","type":"condition","conditions":[{"field":"${trigger.data.amount}","operator":"gte","value":100}],"onTrue":["act_1"]},
			{"id":"act_1","type":"action","action":"function","function":"obs:function:flash","parameters":{},"dependsOn":["rule_1"]},
			{"id":"rule_2","type":"condition","conditions":[{"field":"${trigger.data.amount}","operator":"gte","value":1000}],"onTrue":["act_2"]},
			{"id":"act_2","type":"action","action":"alert","parameters":{},"dependsOn":["rule_2"]}
		]`, `{"type":"event","event":"channel.cheer"}`)

	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	if n := count(t, db, `SELECT COUNT(*) FROM workflow_definitions WHERE trigger->>'event' = 'channel.cheer'`); n != 2 {
		t.Errorf("got %d cheer workflows, want 2", n)
	}
	if n := count(t, db, `SELECT COUNT(*) FROM workflow_definitions WHERE id = ? AND (trigger->>'order')::int = 0`, workflow); n != 1 {
		t.Error("the first trigger did not keep the workflow's id at order 0")
	}
	if n := count(t, db, `SELECT COUNT(*) FROM resource_references WHERE source_type = 'workflow' AND target_name = 'obs:function:flash'`); n != 1 {
		t.Errorf("got %d edges to the flashed function, want 1", n)
	}
}
