package sqlite

import "testing"

func TestViewerFactTablesHoldOneValuePerViewerWindow(t *testing.T) {
	db := openMigratedTo(t, "0056_viewer_facts")
	mustExec(t, db, `INSERT INTO fact_definitions (id, name, definition, value_kind, window_kind)
		VALUES ('user:fact:messages', 'Messages', '{}', 'number', 'lifetime')`)

	if err := db.Exec(`INSERT INTO fact_definitions (id, name, definition, value_kind, window_kind)
		VALUES ('user:fact:bad', 'Bad', '{}', 'number', 'rolling')`).Error; err == nil {
		t.Error("an unknown window kind was accepted")
	}
	if err := db.Exec(`INSERT INTO fact_definitions (id, name, definition, value_kind, window_kind, revision)
		VALUES ('user:fact:bad', 'Bad', '{}', 'number', 'lifetime', 0)`).Error; err == nil {
		t.Error("revision 0 was accepted")
	}

	insert := `INSERT INTO fact_values (fact_id, platform, subject_id, num_value) VALUES ('user:fact:messages', 'twitch', 'v1', 1)`
	mustExec(t, db, insert)
	if err := db.Exec(insert).Error; err == nil {
		t.Error("a second lifetime value for the same viewer was accepted")
	}
	mustExec(t, db, `INSERT INTO fact_values (fact_id, platform, subject_id, window_key, num_value)
		VALUES ('user:fact:messages', 'twitch', 'v1', 'session-1', 1)`)
	if err := db.Exec(`INSERT INTO fact_values (fact_id, platform, subject_id, num_value)
		VALUES ('user:fact:missing', 'twitch', 'v1', 1)`).Error; err == nil {
		t.Error("a value for a missing definition was accepted")
	}

	mustExec(t, db, `DELETE FROM fact_definitions WHERE id = 'user:fact:messages'`)
	if n := count(t, db, `SELECT COUNT(*) FROM fact_values`); n != 0 {
		t.Errorf("values after deleting their definition = %d, want 0", n)
	}

	mustExec(t, db, `INSERT INTO fact_applied_events (source, event_id) VALUES ('twitch', 'e1')`)
	if err := db.Exec(`INSERT INTO fact_applied_events (source, event_id) VALUES ('twitch', 'e1')`).Error; err == nil {
		t.Error("an event was recorded as applied twice")
	}
}
