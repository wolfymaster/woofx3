package sqlite

import "testing"

// A step links one composition, and a composition with links cannot be
// deleted out from under them.
func TestAddCompositionLinksKeepsOneLinkPerStepAndProtectsTheComposition(t *testing.T) {
	db := openMigratedTo(t, "0061_composition_links")
	const alert = "00000000-0000-0000-0000-0000000000d1"
	mustExec(t, db, `INSERT INTO scenes (id, name, kind) VALUES (?, 'Follow', 'alert')`, alert)
	mustExec(t, db, `INSERT INTO composition_links (id, composition_id, owner_kind, owner_id, step_id)
		VALUES ('l1', ?, 'workflow', 'wf-1', 'step-1')`, alert)

	if err := db.Exec(`INSERT INTO composition_links (id, composition_id, owner_kind, owner_id, step_id)
		VALUES ('l2', ?, 'workflow', 'wf-1', 'step-1')`, alert).Error; err == nil {
		t.Fatalf("one step linked twice")
	}
	if err := db.Exec(`INSERT INTO composition_links (id, composition_id, owner_kind, owner_id, step_id)
		VALUES ('l3', ?, 'module', 'm', 'step-1')`, alert).Error; err == nil {
		t.Fatalf("a link with an unknown owner kind was stored")
	}
	if err := db.Exec(`DELETE FROM scenes WHERE id = ?`, alert).Error; err == nil {
		t.Fatalf("a linked composition was deleted")
	}
	mustExec(t, db, `DELETE FROM composition_links WHERE id = 'l1'`)
	mustExec(t, db, `DELETE FROM scenes WHERE id = ?`, alert)
}
