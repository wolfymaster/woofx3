package services

import (
	"context"
	"strconv"

	"github.com/google/uuid"
	rpc "github.com/wolfymaster/woofx3/db/app/server"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/structpb"
)

type settingService struct {
	repo *repository.SettingRepository
}

func NewSettingService(repo *repository.SettingRepository) *settingService {
	return &settingService{repo: repo}
}

func (s *settingService) GetSetting(ctx context.Context, req *rpc.GetSettingRequest) (*rpc.SettingResponse, error) {
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

	return &rpc.SettingResponse{
		Setting: &rpc.Setting{
			Id:            strconv.Itoa(setting.ID),
			ApplicationId: setting.ApplicationID.String(),
			Key:           setting.Key,
			Value:         value,
		},
	}, nil
}

func (s *settingService) GetSettings(ctx context.Context, req *rpc.GetSettingsRequest) (*rpc.GetSettingsResponse, error) {
	return nil, nil
}

func (s *settingService) SetSetting(ctx context.Context, req *rpc.SetSettingRequest) (*rpc.SettingResponse, error) {
	return nil, nil
}

func (s *settingService) SetSettings(ctx context.Context, req *rpc.SetSettingsRequest) (*rpc.SetSettingsResponse, error) {
	return nil, nil
}

func (s *settingService) DeleteSetting(ctx context.Context, req *rpc.DeleteSettingRequest) (*rpc.ResponseStatus, error) {
	return nil, nil
}
