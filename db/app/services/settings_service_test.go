package services

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

// newSettingsTestDB is the shared in-memory database plus the settings table,
// which common_service_test.go's helper does not create.
func newSettingsTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := newTestDB(t)
	stmt := `CREATE TABLE settings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		application_id TEXT NOT NULL,
		user_id TEXT NULL,
		key VARCHAR(100) NOT NULL,
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

// A fresh engine: migrated, running, and nothing registered yet.
func TestReadingSettingsBeforeOnboardingAnswersNothing(t *testing.T) {
	svc := newEngineSettingService(t, newSettingsTestDB(t))
	ctx := context.Background()

	one, err := svc.GetSetting(ctx, &client.GetSettingRequest{Key: "twitch_token"})
	if err != nil {
		t.Fatalf("GetSetting before onboarding: %v", err)
	}
	if one.Setting != nil {
		t.Fatalf("setting = %+v, want none", one.Setting)
	}

	many, err := svc.GetSettings(ctx, &client.GetSettingsRequest{Keys: []string{"storage.provider"}})
	if err != nil {
		t.Fatalf("GetSettings before onboarding: %v", err)
	}
	if len(many.Settings) != 0 {
		t.Fatalf("settings = %+v, want none", many.Settings)
	}

	prefixed, err := svc.ListSettingsByPrefix(ctx, &client.ListSettingsRequest{KeyPrefix: "storage."})
	if err != nil {
		t.Fatalf("ListSettingsByPrefix before onboarding: %v", err)
	}
	if len(prefixed.Settings) != 0 {
		t.Fatalf("settings = %+v, want none", prefixed.Settings)
	}
}

// Writing one still fails: there is nowhere to put it.
func TestWritingASettingBeforeOnboardingIsRefused(t *testing.T) {
	svc := newEngineSettingService(t, newSettingsTestDB(t))

	_, err := svc.SetSetting(context.Background(), &client.SetSettingRequest{Key: "storage.provider"})

	assertTwirpCode(t, err, twirp.NotFound)
}

func TestReadingSettingsAfterOnboardingIsUnchanged(t *testing.T) {
	db := newSettingsTestDB(t)
	applicationID := uuid.New()
	if err := db.Exec(
		`INSERT INTO applications (id, name, user_id, is_default) VALUES (?, ?, ?, 1)`,
		applicationID.String(), "default", uuid.New().String(),
	).Error; err != nil {
		t.Fatalf("seed application: %v", err)
	}
	if err := db.Exec(
		`INSERT INTO settings (application_id, key, value) VALUES (?, ?, ?)`,
		applicationID.String(), "storage.provider", "s3",
	).Error; err != nil {
		t.Fatalf("seed setting: %v", err)
	}
	svc := newEngineSettingService(t, db)

	got, err := svc.GetSetting(context.Background(), &client.GetSettingRequest{Key: "storage.provider"})
	if err != nil {
		t.Fatalf("GetSetting: %v", err)
	}
	if got.Setting.GetValue().GetStringValue() != "s3" {
		t.Fatalf("value = %v, want s3", got.Setting.GetValue())
	}
}
