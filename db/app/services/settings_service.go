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
	applicationId, err := uuid.Parse(req.ApplicationId)
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
	return nil, nil
}

func (s *settingService) SetSetting(ctx context.Context, req *client.SetSettingRequest) (*client.SettingResponse, error) {
	return nil, nil
}

func (s *settingService) SetSettings(ctx context.Context, req *client.SetSettingsRequest) (*client.SetSettingsResponse, error) {
	return nil, nil
}

func (s *settingService) DeleteSetting(ctx context.Context, req *client.DeleteSettingRequest) (*client.ResponseStatus, error) {
	return nil, nil
}
