package sqlite

import (
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm/schema"
)

// modelsWithTables lists every model in database/models that the SQLite
// schema has a table for. The driver decodes a time.Time only from a column
// declared as a date or time type, so each time.Time field must land on one.
var modelsWithTables = []any{
	&models.Action{}, &models.Alert{}, &models.Asset{}, &models.BackgroundTask{},
	&models.Client{}, &models.Command{}, &models.CommandGroup{}, &models.CommandUser{},
	&models.Group{}, &models.Module{}, &models.ModuleFunction{}, &models.ModuleResource{},
	&models.ModuleResourceInstance{}, &models.ModuleSetting{}, &models.OverlayToken{},
	&models.Permission{}, &models.Resource{}, &models.ResourceReference{}, &models.Scene{},
	&models.SceneEvent{}, &models.SceneEventDelivery{}, &models.SceneEventLogEntry{},
	&models.Setting{}, &models.StreamSession{}, &models.StreamSessionSegment{}, &models.Trigger{},
	&models.User{}, &models.UserEvent{}, &models.UserGroup{}, &models.UserMeta{},
	&models.Widget{}, &models.WidgetSetting{}, &models.WidgetStatus{}, &models.WorkerEvent{},
	&models.WorkflowDefinition{}, &models.WorkflowExecution{}, &models.WorkflowExecutionStep{},
}

func TestEveryModelTimestampIsDeclaredDatetime(t *testing.T) {
	db := openMigratedTo(t, "0049_datetime_columns")
	timeType := reflect.TypeOf(time.Time{})

	for _, model := range modelsWithTables {
		parsed, err := schema.Parse(model, &sync.Map{}, schema.NamingStrategy{})
		if err != nil {
			t.Fatalf("parse %T: %v", model, err)
		}
		declared, err := columnTypes(db, parsed.Table)
		if err != nil {
			t.Fatalf("columns of %s: %v", parsed.Table, err)
		}
		for _, field := range parsed.Fields {
			fieldType := field.FieldType
			for fieldType.Kind() == reflect.Ptr {
				fieldType = fieldType.Elem()
			}
			if fieldType != timeType || field.DBName == "" {
				continue
			}
			columnType, ok := declared[field.DBName]
			if !ok {
				t.Errorf("%s.%s: no such column", parsed.Table, field.DBName)
				continue
			}
			upper := strings.ToUpper(columnType)
			if !strings.Contains(upper, "DATE") && !strings.Contains(upper, "TIME") {
				t.Errorf("%s.%s is declared %q; the driver returns it as a string, which a time.Time cannot scan",
					parsed.Table, field.DBName, columnType)
			}
		}
	}
}

func TestDatetimeColumnsKeepRowsAndValues(t *testing.T) {
	db := openMigratedTo(t, "0048_user_events_fact_log")
	// One value in SQLite's own datetime('now') shape, one in the shape the
	// driver writes a time.Time in.
	mustExec(t, db, `INSERT INTO stream_sessions (id, status, started_at, ended_at)
		VALUES ('00000000-0000-0000-0000-0000000055a1', 'closed', '2026-09-27 20:00:00', '2026-09-27 23:30:00.5-05:00')`)
	mustExec(t, db, `INSERT INTO stream_sessions (id) VALUES ('00000000-0000-0000-0000-0000000055a2')`)
	mustExec(t, db, `INSERT INTO stream_session_segments (id, stream_session_id, started_at, ended_at)
		VALUES ('00000000-0000-0000-0000-00000000e5a1', '00000000-0000-0000-0000-0000000055a1', '2026-09-27 20:00:00', '2026-09-27 21:00:00')`)

	if err := migrateAll(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	var sessions []models.StreamSession
	if err := db.Order("id").Find(&sessions).Error; err != nil {
		t.Fatalf("read stream_sessions: %v", err)
	}
	if len(sessions) != 2 {
		t.Fatalf("stream_sessions rows = %d, want 2", len(sessions))
	}
	wantStart := time.Date(2026, 9, 27, 20, 0, 0, 0, time.UTC)
	if !sessions[0].StartedAt.Equal(wantStart) {
		t.Errorf("started_at = %v, want %v", sessions[0].StartedAt, wantStart)
	}
	wantEnd := time.Date(2026, 9, 28, 4, 30, 0, 500_000_000, time.UTC)
	if sessions[0].EndedAt == nil || !sessions[0].EndedAt.Equal(wantEnd) {
		t.Errorf("ended_at = %v, want %v", sessions[0].EndedAt, wantEnd)
	}
	if sessions[1].EndedAt != nil {
		t.Errorf("open session ended_at = %v, want NULL", sessions[1].EndedAt)
	}
	if sessions[1].CreatedAt.IsZero() {
		t.Error("defaulted created_at read back as zero")
	}

	var segments []models.StreamSessionSegment
	if err := db.Find(&segments).Error; err != nil {
		t.Fatalf("read stream_session_segments: %v", err)
	}
	if len(segments) != 1 {
		t.Fatalf("stream_session_segments rows = %d, want the original 1", len(segments))
	}

	// Constraints come across with the rebuild.
	if err := db.Exec(`INSERT INTO stream_sessions (id) VALUES ('00000000-0000-0000-0000-0000000055a3')`).Error; err == nil {
		t.Error("second open stream session accepted")
	}
	if err := db.Exec(`INSERT INTO stream_session_segments (id, stream_session_id) VALUES ('00000000-0000-0000-0000-00000000e5a2', '00000000-0000-0000-0000-000000000000')`).Error; err == nil {
		t.Error("segment for a missing session accepted")
	}
	mustExec(t, db, `DELETE FROM stream_sessions WHERE id = '00000000-0000-0000-0000-0000000055a1'`)
	if got := count(t, db, `SELECT COUNT(*) FROM stream_session_segments`); got != 0 {
		t.Errorf("segments after deleting their session = %d, want 0", got)
	}

	enabled, err := foreignKeysEnabled(db)
	if err != nil {
		t.Fatalf("read foreign_keys: %v", err)
	}
	if !enabled {
		t.Error("foreign_keys left disabled")
	}
}

func TestDatetimeColumnsRerunIsANoOp(t *testing.T) {
	db := openMigratedTo(t, "0049_datetime_columns")
	before := count(t, db, `SELECT COUNT(*) FROM sqlite_master`)

	if err := DeclareDatetimeColumns().Migrate(db); err != nil {
		t.Fatalf("rerun: %v", err)
	}
	if after := count(t, db, `SELECT COUNT(*) FROM sqlite_master`); after != before {
		t.Errorf("schema objects = %d after a rerun, want %d", after, before)
	}
}
