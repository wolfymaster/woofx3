package sqlite

import "testing"

func TestSessionCompactionRowsBelongToTheirCompaction(t *testing.T) {
	db := openMigratedTo(t, "0061_session_compaction")
	const session = "00000000-0000-0000-0000-0000000055a1"
	mustExec(t, db, `INSERT INTO stream_sessions (id, status, started_at, ended_at)
		VALUES (?, 'closed', '2026-09-27 20:00:00', '2026-09-28 20:00:00')`, session)

	if err := db.Exec(`INSERT INTO stream_session_compactions (session_id, window_started_at, window_ended_at, compacted_at)
		VALUES (?, '2026-09-28 20:00:00', '2026-09-27 20:00:00', '2026-09-28 21:00:00')`, session).Error; err == nil {
		t.Error("a window that ends before it starts was accepted")
	}
	mustExec(t, db, `INSERT INTO stream_session_compactions (session_id, window_started_at, window_ended_at, compacted_at)
		VALUES (?, '2026-09-27 20:00:00', '2026-09-28 20:00:00', '2026-09-28 21:00:00')`, session)

	if err := db.Exec(`INSERT INTO viewer_session_totals (session_id, platform, platform_user_id, user_name)
		VALUES (?, 'twitch', 'v1', 'Alice')`, session).Error; err == nil {
		t.Error("a name without the time it was seen was accepted")
	}
	insert := `INSERT INTO viewer_session_totals (session_id, platform, platform_user_id, user_name, last_named_at, bits)
		VALUES (?, 'twitch', 'v1', 'Alice', '2026-09-27 21:00:00', 100)`
	mustExec(t, db, insert, session)
	if err := db.Exec(insert, session).Error; err == nil {
		t.Error("a second totals row for the same viewer and session was accepted")
	}
	if err := db.Exec(`INSERT INTO viewer_session_totals (session_id, platform, platform_user_id, bits)
		VALUES (?, 'twitch', 'v2', -1)`, session).Error; err == nil {
		t.Error("negative bits were accepted")
	}
	if err := db.Exec(`INSERT INTO viewer_session_totals (session_id, platform, platform_user_id)
		VALUES ('00000000-0000-0000-0000-000000000000', 'twitch', 'v1')`).Error; err == nil {
		t.Error("totals for a session never compacted were accepted")
	}
	mustExec(t, db, `INSERT INTO session_timeline_events (session_id, user_event_id, event_id, source, event_type,
		platform, occurred_at, recorded_at)
		VALUES (?, 'e1', 'ce-1', 'twitch', 'channel.follow', 'twitch', '2026-09-27 21:00:00', '2026-09-27 21:00:01')`, session)

	mustExec(t, db, `DELETE FROM stream_sessions WHERE id = ?`, session)
	for _, table := range []string{"stream_session_compactions", "viewer_session_totals", "session_timeline_events"} {
		if n := count(t, db, `SELECT COUNT(*) FROM `+table); n != 0 {
			t.Errorf("%s rows after deleting their session = %d, want 0", table, n)
		}
	}
}
