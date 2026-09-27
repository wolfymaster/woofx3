package sqlite

import (
	"strings"
	"testing"
)

func TestUserEventsRebuildCreatesTheFactLog(t *testing.T) {
	db := openMigratedTo(t, "0048_user_events_fact_log")

	for _, column := range []string{"event_id", "source", "platform_user_id", "session_id", "amount", "occurred_at"} {
		ok, err := columnExists(db, "user_events", column)
		if err != nil {
			t.Fatalf("columnExists(%s): %v", column, err)
		}
		if !ok {
			t.Fatalf("user_events.%s missing", column)
		}
	}

	insert := `INSERT INTO user_events (id, event_id, source, event_type, platform, occurred_at)
		VALUES (?, 'ce-1', 'twitch', 'channel.follow', 'twitch', '2026-09-27 20:00:00')`
	mustExec(t, db, insert, "row-1")
	if err := db.Exec(insert, "row-2").Error; err == nil {
		t.Fatalf("a second row with the same source and event_id was accepted")
	}
}

func TestUserEventsRebuildRefusesToDiscardRows(t *testing.T) {
	db := openMigratedTo(t, "0047_drop_applications")
	mustExec(t, db, `INSERT INTO users (id, username, user_id) VALUES (?, 'wolfy', '42')`, testUserID)
	mustExec(t, db, `INSERT INTO user_events (id, user_id, event_type) VALUES ('e1', ?, 'follow')`, testUserID)

	err := migrateAll(db)
	if err == nil || !strings.Contains(err.Error(), "will not discard") {
		t.Fatalf("err = %v, want a refusal to discard rows", err)
	}
	if n := count(t, db, `SELECT COUNT(*) FROM user_events`); n != 1 {
		t.Fatalf("user_events rows = %d, want the original 1", n)
	}
}
