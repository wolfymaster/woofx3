package sqlite

import "testing"

func TestStreamGaugeSamplesKeepOneRowPerSegmentMinute(t *testing.T) {
	db := openMigratedTo(t, "0050_stream_gauge_samples")
	const session = "00000000-0000-0000-0000-0000000055a1"
	const segment = "00000000-0000-0000-0000-00000000e5a1"
	mustExec(t, db, `INSERT INTO stream_sessions (id, status, started_at) VALUES (?, 'open', '2026-09-27 20:00:00')`, session)
	mustExec(t, db, `INSERT INTO stream_session_segments (id, stream_session_id, started_at) VALUES (?, ?, '2026-09-27 20:00:00')`, segment, session)

	insert := `INSERT INTO stream_gauge_samples (id, segment_id, session_id, sampled_at, viewer_count)
		VALUES (?, ?, ?, '2026-09-27 20:01:00', 12)`
	mustExec(t, db, insert, "s1", segment, session)
	if err := db.Exec(insert, "s2", segment, session).Error; err == nil {
		t.Error("a second sample for the same segment and minute was accepted")
	}

	if err := db.Exec(`INSERT INTO stream_gauge_samples (id, segment_id, session_id, sampled_at)
		VALUES ('s3', ?, ?, '2026-09-27 20:02:00')`, segment, session).Error; err == nil {
		t.Error("a sample with no metric was accepted")
	}
	if err := db.Exec(`INSERT INTO stream_gauge_samples (id, segment_id, session_id, sampled_at, viewer_count)
		VALUES ('s4', ?, ?, '2026-09-27 20:02:00', -1)`, segment, session).Error; err == nil {
		t.Error("a negative viewer count was accepted")
	}
	if err := db.Exec(`INSERT INTO stream_gauge_samples (id, segment_id, session_id, sampled_at, viewer_count)
		VALUES ('s5', '00000000-0000-0000-0000-000000000000', ?, '2026-09-27 20:02:00', 1)`, session).Error; err == nil {
		t.Error("a sample for a missing segment was accepted")
	}

	mustExec(t, db, `DELETE FROM stream_session_segments WHERE id = ?`, segment)
	if n := count(t, db, `SELECT COUNT(*) FROM stream_gauge_samples`); n != 0 {
		t.Errorf("samples after deleting their segment = %d, want 0", n)
	}
}
