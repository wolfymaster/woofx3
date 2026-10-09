package postgres

import (
	"strings"
	"testing"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

func TestViewerSegmentTablesOnPostgres(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	mustExec(t, db, `INSERT INTO fact_definitions (id, name, definition, aggregate_fn, value_kind, window_kind)
		VALUES ('user:fact:messages', 'Messages', '{}', 'count', 'number', 'lifetime')`)
	mustExec(t, db, `INSERT INTO segment_definitions (id, name, condition, window_kind)
		VALUES ('user:segment:chatty', 'Chatty', '{"fact":"user:fact:messages","op":"gte","value":10}', 'lifetime')`)
	mustExec(t, db, `INSERT INTO segment_facts (segment_id, fact_id) VALUES ('user:segment:chatty', 'user:fact:messages')`)
	if err := db.Exec(`DELETE FROM fact_definitions WHERE id = 'user:fact:messages'`).Error; err == nil {
		t.Error("a fact a segment reads was deleted")
	}

	longID := "some_module_with_a_long_id:segment:" + strings.Repeat("x", 100)
	mustExec(t, db, `INSERT INTO worker_events (event_type, entity_type, entity_id, operation, payload, nats_subject, extensions)
		VALUES ('viewer.segment.entered', 'viewer.segment', ?, 'entered', '{}', 'viewer.segment.entered', '{"platform":"twitch"}')`, longID)
}

// The SQLite chain covers the membership rules; this covers the statements
// Postgres plans differently: the conditional upsert, the tuple delete, the
// share lock over a subquery and the advisory lock.
func TestViewerSegmentMembershipStatementsOnPostgres(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	mustExec(t, db, `INSERT INTO fact_definitions (id, name, definition, aggregate_fn, value_kind, window_kind)
		VALUES ('user:fact:messages', 'Messages', '{}', 'count', 'number', 'session')`)
	segments := repository.NewViewerSegmentRepository(db)
	definition := &models.SegmentDefinition{
		ID: "user:segment:chatty", Name: "Chatty", Condition: `{"fact":"user:fact:messages","op":"gte","value":3}`,
		WindowKind: models.FactWindowSession, CreatedByType: "USER",
	}
	record := func(*gorm.DB, *models.SegmentDefinition, repository.SegmentDefinitionWrite) error { return nil }
	if _, _, err := segments.UpsertDefinition(definition, []string{"user:fact:messages"}, record); err != nil {
		t.Fatalf("define: %v", err)
	}

	err := db.Transaction(func(tx *gorm.DB) error {
		txSegments := segments.WithDB(tx)
		viewer := repository.ViewerKey{Platform: "twitch", SubjectID: "v1"}
		if err := txSegments.LockViewer(viewer); err != nil {
			return err
		}
		dependents, err := txSegments.DependentSegments([]string{"user:fact:messages"})
		if err != nil || len(dependents) != 1 {
			t.Errorf("DependentSegments = %d, %v", len(dependents), err)
		}
		locked, err := txSegments.DependentSegmentsForUpdate([]string{"user:fact:messages"})
		if err != nil || len(locked) != 1 {
			t.Errorf("DependentSegmentsForUpdate = %d, %v", len(locked), err)
		}
		member := models.SegmentMember{SegmentID: definition.ID, Platform: "twitch", SubjectID: "v1", WindowKey: "s1", EnteredAt: time.Now().UTC()}
		for i, want := range []bool{true, false} {
			if wrote, err := txSegments.Enter(member); err != nil || wrote != want {
				t.Errorf("Enter %d = %v, %v; want %v", i, wrote, err, want)
			}
		}
		member.WindowKey = "s2"
		if wrote, err := txSegments.Enter(member); err != nil || !wrote {
			t.Errorf("Enter in the next window = %v, %v", wrote, err)
		}
		bulk := []models.SegmentMember{member, {SegmentID: definition.ID, Platform: "twitch", SubjectID: "v2", WindowKey: "s2", EnteredAt: member.EnteredAt}}
		if err := txSegments.EnterAll(bulk); err != nil {
			return err
		}
		return txSegments.LeaveAll(definition.ID, []repository.ViewerKey{viewer, {Platform: "twitch", SubjectID: "v2"}})
	})
	if err != nil {
		t.Fatalf("membership statements: %v", err)
	}
	if n := count(t, db, `SELECT COUNT(*) FROM segment_members`); n != 0 {
		t.Fatalf("members left = %d, want 0", n)
	}
}
