package services

import (
	"context"

	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

type ModuleSettingService struct {
	repo repo.ModuleSettingRepository
}

func NewModuleSettingService(r repo.ModuleSettingRepository) *ModuleSettingService {
	return &ModuleSettingService{repo: r}
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

func (s *ModuleSettingService) SetModuleSetting(ctx context.Context, req *client.SetModuleSettingRequest) (*client.ModuleSettingRecord, error) {
	row := models.ModuleSetting{
		ModuleID:  req.ModuleId,
		Key:       req.Key,
		Value:     req.Value,
		ValueType: req.ValueType,
	}
	if err := s.repo.Upsert(row); err != nil {
		return nil, err
	}
	rows, err := s.repo.ListByModule(req.ModuleId)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if r.Key == req.Key {
			return toProtoSetting(r), nil
		}
	}
	return toProtoSetting(row), nil
}

func (s *ModuleSettingService) RegisterModuleSettings(ctx context.Context, req *client.RegisterModuleSettingsRequest) (*client.RegisterModuleSettingsResponse, error) {
	registered := int32(0)
	for _, input := range req.Settings {
		if err := s.repo.UpsertDefault(req.ModuleId, input.Key, input.Value, input.ValueType); err != nil {
			return nil, err
		}
		registered++
	}
	return &client.RegisterModuleSettingsResponse{Registered: registered}, nil
}

func toProtoSetting(r models.ModuleSetting) *client.ModuleSettingRecord {
	return &client.ModuleSettingRecord{
		Id:        r.ID.String(),
		ModuleId:  r.ModuleID,
		Key:       r.Key,
		Value:     r.Value,
		ValueType: r.ValueType,
	}
}
