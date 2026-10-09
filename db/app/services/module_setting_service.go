package services

import (
	"context"
	"fmt"
	"log"

	"github.com/twitchtv/twirp"

	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/secrets"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

// SecretSettingType is the value_type of a setting the end user enters as a
// secret. Its value is sealed at rest and never returned by
// ListModuleSettings; only GetModuleSecretValues opens it.
const SecretSettingType = "secret"

// SettingChangePublisher announces a written setting on the outbox.
type SettingChangePublisher interface {
	Publish(opts workers.PublishOptions) error
}

type ModuleSettingService struct {
	repo      repo.ModuleSettingRepository
	secrets   *secrets.Box
	publisher SettingChangePublisher
}

// NewModuleSettingService builds the service. A nil publisher writes settings
// without announcing them.
func NewModuleSettingService(r repo.ModuleSettingRepository, box *secrets.Box, publisher SettingChangePublisher) *ModuleSettingService {
	if box == nil {
		panic("module settings need a secrets box: secret values must never be stored in plain text")
	}
	return &ModuleSettingService{repo: r, secrets: box, publisher: publisher}
}

func (s *ModuleSettingService) ListModuleSettings(ctx context.Context, req *client.ListModuleSettingsRequest) (*client.ListModuleSettingsResponse, error) {
	rows, err := s.repo.ListByModule(req.ModuleId)
	if err != nil {
		return nil, err
	}
	records := make([]*client.ModuleSettingRecord, 0, len(rows))
	for _, r := range rows {
		records = append(records, toProtoSetting(r))
	}
	return &client.ListModuleSettingsResponse{Settings: records}, nil
}

// SetModuleSetting writes a value. The stored type wins over the request's:
// a caller can change a value but never turn a secret into plain text.
func (s *ModuleSettingService) SetModuleSetting(ctx context.Context, req *client.SetModuleSettingRequest) (*client.ModuleSettingRecord, error) {
	rows, err := s.repo.ListByModule(req.ModuleId)
	if err != nil {
		return nil, err
	}
	valueType := req.ValueType
	if existing, ok := findSetting(rows, req.Key); ok {
		valueType = existing.ValueType
	}
	value, err := s.storedValue(req.ModuleId, req.Key, valueType, req.Value)
	if err != nil {
		return nil, err
	}
	row := models.ModuleSetting{
		ModuleID:  req.ModuleId,
		Key:       req.Key,
		Value:     value,
		ValueType: valueType,
	}
	if err := s.repo.Upsert(row); err != nil {
		return nil, err
	}
	rows, err = s.repo.ListByModule(req.ModuleId)
	if err != nil {
		return nil, err
	}
	saved, ok := findSetting(rows, req.Key)
	if !ok {
		return nil, fmt.Errorf("setting key %q not found after upsert", req.Key)
	}
	s.publishChange(saved)
	return toProtoSetting(saved), nil
}

// CompareAndSetModuleSetting writes a value only while the setting still holds
// the expected one, so concurrent read-modify-write updates, such as two
// function runs each adding an entry to a list, can't lose one another's
// change. A secret is refused: its stored value is sealed, so there is nothing
// to compare the caller's against. A refusal answers with the value stored
// now, for the caller to retry from.
func (s *ModuleSettingService) CompareAndSetModuleSetting(ctx context.Context, req *client.CompareAndSetModuleSettingRequest) (*client.CompareAndSetModuleSettingResponse, error) {
	rows, err := s.repo.ListByModule(req.ModuleId)
	if err != nil {
		return nil, err
	}
	existing, ok := findSetting(rows, req.Key)
	if !ok {
		return &client.CompareAndSetModuleSettingResponse{Swapped: false}, nil
	}
	if existing.ValueType == SecretSettingType {
		return nil, twirp.InvalidArgumentError("key", "a secret setting cannot be compared and set")
	}
	swapped, err := s.repo.CompareAndSet(req.ModuleId, req.Key, req.ExpectedValue, req.Value)
	if err != nil {
		return nil, err
	}
	rows, err = s.repo.ListByModule(req.ModuleId)
	if err != nil {
		return nil, err
	}
	current, ok := findSetting(rows, req.Key)
	if !ok {
		return &client.CompareAndSetModuleSettingResponse{Swapped: false}, nil
	}
	if swapped {
		s.publishChange(current)
	}
	return &client.CompareAndSetModuleSettingResponse{Swapped: swapped, Current: toProtoSetting(current)}, nil
}

// publishChange announces a written setting as `db.module.setting.updated`,
// so a service that acts on a module's settings, such as the scene manager's
// OBS connection, applies a change without a restart. The payload names the
// setting and never carries its value: a secret must not reach the bus.
func (s *ModuleSettingService) publishChange(setting models.ModuleSetting) {
	if s.publisher == nil {
		return
	}
	err := s.publisher.Publish(workers.PublishOptions{
		EntityType:      "module.setting",
		EntityID:        setting.ModuleID + "/" + setting.Key,
		Operation:       "updated",
		Data:            map[string]string{"moduleId": setting.ModuleID, "key": setting.Key},
		AutoAcknowledge: true,
	})
	if err != nil {
		// The write already succeeded; a lost announcement only delays the
		// change until the listening service next reads the setting.
		log.Printf("module %s: announcing setting %q failed: %v", setting.ModuleID, setting.Key, err)
	}
}

// GetModuleSecretValues opens the module's secret settings. Its callers are
// barkloader, building `ctx.module.settings` for the owning module's own
// functions, and the scene manager, reading the OBS module's WebSocket
// password to open the connection the module's functions reach through
// `ctx.obs`.
func (s *ModuleSettingService) GetModuleSecretValues(ctx context.Context, req *client.GetModuleSecretValuesRequest) (*client.GetModuleSecretValuesResponse, error) {
	rows, err := s.repo.ListByModule(req.ModuleId)
	if err != nil {
		return nil, err
	}
	values := make(map[string]string)
	for _, r := range rows {
		if r.ValueType != SecretSettingType || r.Value == "" {
			continue
		}
		plaintext, err := s.secrets.Open(r.ModuleID, r.Key, r.Value)
		if err != nil {
			// A changed WOOFX3_SECRETS_KEY leaves every stored secret
			// unreadable; the user re-enters it. Never log the value.
			log.Printf("module %s: secret setting %q cannot be opened: %v", r.ModuleID, r.Key, err)
			continue
		}
		values[r.Key] = plaintext
	}
	return &client.GetModuleSecretValuesResponse{Values: values}, nil
}

// RegisterModuleSettings adds the manifest's settings, keeping every value a
// user already configured. A setting whose declared type changed is
// re-typed, and its value carried across (see retypedValue).
func (s *ModuleSettingService) RegisterModuleSettings(ctx context.Context, req *client.RegisterModuleSettingsRequest) (*client.RegisterModuleSettingsResponse, error) {
	existing, err := s.repo.ListByModule(req.ModuleId)
	if err != nil {
		return nil, err
	}
	registered := int32(0)
	for _, input := range req.Settings {
		current, ok := findSetting(existing, input.Key)
		switch {
		case !ok:
			value, err := s.storedValue(req.ModuleId, input.Key, input.ValueType, input.Value)
			if err != nil {
				return nil, err
			}
			if err := s.repo.UpsertDefault(req.ModuleId, input.Key, value, input.ValueType); err != nil {
				return nil, err
			}
		case current.ValueType != input.ValueType:
			value, err := s.retypedValue(current, input.ValueType)
			if err != nil {
				return nil, err
			}
			row := models.ModuleSetting{
				ModuleID:  req.ModuleId,
				Key:       input.Key,
				Value:     value,
				ValueType: input.ValueType,
			}
			if err := s.repo.Upsert(row); err != nil {
				return nil, err
			}
		}
		registered++
	}
	return &client.RegisterModuleSettingsResponse{Registered: registered}, nil
}

// storedValue is what goes in the value column: a secret is sealed, and an
// empty value is left empty so it reads as unset.
func (s *ModuleSettingService) storedValue(moduleID, key, valueType, value string) (string, error) {
	if valueType != SecretSettingType || value == "" {
		return value, nil
	}
	return s.secrets.Seal(moduleID, key, value)
}

// retypedValue carries a stored value across a manifest type change. A value
// that becomes secret is sealed in place; a secret that stops being one is
// cleared, never decrypted into plain text.
func (s *ModuleSettingService) retypedValue(current models.ModuleSetting, newType string) (string, error) {
	switch {
	case newType == SecretSettingType:
		return s.storedValue(current.ModuleID, current.Key, newType, current.Value)
	case current.ValueType == SecretSettingType:
		return "", nil
	default:
		return current.Value, nil
	}
}

func findSetting(rows []models.ModuleSetting, key string) (models.ModuleSetting, bool) {
	for _, r := range rows {
		if r.Key == key {
			return r, true
		}
	}
	return models.ModuleSetting{}, false
}

func toProtoSetting(r models.ModuleSetting) *client.ModuleSettingRecord {
	record := &client.ModuleSettingRecord{
		Id:        r.ID.String(),
		ModuleId:  r.ModuleID,
		Key:       r.Key,
		Value:     r.Value,
		ValueType: r.ValueType,
		IsSet:     r.Value != "",
	}
	if r.ValueType == SecretSettingType {
		record.Value = ""
	}
	return record
}
