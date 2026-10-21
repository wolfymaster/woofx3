package services

import (
	"bytes"
	"context"
	"encoding/base64"
	"strings"
	"testing"

	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/secrets"
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

func newTestSettingSeal(t *testing.T) *secrets.SettingSeal {
	t.Helper()
	box, err := secrets.NewBox(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32)))
	if err != nil {
		t.Fatalf("NewBox: %v", err)
	}
	seal, err := secrets.NewSettingSeal(box, SealedSettingKeys())
	if err != nil {
		t.Fatalf("NewSettingSeal: %v", err)
	}
	return seal
}

func newEngineSettingService(t *testing.T, db *gorm.DB) *settingService {
	t.Helper()
	return NewSettingService(repository.NewSettingRepository(db), newTestSettingSeal(t))
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

const twitchTokenJSON = `{"accessToken":"a1","refreshToken":"r1","publicClientId":"public-app"}`

func storedSettingValue(t *testing.T, db *gorm.DB, key string) string {
	t.Helper()
	var value string
	if err := db.Table("settings").Select("value").Where("key = ?", key).Scan(&value).Error; err != nil {
		t.Fatalf("read stored %s: %v", key, err)
	}
	return value
}

// The Twitch token carries a refresh token that lasts until it is used, so it
// rests sealed and every read hands back the plain text that was written.
func TestTwitchTokenIsSealedAtRestAndReadAsWritten(t *testing.T) {
	db := newSettingsTestDB(t)
	svc := newEngineSettingService(t, db)
	ctx := context.Background()

	if _, err := svc.SetSetting(ctx, &client.SetSettingRequest{
		Key:   TwitchTokenSettingKey,
		Value: structpb.NewStringValue(twitchTokenJSON),
	}); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	if raw := storedSettingValue(t, db, TwitchTokenSettingKey); !secrets.IsSealed(raw) || strings.Contains(raw, "r1") {
		t.Fatalf("stored value = %q, want it sealed", raw)
	}

	one, err := svc.GetSetting(ctx, &client.GetSettingRequest{Key: TwitchTokenSettingKey})
	if err != nil {
		t.Fatalf("GetSetting: %v", err)
	}
	if got := one.Setting.GetValue().GetStringValue(); got != twitchTokenJSON {
		t.Fatalf("GetSetting = %q", got)
	}
	many, err := svc.GetSettings(ctx, &client.GetSettingsRequest{Keys: []string{TwitchTokenSettingKey}})
	if err != nil {
		t.Fatalf("GetSettings: %v", err)
	}
	if len(many.Settings) != 1 || many.Settings[0].GetValue().GetStringValue() != twitchTokenJSON {
		t.Fatalf("GetSettings = %+v", many.Settings)
	}
	prefixed, err := svc.ListSettingsByPrefix(ctx, &client.ListSettingsRequest{KeyPrefix: "twitch"})
	if err != nil {
		t.Fatalf("ListSettingsByPrefix: %v", err)
	}
	if prefixed.Settings[TwitchTokenSettingKey] != twitchTokenJSON {
		t.Fatalf("ListSettingsByPrefix = %+v", prefixed.Settings)
	}
}

func TestSetSettingsSealsTheTwitchTokenToo(t *testing.T) {
	db := newSettingsTestDB(t)
	svc := newEngineSettingService(t, db)

	if _, err := svc.SetSettings(context.Background(), &client.SetSettingsRequest{Settings: []*client.SetSettingsRequest_SettingUpdate{
		{Key: TwitchTokenSettingKey, Value: structpb.NewStringValue(twitchTokenJSON)},
		{Key: "storage.provider", Value: structpb.NewStringValue("r2")},
	}}); err != nil {
		t.Fatalf("SetSettings: %v", err)
	}
	if raw := storedSettingValue(t, db, TwitchTokenSettingKey); !secrets.IsSealed(raw) {
		t.Fatalf("stored twitch_token = %q, want it sealed", raw)
	}
	if raw := storedSettingValue(t, db, "storage.provider"); raw != "r2" {
		t.Fatalf("stored storage.provider = %q, want it as written", raw)
	}
}

// Unlinking Twitch writes an empty value, which still reads as unset.
func TestAClearedTwitchTokenStaysEmpty(t *testing.T) {
	db := newSettingsTestDB(t)
	svc := newEngineSettingService(t, db)
	ctx := context.Background()

	for _, value := range []string{twitchTokenJSON, ""} {
		if _, err := svc.SetSetting(ctx, &client.SetSettingRequest{
			Key:   TwitchTokenSettingKey,
			Value: structpb.NewStringValue(value),
		}); err != nil {
			t.Fatalf("SetSetting(%q): %v", value, err)
		}
	}
	if raw := storedSettingValue(t, db, TwitchTokenSettingKey); raw != "" {
		t.Fatalf("stored value = %q, want empty", raw)
	}
	got, err := svc.GetSetting(ctx, &client.GetSettingRequest{Key: TwitchTokenSettingKey})
	if err != nil || got.Setting.GetValue().GetStringValue() != "" {
		t.Fatalf("GetSetting = %+v, %v", got.Setting, err)
	}
}

// A Twitch token written before it was sealed is sealed on start, and read
// back unchanged. Until then it is refused rather than served as plain text.
func TestPlaintextTwitchTokenIsSealedOnStart(t *testing.T) {
	db := newSettingsTestDB(t)
	repo := repository.NewSettingRepository(db)
	seal := newTestSettingSeal(t)
	svc := NewSettingService(repo, seal)
	ctx := context.Background()
	if err := repo.UpsertSetting(TwitchTokenSettingKey, twitchTokenJSON, nil); err != nil {
		t.Fatalf("UpsertSetting: %v", err)
	}
	if err := repo.UpsertSetting("storage.provider", "r2", nil); err != nil {
		t.Fatalf("UpsertSetting: %v", err)
	}

	if _, err := svc.GetSetting(ctx, &client.GetSettingRequest{Key: TwitchTokenSettingKey}); err == nil {
		t.Fatalf("GetSetting served a plain-text twitch_token")
	}

	sealed, err := SealPlaintextSettings(repo, seal)
	if err != nil || sealed != 1 {
		t.Fatalf("SealPlaintextSettings = %d, %v; want 1", sealed, err)
	}
	if raw := storedSettingValue(t, db, TwitchTokenSettingKey); !secrets.IsSealed(raw) {
		t.Fatalf("stored value = %q, want it sealed", raw)
	}
	if raw := storedSettingValue(t, db, "storage.provider"); raw != "r2" {
		t.Fatalf("storage.provider = %q, want it untouched", raw)
	}
	got, err := svc.GetSetting(ctx, &client.GetSettingRequest{Key: TwitchTokenSettingKey})
	if err != nil || got.Setting.GetValue().GetStringValue() != twitchTokenJSON {
		t.Fatalf("GetSetting = %+v, %v", got.Setting, err)
	}

	again, err := SealPlaintextSettings(repo, seal)
	if err != nil || again != 0 {
		t.Fatalf("second SealPlaintextSettings = %d, %v; want 0", again, err)
	}
}

func TestSealPlaintextSettingsLeavesNothingToDoOnAFreshEngine(t *testing.T) {
	db := newSettingsTestDB(t)
	sealed, err := SealPlaintextSettings(repository.NewSettingRepository(db), newTestSettingSeal(t))
	if err != nil || sealed != 0 {
		t.Fatalf("SealPlaintextSettings = %d, %v; want 0", sealed, err)
	}
}

// The startup sealing swaps a row only while it still holds what was read,
// so a token written in between is never replaced by the older one.
func TestCompareAndSetValueKeepsAValueWrittenMeanwhile(t *testing.T) {
	db := newSettingsTestDB(t)
	repo := repository.NewSettingRepository(db)
	if err := repo.UpsertSetting(TwitchTokenSettingKey, "newer", nil); err != nil {
		t.Fatalf("UpsertSetting: %v", err)
	}

	swapped, err := repo.CompareAndSetValue(TwitchTokenSettingKey, "older", "sealed-older")
	if err != nil || swapped {
		t.Fatalf("CompareAndSetValue = %v, %v; want no swap", swapped, err)
	}
	if raw := storedSettingValue(t, db, TwitchTokenSettingKey); raw != "newer" {
		t.Fatalf("stored value = %q, want newer", raw)
	}

	swapped, err = repo.CompareAndSetValue(TwitchTokenSettingKey, "newer", "sealed-newer")
	if err != nil || !swapped {
		t.Fatalf("CompareAndSetValue = %v, %v; want a swap", swapped, err)
	}
}
