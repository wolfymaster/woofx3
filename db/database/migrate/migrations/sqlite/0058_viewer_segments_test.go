package sqlite

import "testing"

func TestViewerSegmentTablesKeepOneMembershipPerViewer(t *testing.T) {
	db := openMigratedTo(t, "0058_viewer_segments")
	mustExec(t, db, `INSERT INTO fact_definitions (id, name, definition, aggregate_fn, value_kind, window_kind)
		VALUES ('user:fact:messages', 'Messages', '{}', 'count', 'number', 'lifetime')`)
	mustExec(t, db, `INSERT INTO segment_definitions (id, name, condition, window_kind)
		VALUES ('user:segment:chatty', 'Chatty', '{}', 'lifetime')`)
	if err := db.Exec(`INSERT INTO segment_definitions (id, name, condition, window_kind)
		VALUES ('user:segment:bad', 'Bad', '{}', 'rolling')`).Error; err == nil {
		t.Error("an unknown window kind was accepted")
	}
	mustExec(t, db, `INSERT INTO segment_facts (segment_id, fact_id) VALUES ('user:segment:chatty', 'user:fact:messages')`)
	if err := db.Exec(`INSERT INTO segment_facts (segment_id, fact_id) VALUES ('user:segment:chatty', 'user:fact:missing')`).Error; err == nil {
		t.Error("a segment reading a missing fact was accepted")
	}
	if err := db.Exec(`DELETE FROM fact_definitions WHERE id = 'user:fact:messages'`).Error; err == nil {
		t.Error("a fact a segment reads was deleted")
	}

	insert := `INSERT INTO segment_members (segment_id, platform, subject_id) VALUES ('user:segment:chatty', 'twitch', 'v1')`
	mustExec(t, db, insert)
	if err := db.Exec(`INSERT INTO segment_members (segment_id, platform, subject_id, window_key)
		VALUES ('user:segment:chatty', 'twitch', 'v1', 'session-2')`).Error; err == nil {
		t.Error("a second membership of one viewer in another window was accepted")
	}

	mustExec(t, db, `DELETE FROM segment_definitions WHERE id = 'user:segment:chatty'`)
	if n := count(t, db, `SELECT COUNT(*) FROM segment_members`); n != 0 {
		t.Errorf("members after deleting their segment = %d, want 0", n)
	}
	if n := count(t, db, `SELECT COUNT(*) FROM segment_facts`); n != 0 {
		t.Errorf("segment facts after deleting their segment = %d, want 0", n)
	}
	mustExec(t, db, `DELETE FROM fact_definitions WHERE id = 'user:fact:messages'`)
	mustExec(t, db, `SELECT extensions FROM worker_events LIMIT 0`)
	mustExec(t, db, `INSERT INTO segment_definitions (id, name, condition, window_kind) VALUES ('user:segment:fresh', 'Fresh', '{}', 'lifetime')`)
	if n := count(t, db, `SELECT COUNT(*) FROM segment_definitions WHERE id = 'user:segment:fresh' AND stale = 0`); n != 1 {
		t.Error("a new segment was not fresh")
	}
}
