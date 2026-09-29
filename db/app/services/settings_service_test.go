package services

import (
	"context"
	"testing"

	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/structpb"
	"gorm.io/gorm"
)

// newSettingsTestDB is the shared in-memory database plus the settings table,
// which common_service_test.go's helper does not create.
func newSettingsTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := newTestDB(t)
	stmt := `CREATE TABLE settings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NULL,
		key VARCHAR(100) NOT NULL UNIQUE,
		value TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`
	if err := db.Exec(stmt).Error; err != nil {
		t.Fatalf("exec ddl: %v", err)
	}
	return db
}

func newEngineSettingService(t *testing.T, db *gorm.DB) *settingService {
	t.Helper()
	return NewSettingService(repository.NewSettingRepository(db))
}

// A fresh engine: migrated, running, and nothing stored yet.
func TestReadingUnsetSettingsAnswersNothing(t *testing.T) {
	svc := newEngineSettingService(t, newSettingsTestDB(t))
	ctx := context.Background()

	one, err := svc.GetSetting(ctx, &client.GetSettingRequest{Key: "twitch_token"})
	if err != nil {
		t.Fatalf("GetSetting: %v", err)
	}
	if one.Setting != nil {
		t.Fatalf("setting = %+v, want none", one.Setting)
	}

	many, err := svc.GetSettings(ctx, &client.GetSettingsRequest{Keys: []string{"storage.provider"}})
	if err != nil {
		t.Fatalf("GetSettings: %v", err)
	}
	if len(many.Settings) != 0 {
		t.Fatalf("settings = %+v, want none", many.Settings)
	}

	prefixed, err := svc.ListSettingsByPrefix(ctx, &client.ListSettingsRequest{KeyPrefix: "storage."})
	if err != nil {
		t.Fatalf("ListSettingsByPrefix: %v", err)
	}
	if len(prefixed.Settings) != 0 {
		t.Fatalf("settings = %+v, want none", prefixed.Settings)
	}
}

// Settings are keyed by name alone, so a second write to the same key
// replaces the first rather than adding a row.
func TestSetSettingOverwritesByKey(t *testing.T) {
	db := newSettingsTestDB(t)
	svc := newEngineSettingService(t, db)
	ctx := context.Background()

	for _, provider := range []string{"s3", "r2"} {
		if _, err := svc.SetSetting(ctx, &client.SetSettingRequest{
			Key:   "storage.provider",
			Value: structpb.NewStringValue(provider),
		}); err != nil {
			t.Fatalf("SetSetting(%s): %v", provider, err)
		}
	}

	got, err := svc.GetSetting(ctx, &client.GetSettingRequest{Key: "storage.provider"})
	if err != nil {
		t.Fatalf("GetSetting: %v", err)
	}
	if got.Setting.GetValue().GetStringValue() != "r2" {
		t.Fatalf("value = %v, want r2", got.Setting.GetValue())
	}

	var rows int64
	if err := db.Table("settings").Where("key = ?", "storage.provider").Count(&rows).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if rows != 1 {
		t.Fatalf("rows = %d, want 1", rows)
	}
}
