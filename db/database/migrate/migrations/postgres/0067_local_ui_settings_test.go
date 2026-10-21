package postgres

import (
	"testing"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/db/database/repository"
)

func TestLocalUISettingsWriteUnderOneCounter(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	repo := repository.NewLocalUISettingRepository(db)
	at := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	value := `{"widgets":[]}`

	first, err := repo.Write(repository.LocalUISettingWrite{Namespace: "dashboardLayouts", Key: "main", Value: &value, At: at})
	if err != nil {
		t.Fatalf("first Write: %v", err)
	}
	second, err := repo.Write(repository.LocalUISettingWrite{Namespace: "macros", Key: "m1", Value: &value, At: at})
	if err != nil {
		t.Fatalf("second Write: %v", err)
	}
	if first.Setting.Revision != 1 || second.Setting.Revision != 2 {
		t.Fatalf("revisions = %d, %d, want 1, 2", first.Setting.Revision, second.Setting.Revision)
	}

	stale := int64(1)
	refused, err := repo.Write(repository.LocalUISettingWrite{Namespace: "macros", Key: "m1", ExpectedRevision: &stale, At: at})
	if err != nil {
		t.Fatalf("stale Write: %v", err)
	}
	if !refused.Conflict || refused.Setting.Revision != 2 {
		t.Fatalf("stale delete = %+v, want a conflict carrying revision 2", refused)
	}

	deleted, err := repo.Write(repository.LocalUISettingWrite{Namespace: "macros", Key: "m1", At: at})
	if err != nil {
		t.Fatalf("delete Write: %v", err)
	}
	if !deleted.Setting.Deleted || deleted.Setting.Revision != 3 {
		t.Fatalf("delete = %+v, want a tombstone at revision 3", deleted.Setting)
	}
}
