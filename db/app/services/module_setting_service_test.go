package services

import (
	"bytes"
	"context"
	"encoding/base64"
	"strings"
	"testing"

	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/secrets"
	"github.com/wolfymaster/woofx3/db/database/models"
)

// memorySettingRepo is an in-memory ModuleSettingRepository keyed like the
// real table's (module_id, key) unique constraint.
type memorySettingRepo struct {
	rows map[string]models.ModuleSetting
}

func newMemorySettingRepo() *memorySettingRepo {
	return &memorySettingRepo{rows: map[string]models.ModuleSetting{}}
}

func (r *memorySettingRepo) ListByModule(moduleID string) ([]models.ModuleSetting, error) {
	out := []models.ModuleSetting{}
	for _, row := range r.rows {
		if row.ModuleID == moduleID {
			out = append(out, row)
		}
	}
	return out, nil
}

func (r *memorySettingRepo) Upsert(s models.ModuleSetting) error {
	r.rows[s.ModuleID+"\x00"+s.Key] = s
	return nil
}

func (r *memorySettingRepo) UpsertDefault(moduleID, key, value, valueType string) error {
	id := moduleID + "\x00" + key
	if _, ok := r.rows[id]; !ok {
		r.rows[id] = models.ModuleSetting{ModuleID: moduleID, Key: key, Value: value, ValueType: valueType}
	}
	return nil
}

func newSettingService(t *testing.T) (*ModuleSettingService, *memorySettingRepo) {
	t.Helper()
	box, err := secrets.NewBox(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32)))
	if err != nil {
		t.Fatalf("NewBox: %v", err)
	}
	repo := newMemorySettingRepo()
	return NewModuleSettingService(repo, box), repo
}

func register(t *testing.T, s *ModuleSettingService, key, valueType string) {
	t.Helper()
	_, err := s.RegisterModuleSettings(context.Background(), &client.RegisterModuleSettingsRequest{
		ModuleId: "example_store",
		Settings: []*client.ManifestSettingInput{{Key: key, Value: "", ValueType: valueType}},
	})
	if err != nil {
		t.Fatalf("RegisterModuleSettings: %v", err)
	}
}

func set(t *testing.T, s *ModuleSettingService, key, value, valueType string) *client.ModuleSettingRecord {
	t.Helper()
	record, err := s.SetModuleSetting(context.Background(), &client.SetModuleSettingRequest{
		ModuleId: "example_store", Key: key, Value: value, ValueType: valueType,
	})
	if err != nil {
		t.Fatalf("SetModuleSetting: %v", err)
	}
	return record
}

func listed(t *testing.T, s *ModuleSettingService, key string) *client.ModuleSettingRecord {
	t.Helper()
	resp, err := s.ListModuleSettings(context.Background(), &client.ListModuleSettingsRequest{ModuleId: "example_store"})
	if err != nil {
		t.Fatalf("ListModuleSettings: %v", err)
	}
	for _, record := range resp.Settings {
		if record.Key == key {
			return record
		}
	}
	t.Fatalf("setting %q not listed", key)
	return nil
}

func secretValues(t *testing.T, s *ModuleSettingService) map[string]string {
	t.Helper()
	resp, err := s.GetModuleSecretValues(context.Background(), &client.GetModuleSecretValuesRequest{ModuleId: "example_store"})
	if err != nil {
		t.Fatalf("GetModuleSecretValues: %v", err)
	}
	return resp.Values
}

func stored(repo *memorySettingRepo, key string) models.ModuleSetting {
	return repo.rows["example_store\x00"+key]
}

func TestSecretSettingIsSealedAtRestAndMaskedOnRead(t *testing.T) {
	s, repo := newSettingService(t)
	register(t, s, "webhookSecret", SecretSettingType)

	record := set(t, s, "webhookSecret", "s3cr3t", SecretSettingType)

	if record.Value != "" || !record.IsSet {
		t.Errorf("set response = value %q, isSet %v", record.Value, record.IsSet)
	}
	if raw := stored(repo, "webhookSecret").Value; !strings.HasPrefix(raw, "v1:") || strings.Contains(raw, "s3cr3t") {
		t.Errorf("stored value = %q", raw)
	}
	if listed := listed(t, s, "webhookSecret"); listed.Value != "" || !listed.IsSet {
		t.Errorf("listed = value %q, isSet %v", listed.Value, listed.IsSet)
	}
	if got := secretValues(t, s)["webhookSecret"]; got != "s3cr3t" {
		t.Errorf("secret value = %q", got)
	}
}

func TestClearingASecretLeavesItUnset(t *testing.T) {
	s, _ := newSettingService(t)
	register(t, s, "webhookSecret", SecretSettingType)
	set(t, s, "webhookSecret", "s3cr3t", SecretSettingType)

	set(t, s, "webhookSecret", "", SecretSettingType)

	if listed(t, s, "webhookSecret").IsSet {
		t.Error("a cleared secret must read as unset")
	}
	if _, ok := secretValues(t, s)["webhookSecret"]; ok {
		t.Error("a cleared secret must not be returned")
	}
}

func TestSetCannotTurnASecretIntoPlainText(t *testing.T) {
	s, repo := newSettingService(t)
	register(t, s, "webhookSecret", SecretSettingType)

	set(t, s, "webhookSecret", "s3cr3t", "text")

	row := stored(repo, "webhookSecret")
	if row.ValueType != SecretSettingType || strings.Contains(row.Value, "s3cr3t") {
		t.Errorf("stored row = %+v", row)
	}
}

func TestPlainSettingsAreReturnedAsIs(t *testing.T) {
	s, _ := newSettingService(t)
	register(t, s, "clientId", "text")
	set(t, s, "clientId", "abc", "text")

	if record := listed(t, s, "clientId"); record.Value != "abc" || !record.IsSet {
		t.Errorf("listed = value %q, isSet %v", record.Value, record.IsSet)
	}
	if _, ok := secretValues(t, s)["clientId"]; ok {
		t.Error("a plain setting is not a secret value")
	}
}

func TestRegisterSealsASettingThatBecomesSecret(t *testing.T) {
	s, repo := newSettingService(t)
	register(t, s, "apiKey", "text")
	set(t, s, "apiKey", "abc", "text")

	register(t, s, "apiKey", SecretSettingType)

	row := stored(repo, "apiKey")
	if row.ValueType != SecretSettingType || strings.Contains(row.Value, "abc") {
		t.Errorf("stored row = %+v", row)
	}
	if got := secretValues(t, s)["apiKey"]; got != "abc" {
		t.Errorf("secret value = %q", got)
	}
}

func TestRegisterClearsASecretThatBecomesPlain(t *testing.T) {
	s, repo := newSettingService(t)
	register(t, s, "apiKey", SecretSettingType)
	set(t, s, "apiKey", "abc", SecretSettingType)

	register(t, s, "apiKey", "text")

	if row := stored(repo, "apiKey"); row.ValueType != "text" || row.Value != "" {
		t.Errorf("stored row = %+v", row)
	}
}

func TestRegisterKeepsAValueWhoseTypeIsUnchanged(t *testing.T) {
	s, repo := newSettingService(t)
	register(t, s, "clientId", "text")
	set(t, s, "clientId", "abc", "text")

	register(t, s, "clientId", "text")

	if row := stored(repo, "clientId"); row.Value != "abc" {
		t.Errorf("stored row = %+v", row)
	}
}
