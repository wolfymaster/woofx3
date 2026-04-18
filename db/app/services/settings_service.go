package services

import (
	"context"
	"strconv"

	"github.com/google/uuid"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/structpb"
)

type settingService struct {
	repo *repository.SettingRepository
}

func NewSettingService(repo *repository.SettingRepository) *settingService {
	return &settingService{repo: repo}
}

func (s *settingService) GetSetting(ctx context.Context, req *client.GetSettingRequest) (*client.SettingResponse, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationId, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, err
	}

	setting, err := s.repo.GetSettingByKey(applicationId, req.Key)
	if err != nil {
		return nil, err
	}

	value, err := structpb.NewValue(setting.Value)
	if err != nil {
		return nil, err
	}

	return &client.SettingResponse{
		Setting: &client.Setting{
			Id:            strconv.Itoa(setting.ID),
			ApplicationId: setting.ApplicationID.String(),
			Key:           setting.Key,
			Value:         value,
		},
	}, nil
}

func (s *settingService) GetSettings(ctx context.Context, req *client.GetSettingsRequest) (*client.GetSettingsResponse, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationId, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, err
	}

	settings, err := s.repo.GetSettingsByKeys(applicationId, req.Keys)
	if err != nil {
		return nil, err
	}

	var pbSettings []*client.Setting
	for _, setting := range settings {
		value, err := structpb.NewValue(setting.Value)
		if err != nil {
			return nil, err
		}
		pbSettings = append(pbSettings, &client.Setting{
			Id:            strconv.Itoa(setting.ID),
			ApplicationId: setting.ApplicationID.String(),
			Key:           setting.Key,
			Value:         value,
		})
	}

	return &client.GetSettingsResponse{
		Status:   &client.ResponseStatus{Code: client.ResponseStatus_OK},
		Settings: pbSettings,
	}, nil
}

func (s *settingService) SetSetting(ctx context.Context, req *client.SetSettingRequest) (*client.SettingResponse, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationId, err := uuid.Parse(appIDStr)
	if err != nil {
		applicationId = uuid.Nil
	}

	// Extract string value from protobuf Value
	valueStr := ""
	if req.Value != nil {
		valueStr = req.Value.GetStringValue()
	}

	err = s.repo.UpsertSetting(applicationId, req.Key, valueStr)
	if err != nil {
		return nil, err
	}

	return &client.SettingResponse{
		Setting: &client.Setting{
			ApplicationId: applicationId.String(),
			Key:         req.Key,
			Value:       req.Value,
		},
	}, nil
}

func (s *settingService) SetSettings(ctx context.Context, req *client.SetSettingsRequest) (*client.SetSettingsResponse, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationId, err := uuid.Parse(appIDStr)
	if err != nil {
		applicationId = uuid.Nil
	}

	var pbSettings []*client.Setting
	for _, update := range req.Settings {
		valueStr := ""
		if update.Value != nil {
			valueStr = update.Value.GetStringValue()
		}

		err := s.repo.UpsertSetting(applicationId, update.Key, valueStr)
		if err != nil {
			return nil, err
		}

		pbSettings = append(pbSettings, &client.Setting{
			ApplicationId: applicationId.String(),
			Key:           update.Key,
			Value:         update.Value,
		})
	}

	return &client.SetSettingsResponse{
		Status:   &client.ResponseStatus{Code: client.ResponseStatus_OK},
		Settings: pbSettings,
	}, nil
}

func (s *settingService) DeleteSetting(ctx context.Context, req *client.DeleteSettingRequest) (*client.ResponseStatus, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationId, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, err
	}

	err = s.repo.DeleteByKey(applicationId, req.Key)
	if err != nil {
		return nil, err
	}

	return &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Setting deleted"}, nil
}

func (s *settingService) ListSettingsByPrefix(ctx context.Context, req *client.ListSettingsRequest) (*client.ListSettingsResponse, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationId, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, err
	}

	settings, err := s.repo.GetSettingsByKeyPrefix(applicationId, req.KeyPrefix)
	if err != nil {
		return nil, err
	}

	result := make(map[string]string, len(settings))
	for _, setting := range settings {
		result[setting.Key] = setting.Value
	}

	return &client.ListSettingsResponse{
		Status:   &client.ResponseStatus{Code: client.ResponseStatus_OK},
		Settings: result,
	}, nil
}
