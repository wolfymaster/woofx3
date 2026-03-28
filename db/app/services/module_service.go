package services

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type moduleService struct {
	repo      *repo.ModuleRepository
	publisher *workers.EventPublisher
}

func NewModuleService(repo *repo.ModuleRepository, publisher *workers.EventPublisher) *moduleService {
	return &moduleService{
		repo:      repo,
		publisher: publisher,
	}
}

func (s *moduleService) CreateModule(ctx context.Context, req *client.CreateModuleRequest) (*client.ModuleResponse, error) {
	m := models.Module{
		Name:       req.Name,
		Version:    req.Version,
		Manifest:   req.Manifest,
		ArchiveKey: req.ArchiveKey,
		State:      "active",
	}

	for _, f := range req.Functions {
		m.Functions = append(m.Functions, models.ModuleFunction{
			FunctionName: f.FunctionName,
			FileName:     f.FileName,
			FileKey:      f.FileKey,
			EntryPoint:   f.EntryPoint,
			Runtime:      f.Runtime,
		})
	}

	err := s.repo.Create(&m)
	if err != nil {
		return nil, err
	}

	return &client.ModuleResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Module created successfully",
		},
		Module: moduleToProto(&m),
	}, nil
}

func (s *moduleService) UpdateModule(ctx context.Context, req *client.UpdateModuleRequest) (*client.ModuleResponse, error) {
	moduleID, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, err
	}

	m, err := s.repo.GetByID(moduleID)
	if err != nil {
		return nil, err
	}

	m.Version = req.Version
	m.Manifest = req.Manifest
	m.ArchiveKey = req.ArchiveKey

	err = s.repo.Update(m)
	if err != nil {
		return nil, err
	}

	// Replace functions: delete existing, create new
	err = s.repo.DeleteFunctionsByModuleID(moduleID)
	if err != nil {
		return nil, err
	}

	var functions []models.ModuleFunction
	for _, f := range req.Functions {
		functions = append(functions, models.ModuleFunction{
			ModuleID:     moduleID,
			FunctionName: f.FunctionName,
			FileName:     f.FileName,
			FileKey:      f.FileKey,
			EntryPoint:   f.EntryPoint,
			Runtime:      f.Runtime,
		})
	}

	err = s.repo.CreateFunctions(functions)
	if err != nil {
		return nil, err
	}

	m.Functions = functions

	return &client.ModuleResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Module updated successfully",
		},
		Module: moduleToProto(m),
	}, nil
}

func (s *moduleService) DeleteModule(ctx context.Context, req *client.DeleteModuleRequest) (*client.ResponseStatus, error) {
	m, err := s.repo.GetByName(req.Name)
	if err != nil {
		return nil, err
	}

	err = s.repo.Delete(m)
	if err != nil {
		return nil, err
	}

	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "Module deleted successfully",
	}, nil
}

func (s *moduleService) GetModule(ctx context.Context, req *client.GetModuleRequest) (*client.ModuleResponse, error) {
	moduleID, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, err
	}

	m, err := s.repo.GetByID(moduleID)
	if err != nil {
		return nil, err
	}

	return &client.ModuleResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Module retrieved successfully",
		},
		Module: moduleToProto(m),
	}, nil
}

func (s *moduleService) GetModuleByName(ctx context.Context, req *client.GetModuleByNameRequest) (*client.ModuleResponse, error) {
	m, err := s.repo.GetByName(req.Name)
	if err != nil {
		return nil, err
	}

	return &client.ModuleResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Module retrieved successfully",
		},
		Module: moduleToProto(m),
	}, nil
}

func (s *moduleService) ListModules(ctx context.Context, req *client.ListModulesRequest) (*client.ListModulesResponse, error) {
	var modules []*models.Module
	var err error

	if req.State != "" {
		modules, err = s.repo.GetByState(req.State)
	} else {
		modules, err = s.repo.GetAll()
	}

	if err != nil {
		return nil, err
	}

	protoModules := make([]*client.Module, len(modules))
	for i, m := range modules {
		protoModules[i] = moduleToProto(m)
	}

	return &client.ListModulesResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Modules retrieved successfully",
		},
		Modules: protoModules,
	}, nil
}

func (s *moduleService) SetModuleState(ctx context.Context, req *client.SetModuleStateRequest) (*client.ModuleResponse, error) {
	if req.State != "active" && req.State != "disabled" {
		return nil, fmt.Errorf("invalid state: %s, must be 'active' or 'disabled'", req.State)
	}

	m, err := s.repo.GetByName(req.Name)
	if err != nil {
		return nil, err
	}

	m.State = req.State

	err = s.repo.Update(m)
	if err != nil {
		return nil, err
	}

	return &client.ModuleResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Module state updated successfully",
		},
		Module: moduleToProto(m),
	}, nil
}

func (s *moduleService) RegisterTrigger(ctx context.Context, req *client.RegisterTriggerRequest) (*client.ModuleTriggerResponse, error) {
	m, err := s.repo.GetByName(req.ModuleName)
	if err != nil {
		return nil, fmt.Errorf("module not found: %w", err)
	}

	trigger := &models.ModuleTrigger{
		ID:            uuid.New(),
		ModuleID:      m.ID,
		ModuleName:    req.ModuleName,
		Category:      req.Category,
		Name:          req.Name,
		Description:   req.Description,
		Event:         req.Event,
		ConfigSchema:  req.ConfigSchema,
		AllowVariants: req.AllowVariants,
	}

	if err := s.repo.UpsertTrigger(trigger); err != nil {
		return nil, fmt.Errorf("upsert trigger: %w", err)
	}

	if s.publisher != nil {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   "",
			EntityType:      "module_trigger",
			EntityID:        trigger.ID.String(),
			Operation:       "registered",
			Data:            trigger,
			AutoAcknowledge: true,
		})
	}

	return &client.ModuleTriggerResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Trigger registered successfully",
		},
		Trigger: triggerToProto(trigger),
	}, nil
}

func (s *moduleService) ListTriggers(ctx context.Context, req *client.ListTriggersRequest) (*client.ListTriggersResponse, error) {
	triggers, err := s.repo.ListTriggers(req.ModuleName)
	if err != nil {
		return nil, err
	}

	protoTriggers := make([]*client.ModuleTrigger, len(triggers))
	for i, t := range triggers {
		protoTriggers[i] = triggerToProto(t)
	}

	return &client.ListTriggersResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Triggers retrieved successfully",
		},
		Triggers: protoTriggers,
	}, nil
}

func (s *moduleService) DeleteTriggersByModule(ctx context.Context, req *client.DeleteTriggersByModuleRequest) (*client.ResponseStatus, error) {
	m, err := s.repo.GetByName(req.ModuleName)
	if err != nil {
		return nil, fmt.Errorf("module not found: %w", err)
	}

	if err := s.repo.DeleteTriggersByModuleID(m.ID); err != nil {
		return nil, err
	}

	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "Triggers deleted successfully",
	}, nil
}

func triggerToProto(t *models.ModuleTrigger) *client.ModuleTrigger {
	return &client.ModuleTrigger{
		Id:            t.ID.String(),
		ModuleId:      t.ModuleID.String(),
		ModuleName:    t.ModuleName,
		Category:      t.Category,
		Name:          t.Name,
		Description:   t.Description,
		Event:         t.Event,
		ConfigSchema:  t.ConfigSchema,
		AllowVariants: t.AllowVariants,
	}
}

func moduleToProto(m *models.Module) *client.Module {
	protoFunctions := make([]*client.ModuleFunction, len(m.Functions))
	for i, f := range m.Functions {
		protoFunctions[i] = &client.ModuleFunction{
			Id:           f.ID.String(),
			ModuleId:     f.ModuleID.String(),
			FunctionName: f.FunctionName,
			FileName:     f.FileName,
			FileKey:      f.FileKey,
			EntryPoint:   f.EntryPoint,
			Runtime:      f.Runtime,
		}
	}

	return &client.Module{
		Id:          m.ID.String(),
		Name:        m.Name,
		Version:     m.Version,
		Manifest:    m.Manifest,
		State:       m.State,
		ArchiveKey:  m.ArchiveKey,
		Functions:   protoFunctions,
		InstalledAt: timestamppb.New(m.InstalledAt),
		UpdatedAt:   timestamppb.New(m.UpdatedAt),
	}
}
