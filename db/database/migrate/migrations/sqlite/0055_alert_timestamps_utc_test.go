package sqlite

import (
	"testing"
	"time"
)

func TestNormaliseAlertTimestampsOrdersRowsOfEveryStoredLayoutByTime(t *testing.T) {
	db := openMigratedTo(t, "0054_alert_version")
	pacific := time.FixedZone("PST", -8*60*60)
	// Each layout a row may hold, in time order a, b, c, d. As text they sort
	// b, a, c, d: a row in local time sorts by its wall clock, not its instant.
	rows := []struct {
		id        string
		createdAt string
		want      string
	}{
		// SQLite's datetime('now'), a column default: UTC, whole seconds.
		{"a", "2026-03-08 09:00:00", "2026-03-08 09:00:00.000000+00:00"},
		// The driver's time.String(), in a zone west of UTC.
		{"b", time.Date(2026, 3, 8, 9, 30, 0, 500000000, time.UTC).In(pacific).String(),
			"2026-03-08 09:30:00.500000+00:00"},
		// The repository's own layout.
		{"c", "2026-03-08 09:15:00.000001+00:00", "2026-03-08 09:15:00.000001+00:00"},
		// time.String() with a monotonic reading, east of UTC.
		{"d", "2026-03-08 10:45:00.123456789 +0100 CET m=+0.000012345", "2026-03-08 09:45:00.123456+00:00"},
	}
	for _, row := range rows {
		mustExec(t, db, `INSERT INTO alerts (id, payload, created_at, updated_at, completed_at) VALUES (?, '{}', ?, ?, ?)`,
			row.id, row.createdAt, row.createdAt, nil)
	}

	if err := migrateAll(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	var stored []struct {
		ID          string
		CreatedAt   string
		UpdatedAt   string
		CompletedAt *string
	}
	err := db.Raw(`SELECT id, CAST(created_at AS TEXT) AS created_at, CAST(updated_at AS TEXT) AS updated_at,
		CAST(completed_at AS TEXT) AS completed_at FROM alerts ORDER BY created_at`).Scan(&stored).Error
	if err != nil {
		t.Fatalf("read alerts: %v", err)
	}
	wantOrder := []string{"a", "c", "b", "d"}
	if len(stored) != len(wantOrder) {
		t.Fatalf("read %d rows, want %d", len(stored), len(wantOrder))
	}
	want := map[string]string{}
	for _, row := range rows {
		want[row.id] = row.want
	}
	for i, row := range stored {
		if row.ID != wantOrder[i] {
			t.Fatalf("row %d is %s, want %s (order %v)", i, row.ID, wantOrder[i], wantOrder)
		}
		if row.CreatedAt != want[row.ID] || row.UpdatedAt != want[row.ID] {
			t.Fatalf("row %s: created_at %q, updated_at %q, want %q", row.ID, row.CreatedAt, row.UpdatedAt, want[row.ID])
		}
		if row.CompletedAt != nil {
			t.Fatalf("row %s: completed_at = %q, want NULL kept", row.ID, *row.CompletedAt)
		}
	}
}
