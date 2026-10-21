package services

import (
	"context"
	"errors"
	"strconv"

	"github.com/google/uuid"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/secrets"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/structpb"
	"gorm.io/gorm"
)

// settingService serves the engine's settings. The values of the keys `seal`
// names are sealed at rest; every read and write here goes through it, so
// callers only ever see plain text.
type settingService struct {
	repo *repository.SettingRepository
	seal *secrets.SettingSeal
}

func NewSettingService(repo *repository.SettingRepository, seal *secrets.SettingSeal) *settingService {
	if seal == nil {
		panic("the settings service needs its sealed settings: credentials must never be stored in plain text")
	}
	return &settingService{repo: repo, seal: seal}
}

func (s *settingService) GetSetting(ctx context.Context, req *client.GetSettingRequest) (*client.SettingResponse, error) {
	setting, err := s.repo.GetSettingByKey(req.Key)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &client.SettingResponse{}, nil
		}
		return nil, err
	}

	plain, err := s.seal.PlainValue(setting.Key, setting.Value)
	if err != nil {
		return nil, err
	}
	value, err := structpb.NewValue(plain)
	if err != nil {
		return nil, err
	}

	return &client.SettingResponse{
		Setting: &client.Setting{
			Id:    strconv.Itoa(setting.ID),
			Key:   setting.Key,
			Value: value,
		},
	}, nil
}

func (s *settingService) GetSettings(ctx context.Context, req *client.GetSettingsRequest) (*client.GetSettingsResponse, error) {
	settings, err := s.repo.GetSettingsByKeys(req.Keys)
	if err != nil {
		return nil, err
	}

	var pbSettings []*client.Setting
	for _, setting := range settings {
		plain, err := s.seal.PlainValue(setting.Key, setting.Value)
		if err != nil {
			return nil, err
		}
		value, err := structpb.NewValue(plain)
		if err != nil {
			return nil, err
		}
		pbSettings = append(pbSettings, &client.Setting{
			Id:    strconv.Itoa(setting.ID),
			Key:   setting.Key,
			Value: value,
		})
	}

	return &client.GetSettingsResponse{
		Status:   &client.ResponseStatus{Code: client.ResponseStatus_OK},
		Settings: pbSettings,
	}, nil
}

func (s *settingService) SetSetting(ctx context.Context, req *client.SetSettingRequest) (*client.SettingResponse, error) {
	// Extract string value from protobuf Value
	valueStr := ""
	if req.Value != nil {
		valueStr = req.Value.GetStringValue()
	}

	// Optional user scope. Empty string means "unscoped"; any non-empty
	// string is parsed as a UUID. Reject malformed UUIDs early so the
	// row's user_id either points at a real user or is null — never a
	// silently-coerced value.
	var userID *uuid.UUID
	if req.UserId != "" {
		parsed, err := uuid.Parse(req.UserId)
		if err != nil {
			return nil, err
		}
		userID = &parsed
	}

	stored, err := s.seal.StoredValue(req.Key, valueStr)
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpsertSetting(req.Key, stored, userID); err != nil {
		return nil, err
	}

	return &client.SettingResponse{
		Setting: &client.Setting{
			Key:    req.Key,
			Value:  req.Value,
			UserId: req.UserId,
		},
	}, nil
}

func (s *settingService) SetSettings(ctx context.Context, req *client.SetSettingsRequest) (*client.SetSettingsResponse, error) {
	var pbSettings []*client.Setting
	for _, update := range req.Settings {
		valueStr := ""
		if update.Value != nil {
			valueStr = update.Value.GetStringValue()
		}

		stored, err := s.seal.StoredValue(update.Key, valueStr)
		if err != nil {
			return nil, err
		}
		// SetSettings doesn't carry a per-update user scope on the proto
		// today; pass nil to leave the column as-is on existing rows.
		if err := s.repo.UpsertSetting(update.Key, stored, nil); err != nil {
			return nil, err
		}

		pbSettings = append(pbSettings, &client.Setting{
			Key:   update.Key,
			Value: update.Value,
		})
	}

	return &client.SetSettingsResponse{
		Status:   &client.ResponseStatus{Code: client.ResponseStatus_OK},
		Settings: pbSettings,
	}, nil
}

func (s *settingService) DeleteSetting(ctx context.Context, req *client.DeleteSettingRequest) (*client.ResponseStatus, error) {
	if err := s.repo.DeleteByKey(req.Key); err != nil {
		return nil, err
	}

	return &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Setting deleted"}, nil
}

func (s *settingService) ListSettingsByPrefix(ctx context.Context, req *client.ListSettingsRequest) (*client.ListSettingsResponse, error) {
	settings, err := s.repo.GetSettingsByKeyPrefix(req.KeyPrefix)
	if err != nil {
		return nil, err
	}

	result := make(map[string]string, len(settings))
	for _, setting := range settings {
		plain, err := s.seal.PlainValue(setting.Key, setting.Value)
		if err != nil {
			return nil, err
		}
		result[setting.Key] = plain
	}

	return &client.ListSettingsResponse{
		Status:   &client.ResponseStatus{Code: client.ResponseStatus_OK},
		Settings: result,
	}, nil
}
