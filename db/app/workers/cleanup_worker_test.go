package workers

import (
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/google/uuid"
	gsqlite "github.com/libtnb/sqlite"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations"
	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

func openCleanupDb(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(gsqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := database.RegisterIDAssignment(db, database.RandomIDs{}); err != nil {
		t.Fatalf("register id assignment: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	// Every connection to :memory: is a separate database.
	sqlDB.SetMaxOpenConns(1)
	chain, err := migrations.For(database.DialectSQLite)
	if err != nil {
		t.Fatalf("migrations.For: %v", err)
	}
	if err := gormigrate.New(db, migrations.Options, chain).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

// A session that ended before compaction existed is compacted by the first
// pass and only then loses its old raw rows; the open session keeps its own
// however old they are.
func TestCleanupCompactsEndedSessionsBeforePruningThem(t *testing.T) {
	db := openCleanupDb(t)
	sessions := repository.NewStreamSessionRepository(db)
	events := repository.NewUserEventRepository(db)
	started := time.Now().UTC().Add(-30 * 24 * time.Hour)
	split := started.Add(4 * time.Hour)
	if _, _, err := sessions.EnsureOpenSession(started); err != nil {
		t.Fatalf("EnsureOpenSession: %v", err)
	}
	ended, open, err := sessions.SplitSession(split)
	if err != nil {
		t.Fatalf("SplitSession: %v", err)
	}
	record := func(at time.Time, amount int64) {
		t.Helper()
		user := "1001"
		name := "Alice"
		if _, _, err := events.Record(&models.UserEvent{
			ID: uuid.New(), EventID: uuid.NewString(), Source: "twitch", EventType: models.UserEventTypeCheer,
			Platform: "twitch", PlatformUserID: &user, UserName: &name, Amount: &amount, EventValue: "{}",
			OccurredAt: at, CreatedAt: time.Now().UTC(),
		}); err != nil {
			t.Fatalf("Record: %v", err)
		}
	}
	record(started.Add(time.Hour), 100)
	record(split.Add(time.Hour), 50)

	worker := NewCleanupWorker(CleanupRepositories{
		Outbox:     repository.NewDbEventRepository(db),
		Facts:      repository.NewViewerFactRepository(db),
		UserEvents: events,
		Alerts:     repository.NewAlertRepository(db),
		Workflows:  repository.NewWorkflowRepository(db, database.RandomIDs{}),
	}, slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CleanupInterval:       time.Hour,
		RetentionPeriod:       7 * 24 * time.Hour,
		FactDedupeRetention:   time.Hour,
		FactDedupePruneBatch:  10,
		EventDetailRetention:  7 * 24 * time.Hour,
		EventDetailPruneBatch: 10,
	})
	if err := worker.cleanup(); err != nil {
		t.Fatalf("cleanup: %v", err)
	}

	compaction, err := events.Compaction(ended.ID)
	if err != nil || compaction == nil || compaction.PrunedAt == nil {
		t.Fatalf("ended session's compaction = %+v (%v), want one marked pruned", compaction, err)
	}
	if compaction, err := events.Compaction(open.ID); err != nil || compaction != nil {
		t.Fatalf("open session's compaction = %+v (%v), want none", compaction, err)
	}
	var left []models.UserEvent
	if err := db.Find(&left).Error; err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(left) != 1 || *left[0].Amount != 50 {
		t.Fatalf("raw rows left = %d, want only the open session's cheer", len(left))
	}
	totals, err := events.CompactedViewerTotals(ended.ID, "twitch", "1001")
	if err != nil || totals.Bits != 100 {
		t.Fatalf("ended session's compacted bits = %+v (%v), want 100", totals, err)
	}
}

func TestCleanupRefusesANonPositiveDetailRetention(t *testing.T) {
	db := openCleanupDb(t)
	worker := &CleanupWorker{
		repos: CleanupRepositories{
			UserEvents: repository.NewUserEventRepository(db),
			Alerts:     repository.NewAlertRepository(db),
			Workflows:  repository.NewWorkflowRepository(db, database.RandomIDs{}),
		},
		logger:                slog.New(slog.NewTextHandler(io.Discard, nil)),
		eventDetailPruneBatch: 10,
	}
	if err := worker.pruneEventDetail(); err == nil {
		t.Fatal("a zero retention pruned instead of refusing")
	}
}
