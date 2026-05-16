package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

type moduleService struct {
	repo         *repo.ModuleRepository
	refRepo      *repo.ResourceReferenceRepository
	instanceRepo *repo.ModuleResourceInstanceRepository
	publisher    *workers.EventPublisher
}

func NewModuleService(
	moduleRepo *repo.ModuleRepository,
	refRepo *repo.ResourceReferenceRepository,
	instanceRepo *repo.ModuleResourceInstanceRepository,
	publisher *workers.EventPublisher,
) *moduleService {
	return &moduleService{
		repo:         moduleRepo,
		refRepo:      refRepo,
		instanceRepo: instanceRepo,
		publisher:    publisher,
	}
}

func (s *moduleService) CreateModule(ctx context.Context, req *client.CreateModuleRequest) (*client.ModuleResponse, error) {
	// Idempotency layer 1: same composite module_key already installed → return as-is.
	if req.ModuleKey != "" {
		existing, err := s.repo.GetByModuleKey(req.ModuleKey)
		if err == nil && existing != nil {
			return &client.ModuleResponse{
				Status: &client.ResponseStatus{
					Code:    client.ResponseStatus_OK,
					Message: "Module already installed",
				},
				Module: moduleToProto(existing),
			}, nil
		}
	}

	// Idempotency layer 2: a row with the same name already exists but under a
	// different module_key. This happens when a prior install half-succeeded
	// (module row persisted, downstream RPCs failed) or the user is upgrading
	// to a new version/hash without an explicit update call. Rewriting the
	// row in place keeps the `modules_name_key` constraint happy and lets
	// install retries converge. Functions are replaced wholesale.
	if req.Name != "" {
		existing, err := s.repo.GetByName(req.Name)
		if err == nil && existing != nil {
			existing.ModuleKey = req.ModuleKey
			existing.Version = req.Version
			existing.Manifest = req.Manifest
			existing.ArchiveKey = req.ArchiveKey
			existing.State = "active"
			if req.CreatedByType != "" {
				existing.CreatedByType = req.CreatedByType
			}
			if req.CreatedByRef != "" {
				existing.CreatedByRef = req.CreatedByRef
			}

			if err := s.repo.Update(existing); err != nil {
				return nil, err
			}
			if err := s.repo.DeleteFunctionsByModuleID(existing.ID); err != nil {
				return nil, err
			}

			functions := make([]models.ModuleFunction, 0, len(req.Functions))
			for _, f := range req.Functions {
				functions = append(functions, models.ModuleFunction{
					ModuleID:   existing.ID,
					ManifestID: f.ManifestId,
					Name:       f.Name,
					FileName:   f.FileName,
					FileKey:    f.FileKey,
					EntryPoint: f.EntryPoint,
					Runtime:    f.Runtime,
				})
			}
			if len(functions) > 0 {
				if err := s.repo.CreateFunctions(functions); err != nil {
					return nil, err
				}
			}
			existing.Functions = functions

			if s.publisher != nil && len(functions) > 0 {
				s.publisher.Publish(workers.PublishOptions{
					ApplicationID:   "",
					EntityType:      "module.function",
					Operation:       "registered",
					Data:            buildFunctionRegisteredData(existing.ID.String(), existing.ModuleKey, existing.Name, existing.Version, functions),
					AutoAcknowledge: true,
				})
			}

			return &client.ModuleResponse{
				Status: &client.ResponseStatus{
					Code:    client.ResponseStatus_OK,
					Message: "Module replaced",
				},
				Module: moduleToProto(existing),
			}, nil
		}
	}

	m := models.Module{
		ModuleKey:     req.ModuleKey,
		Name:          req.Name,
		Version:       req.Version,
		Manifest:      req.Manifest,
		ArchiveKey:    req.ArchiveKey,
		State:         "active",
		CreatedByType: req.CreatedByType,
		CreatedByRef:  req.CreatedByRef,
	}

	for _, f := range req.Functions {
		m.Functions = append(m.Functions, models.ModuleFunction{
			ManifestID: f.ManifestId,
			Name:       f.Name,
			FileName:   f.FileName,
			FileKey:    f.FileKey,
			EntryPoint: f.EntryPoint,
			Runtime:    f.Runtime,
		})
	}

	err := s.repo.Create(&m)
	if err != nil {
		return nil, err
	}

	if s.publisher != nil && len(m.Functions) > 0 {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   "",
			EntityType:      "module.function",
			Operation:       "registered",
			Data:            buildFunctionRegisteredData(m.ID.String(), m.ModuleKey, m.Name, m.Version, m.Functions),
			AutoAcknowledge: true,
		})
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
			ModuleID:   moduleID,
			ManifestID: f.ManifestId,
			Name:       f.Name,
			FileName:   f.FileName,
			FileKey:    f.FileKey,
			EntryPoint: f.EntryPoint,
			Runtime:    f.Runtime,
		})
	}

	err = s.repo.CreateFunctions(functions)
	if err != nil {
		return nil, err
	}

	m.Functions = functions

	if s.publisher != nil && len(m.Functions) > 0 {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   "",
			EntityType:      "module.function",
			Operation:       "registered",
			Data:            buildFunctionRegisteredData(m.ID.String(), m.ModuleKey, m.Name, m.Version, m.Functions),
			AutoAcknowledge: true,
		})
	}

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

	// Capture function metadata BEFORE deleting the module row — once the
	// module is gone the FK cascade removes function rows and we can no
	// longer build the dereg event payload.
	functions := append([]models.ModuleFunction(nil), m.Functions...)

	err = s.repo.Delete(m)
	if err != nil {
		return nil, err
	}

	if s.publisher != nil && len(functions) > 0 {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   "",
			EntityType:      "module.function",
			Operation:       "deregistered",
			Data:            buildFunctionDeregisteredData(m.ModuleKey, m.Name, m.Version, functions),
			AutoAcknowledge: true,
		})
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
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.NotFoundError(fmt.Sprintf("module %q not found", req.Name))
		}
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

func (s *moduleService) GetModuleByModuleKey(ctx context.Context, req *client.GetModuleByModuleKeyRequest) (*client.ModuleResponse, error) {
	m, err := s.repo.GetByModuleKey(req.ModuleKey)
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

func (s *moduleService) RegisterTriggers(ctx context.Context, req *client.RegisterTriggersRequest) (*client.ListTriggersResponse, error) {
	// Default module-installer registration pairing; optional overrides let
	// non-module registrars (SYSTEM services, integrations) upsert into the
	// shared triggers table under their own (type, ref) namespace.
	createdByType := "MODULE"
	createdByRef := req.ModuleKey
	if req.CreatedByType != "" && req.CreatedByRef != "" {
		createdByType = req.CreatedByType
		createdByRef = req.CreatedByRef
	}
	saved := make([]*models.Trigger, 0, len(req.Triggers))
	for _, in := range req.Triggers {
		t := &models.Trigger{
			ID:            uuid.New(),
			Category:      in.Category,
			Name:          in.Name,
			Description:   in.Description,
			Event:         in.Event,
			ConfigSchema:  in.ConfigSchema,
			AllowVariants: in.AllowVariants,
			CreatedByType: createdByType,
			CreatedByRef:  createdByRef,
			ManifestID:    in.ManifestId,
		}
		if err := s.repo.UpsertTrigger(t); err != nil {
			return nil, fmt.Errorf("upsert trigger %q: %w", in.Name, err)
		}
		saved = append(saved, t)
	}

	if s.publisher != nil {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   "",
			EntityType:      "module.trigger",
			Operation:       "registered",
			Data:            buildTriggerRegisteredData(req.ModuleKey, req.ModuleName, req.Version, saved),
			AutoAcknowledge: true,
		})
	}

	protoTriggers := make([]*client.Trigger, len(saved))
	for i, t := range saved {
		protoTriggers[i] = triggerToProto(t)
	}
	return &client.ListTriggersResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Triggers registered successfully",
		},
		Triggers: protoTriggers,
	}, nil
}

func (s *moduleService) ListTriggers(ctx context.Context, req *client.ListTriggersRequest) (*client.ListTriggersResponse, error) {
	triggers, err := s.repo.ListTriggers(req.CreatedByType, req.CreatedByRef)
	if err != nil {
		return nil, err
	}

	protoTriggers := make([]*client.Trigger, len(triggers))
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

// GetTriggerByCanonicalId resolves a canonical id
// (`{moduleId}:trigger:{manifestId}`) to its row. Used by barkloader's
// install path to bake the trigger's NATS subject into a workflow that
// references a trigger from another module. Returns NotFound if no
// matching trigger row exists.
func (s *moduleService) GetTriggerByCanonicalId(ctx context.Context, req *client.GetByCanonicalIdRequest) (*client.TriggerResponse, error) {
	moduleID, kind, manifestID, err := parseCanonicalID(req.CanonicalId)
	if err != nil {
		return nil, twirp.InvalidArgumentError("canonical_id", err.Error())
	}
	if kind != "trigger" {
		return nil, twirp.InvalidArgumentError("canonical_id", fmt.Sprintf("expected kind 'trigger', got %q", kind))
	}
	t, err := s.repo.GetTriggerByModuleAndManifestID(moduleID, manifestID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.NotFoundError(fmt.Sprintf("no trigger %q", req.CanonicalId))
		}
		return nil, err
	}
	return &client.TriggerResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Trigger retrieved successfully",
		},
		Trigger: triggerToProto(t),
	}, nil
}

func (s *moduleService) DeleteTriggersByModuleId(ctx context.Context, req *client.DeleteByModuleIdRequest) (*client.ResponseStatus, error) {
	// Capture rows for the dereg event before deleting them. List then
	// delete is racy if something else writes triggers under this prefix
	// in between, but for module-delete (the only caller today) the prefix
	// is going away so any new writes would be a bug.
	triggers, err := s.repo.ListTriggersByModulePrefix(req.ModuleId)
	if err != nil {
		return nil, err
	}
	if err := s.repo.DeleteTriggersByModulePrefix(req.ModuleId); err != nil {
		return nil, err
	}
	if s.publisher != nil && len(triggers) > 0 {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   "",
			EntityType:      "module.trigger",
			Operation:       "deregistered",
			Data:            buildTriggerDeregisteredData(req.ModuleId, triggers),
			AutoAcknowledge: true,
		})
	}
	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "Triggers deleted successfully",
	}, nil
}

func triggerToProto(t *models.Trigger) *client.Trigger {
	return &client.Trigger{
		Id:            t.ID.String(),
		Category:      t.Category,
		Name:          t.Name,
		Description:   t.Description,
		Event:         t.Event,
		ConfigSchema:  t.ConfigSchema,
		AllowVariants: t.AllowVariants,
		CreatedByType: t.CreatedByType,
		CreatedByRef:  t.CreatedByRef,
		ManifestId:    t.ManifestID,
	}
}

func (s *moduleService) RegisterActions(ctx context.Context, req *client.RegisterActionsRequest) (*client.ListActionsResponse, error) {
	// Default module-installer registration pairing; optional overrides let
	// non-module registrars (SYSTEM services, integrations) upsert into the
	// shared actions table under their own (type, ref) namespace.
	createdByType := "MODULE"
	createdByRef := req.ModuleKey
	if req.CreatedByType != "" && req.CreatedByRef != "" {
		createdByType = req.CreatedByType
		createdByRef = req.CreatedByRef
	}
	saved := make([]*models.Action, 0, len(req.Actions))
	for _, in := range req.Actions {
		a := &models.Action{
			ID:            uuid.New(),
			Name:          in.Name,
			Description:   in.Description,
			Call:          in.Call,
			ParamsSchema:  in.ParamsSchema,
			CreatedByType: createdByType,
			CreatedByRef:  createdByRef,
			ManifestID:    in.ManifestId,
			Type:          in.Type,
		}
		if err := s.repo.UpsertAction(a); err != nil {
			return nil, fmt.Errorf("upsert action %q: %w", in.Name, err)
		}
		saved = append(saved, a)
	}

	if s.publisher != nil {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   "",
			EntityType:      "module.action",
			Operation:       "registered",
			Data:            buildActionRegisteredData(req.ModuleKey, req.ModuleName, req.Version, saved),
			AutoAcknowledge: true,
		})
	}

	protoActions := make([]*client.Action, len(saved))
	for i, a := range saved {
		protoActions[i] = actionToProto(a)
	}
	return &client.ListActionsResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Actions registered successfully",
		},
		Actions: protoActions,
	}, nil
}

func (s *moduleService) ListActions(ctx context.Context, req *client.ListActionsRequest) (*client.ListActionsResponse, error) {
	actions, err := s.repo.ListActions(req.CreatedByType, req.CreatedByRef)
	if err != nil {
		return nil, err
	}

	protoActions := make([]*client.Action, len(actions))
	for i, a := range actions {
		protoActions[i] = actionToProto(a)
	}

	return &client.ListActionsResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Actions retrieved successfully",
		},
		Actions: protoActions,
	}, nil
}

// GetActionByCanonicalId mirrors GetTriggerByCanonicalId for actions.
// Used by barkloader's install path to bake an action's resolved
// `call` (canonical function id) into a workflow step that references
// an action from another module.
func (s *moduleService) GetActionByCanonicalId(ctx context.Context, req *client.GetByCanonicalIdRequest) (*client.ActionResponse, error) {
	moduleID, kind, manifestID, err := parseCanonicalID(req.CanonicalId)
	if err != nil {
		return nil, twirp.InvalidArgumentError("canonical_id", err.Error())
	}
	if kind != "action" {
		return nil, twirp.InvalidArgumentError("canonical_id", fmt.Sprintf("expected kind 'action', got %q", kind))
	}
	a, err := s.repo.GetActionByModuleAndManifestID(moduleID, manifestID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.NotFoundError(fmt.Sprintf("no action %q", req.CanonicalId))
		}
		return nil, err
	}
	return &client.ActionResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Action retrieved successfully",
		},
		Action: actionToProto(a),
	}, nil
}

// parseCanonicalID splits a canonical id `{moduleId}:{kind}:{manifest_id}`
// into its three segments. Mirrors barkloader's
// `looks_like_canonical_id` validation. Returns an error when the id
// doesn't have exactly three non-empty segments.
func parseCanonicalID(canonicalID string) (moduleID, kind, manifestID string, err error) {
	parts := strings.Split(canonicalID, ":")
	if len(parts) != 3 {
		return "", "", "", fmt.Errorf("expected `{moduleId}:{kind}:{manifestId}`, got %q", canonicalID)
	}
	if parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return "", "", "", fmt.Errorf("canonical id %q has empty segment", canonicalID)
	}
	return parts[0], parts[1], parts[2], nil
}

func (s *moduleService) DeleteActionsByModuleId(ctx context.Context, req *client.DeleteByModuleIdRequest) (*client.ResponseStatus, error) {
	// Capture rows for the dereg event before deleting them.
	actions, err := s.repo.ListActionsByModulePrefix(req.ModuleId)
	if err != nil {
		return nil, err
	}
	if err := s.repo.DeleteActionsByModulePrefix(req.ModuleId); err != nil {
		return nil, err
	}
	if s.publisher != nil && len(actions) > 0 {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   "",
			EntityType:      "module.action",
			Operation:       "deregistered",
			Data:            buildActionDeregisteredData(req.ModuleId, actions),
			AutoAcknowledge: true,
		})
	}
	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "Actions deleted successfully",
	}, nil
}

func actionToProto(a *models.Action) *client.Action {
	return &client.Action{
		Id:            a.ID.String(),
		Name:          a.Name,
		Description:   a.Description,
		Call:          a.Call,
		ParamsSchema:  a.ParamsSchema,
		CreatedByType: a.CreatedByType,
		CreatedByRef:  a.CreatedByRef,
		ManifestId:    a.ManifestID,
		Type:          a.Type,
	}
}

func moduleToProto(m *models.Module) *client.Module {
	protoFunctions := make([]*client.ModuleFunction, len(m.Functions))
	for i, f := range m.Functions {
		protoFunctions[i] = &client.ModuleFunction{
			Id:         f.ID.String(),
			ModuleId:   f.ModuleID.String(),
			ManifestId: f.ManifestID,
			Name:       f.Name,
			FileName:   f.FileName,
			FileKey:    f.FileKey,
			EntryPoint: f.EntryPoint,
			Runtime:    f.Runtime,
		}
	}

	return &client.Module{
		Id:            m.ID.String(),
		ModuleKey:     m.ModuleKey,
		Name:          m.Name,
		Version:       m.Version,
		Manifest:      m.Manifest,
		State:         m.State,
		ArchiveKey:    m.ArchiveKey,
		Functions:     protoFunctions,
		InstalledAt:   timestamppb.New(m.InstalledAt),
		UpdatedAt:     timestamppb.New(m.UpdatedAt),
		CreatedByType: m.CreatedByType,
		CreatedByRef:  m.CreatedByRef,
	}
}

// Module Resource RPCs

func (s *moduleService) CreateModuleResource(ctx context.Context, req *client.CreateModuleResourceRequest) (*client.ModuleResourceResponse, error) {
	moduleID, err := uuid.Parse(req.ModuleId)
	if err != nil {
		return nil, fmt.Errorf("invalid module_id: %w", err)
	}

	var resourceID *uuid.UUID
	if req.ResourceId != "" {
		parsed, err := uuid.Parse(req.ResourceId)
		if err != nil {
			return nil, fmt.Errorf("invalid resource_id: %w", err)
		}
		resourceID = &parsed
	}

	res := &models.ModuleResource{
		ID:              uuid.New(),
		ModuleID:        moduleID,
		ResourceType:    req.ResourceType,
		ResourceID:      resourceID,
		ManifestID:      req.ManifestId,
		ResourceName:    req.ResourceName,
		OriginalVersion: req.Version,
		CurrentVersion:  req.Version,
	}

	if err := s.repo.CreateModuleResource(res); err != nil {
		return nil, err
	}

	return &client.ModuleResourceResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Module resource created successfully",
		},
		Resource: moduleResourceToProto(res),
	}, nil
}

func (s *moduleService) ListModuleResources(ctx context.Context, req *client.ListModuleResourcesRequest) (*client.ListModuleResourcesResponse, error) {
	moduleID, err := uuid.Parse(req.ModuleId)
	if err != nil {
		return nil, fmt.Errorf("invalid module_id: %w", err)
	}

	resources, err := s.repo.ListModuleResources(moduleID, req.ResourceType)
	if err != nil {
		return nil, err
	}

	protoResources := make([]*client.ModuleResource, len(resources))
	for i, r := range resources {
		protoResources[i] = moduleResourceToProto(r)
	}

	return &client.ListModuleResourcesResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Module resources retrieved successfully",
		},
		Resources: protoResources,
	}, nil
}

func (s *moduleService) DeleteModuleResources(ctx context.Context, req *client.DeleteModuleResourcesRequest) (*client.ResponseStatus, error) {
	moduleID, err := uuid.Parse(req.ModuleId)
	if err != nil {
		return nil, fmt.Errorf("invalid module_id: %w", err)
	}

	if err := s.repo.DeleteModuleResources(moduleID); err != nil {
		return nil, err
	}

	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "Module resources deleted successfully",
	}, nil
}

func (s *moduleService) UpdateModuleResourceVersion(ctx context.Context, req *client.UpdateModuleResourceVersionRequest) (*client.ModuleResourceResponse, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, fmt.Errorf("invalid id: %w", err)
	}

	res, err := s.repo.UpdateModuleResourceVersion(id, req.Version)
	if err != nil {
		return nil, err
	}

	return &client.ModuleResourceResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Module resource version updated successfully",
		},
		Resource: moduleResourceToProto(res),
	}, nil
}

func (s *moduleService) CompleteModuleInstall(ctx context.Context, req *client.CompleteModuleInstallRequest) (*client.ResponseStatus, error) {
	operation := "installed"
	if req.Status == "failed" {
		operation = "install_failed"
	}

	var clientID, applicationID, moduleKey string
	if req.RequestContext != nil {
		clientID = req.RequestContext.ClientId
		applicationID = req.RequestContext.ApplicationId
		moduleKey = req.RequestContext.ModuleKey
		fmt.Printf("CompleteModuleInstall: RequestContext present client_id=%q application_id=%q module_key=%q\n", clientID, applicationID, moduleKey)
	} else {
		fmt.Printf("CompleteModuleInstall: RequestContext is NIL\n")
	}

	// Pull catalog metadata (author, category, description) out of the
	// stored manifest so the UI's moduleRepository row can render real
	// values instead of falling back to "Unknown" / blank. Best-effort —
	// any lookup or parse failure leaves the defaults from
	// moduleCatalogFields in place rather than blocking the event.
	author, category, description := "Unknown", "Unknown", ""
	if moduleID, err := uuid.Parse(req.ModuleId); err == nil {
		if m, err := s.repo.GetByID(moduleID); err == nil && m != nil {
			author, category, description = moduleCatalogFields(m.Manifest)
		}
	}

	if s.publisher != nil {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID: applicationID,
			ClientID:      clientID,
			EntityType:    "module",
			EntityID:      req.ModuleId,
			Operation:     operation,
			Data: map[string]interface{}{
				"module_id":   req.ModuleId,
				"module_name": req.ModuleName,
				"module_key":  moduleKey,
				"version":     req.Version,
				"status":      req.Status,
				"error":       req.Error,
				"author":      author,
				"category":    category,
				"description": description,
			},
			AutoAcknowledge: true,
		})
	}

	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: fmt.Sprintf("Module install %s notification sent", operation),
	}, nil
}

// resolveResourceDisplayName looks up the human-readable `name` of an
// in-use module resource by querying the underlying domain table. The
// `module_resources` ledger only stores the canonical id (e.g.
// `twitch_platform:trigger:twitch.channel.cheer`) — that's the stable
// identity but it's not what the UI should show users. Falls back to
// the canonical id when no underlying row can be resolved (legacy
// rows, cross-module references, or resource types we don't yet
// resolve here).
//
// `moduleIDSegment` is the first segment of the composite moduleKey
// (the bare manifest id, e.g. `twitch_platform`). `module.Functions`
// is the preloaded function slice from GetByID.
//
// Workflows and commands are not yet resolved — they fall back to the
// canonical id. Adding them requires a workflow lookup by
// (created_by_ref, manifest_id) and a command lookup by id.
func (s *moduleService) resolveResourceDisplayName(
	module *models.Module,
	moduleIDSegment string,
	r *models.ModuleResource,
) string {
	switch r.ResourceType {
	case "trigger":
		if t, err := s.repo.GetTriggerByModuleAndManifestID(moduleIDSegment, r.ManifestID); err == nil && t != nil && t.Name != "" {
			return t.Name
		}
	case "action":
		if a, err := s.repo.GetActionByModuleAndManifestID(moduleIDSegment, r.ManifestID); err == nil && a != nil && a.Name != "" {
			return a.Name
		}
	case "function":
		for _, f := range module.Functions {
			if f.ManifestID == r.ManifestID && f.Name != "" {
				return f.Name
			}
		}
	}
	return r.ResourceName
}

// CheckModuleResourceUsage returns every resource owned by the given module
// that is referenced by a resource outside the module. Intra-module edges are
// ignored so a module can safely delete itself along with its own workflows
// and commands that happen to reference its own actions/functions/triggers.
func (s *moduleService) CheckModuleResourceUsage(ctx context.Context, req *client.CheckModuleResourceUsageRequest) (*client.CheckModuleResourceUsageResponse, error) {
	moduleID, err := uuid.Parse(req.ModuleId)
	if err != nil {
		return nil, fmt.Errorf("invalid module_id: %w", err)
	}

	module, err := s.repo.GetByID(moduleID)
	if err != nil {
		return nil, fmt.Errorf("load module: %w", err)
	}

	resources, err := s.repo.ListModuleResources(moduleID, "")
	if err != nil {
		return nil, fmt.Errorf("list module resources: %w", err)
	}

	// Build a lookup from (target_type, target_name) -> module_resource so we
	// can attribute each reference back to the exact row it points at.
	type key struct{ t, n string }
	resourceByKey := make(map[key]*models.ModuleResource, len(resources))
	types := make(map[string]struct{})
	names := make(map[string]struct{})
	for _, r := range resources {
		resourceByKey[key{r.ResourceType, r.ResourceName}] = r
		types[r.ResourceType] = struct{}{}
		names[r.ResourceName] = struct{}{}
	}

	typeList := make([]string, 0, len(types))
	for t := range types {
		typeList = append(typeList, t)
	}
	nameList := make([]string, 0, len(names))
	for n := range names {
		nameList = append(nameList, n)
	}

	usageByResource := make(map[uuid.UUID]*client.ResourceUsage)
	if s.refRepo != nil && len(resources) > 0 {
		refs, err := s.refRepo.FindExternalReferencesToModule(module.Name, typeList, nameList)
		if err != nil {
			return nil, fmt.Errorf("find external references: %w", err)
		}

		// Bare manifest id segment (e.g. "twitch_platform" from
		// "twitch_platform:1.0.0:abc1234") used to look up triggers /
		// actions for display-name resolution. ManifestID + this segment
		// is the (created_by_ref-prefix, manifest_id) tuple that
		// uniquely identifies a module resource row.
		moduleIDSegment := moduleIDFromCreatedByRef(module.ModuleKey)

		for _, ref := range refs {
			res, ok := resourceByKey[key{ref.TargetType, ref.TargetName}]
			if !ok {
				continue
			}
			usage, ok := usageByResource[res.ID]
			if !ok {
				usage = &client.ResourceUsage{
					ResourceId:          res.ID.String(),
					ResourceType:        res.ResourceType,
					ResourceName:        res.ResourceName,
					ResourceDisplayName: s.resolveResourceDisplayName(module, moduleIDSegment, res),
				}
				usageByResource[res.ID] = usage
			}
			usage.UsedBy = append(usage.UsedBy, &client.UsageRef{
				SourceType: ref.SourceType,
				SourceId:   ref.SourceID.String(),
				SourceName: ref.SourceName,
				Context:    ref.Context,
			})
		}
	}

	inUse := make([]*client.ResourceUsage, 0, len(usageByResource))
	for _, u := range usageByResource {
		inUse = append(inUse, u)
	}

	return &client.CheckModuleResourceUsageResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: fmt.Sprintf("Found %d in-use resource(s)", len(inUse)),
		},
		InUse: inUse,
	}, nil
}

// CompleteModuleDelete mirrors CompleteModuleInstall: it publishes a NATS
// event so the API layer can forward the result to the UI via webhook. The
// actual deletion work happens in barkloader; this RPC only records the
// outcome.
func (s *moduleService) CompleteModuleDelete(ctx context.Context, req *client.CompleteModuleDeleteRequest) (*client.ResponseStatus, error) {
	operation := "deleted"
	if req.Status == "failed" {
		operation = "delete_failed"
	}

	var clientID, applicationID, moduleKey string
	if req.RequestContext != nil {
		clientID = req.RequestContext.ClientId
		applicationID = req.RequestContext.ApplicationId
		moduleKey = req.RequestContext.ModuleKey
	}

	inUsePayload := make([]map[string]interface{}, 0, len(req.InUseResources))
	for _, r := range req.InUseResources {
		usedBy := make([]map[string]string, 0, len(r.UsedBy))
		for _, u := range r.UsedBy {
			usedBy = append(usedBy, map[string]string{
				"source_type": u.SourceType,
				"source_id":   u.SourceId,
				"source_name": u.SourceName,
				"context":     u.Context,
			})
		}
		inUsePayload = append(inUsePayload, map[string]interface{}{
			"resource_id":           r.ResourceId,
			"resource_type":         r.ResourceType,
			"resource_name":         r.ResourceName,
			"resource_display_name": r.ResourceDisplayName,
			"used_by":               usedBy,
		})
	}

	if s.publisher != nil {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID: applicationID,
			ClientID:      clientID,
			EntityType:    "module",
			EntityID:      req.ModuleId,
			Operation:     operation,
			Data: map[string]interface{}{
				"module_id":        req.ModuleId,
				"module_name":      req.ModuleName,
				"module_key":       moduleKey,
				"status":           req.Status,
				"error":            req.Error,
				"in_use_resources": inUsePayload,
			},
			AutoAcknowledge: true,
		})
	}

	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: fmt.Sprintf("Module delete %s notification sent", operation),
	}, nil
}

func moduleResourceToProto(r *models.ModuleResource) *client.ModuleResource {
	resourceID := ""
	if r.ResourceID != nil {
		resourceID = r.ResourceID.String()
	}

	return &client.ModuleResource{
		Id:              r.ID.String(),
		ModuleId:        r.ModuleID.String(),
		ResourceType:    r.ResourceType,
		ResourceId:      resourceID,
		ManifestId:      r.ManifestID,
		ResourceName:    r.ResourceName,
		OriginalVersion: r.OriginalVersion,
		CurrentVersion:  r.CurrentVersion,
		InstalledAt:     timestamppb.New(r.InstalledAt),
		UpdatedAt:       timestamppb.New(r.UpdatedAt),
	}
}

// ---------------------------------------------------------------------
// Widget RPCs.
//
// Module-extension surface for placeable visual components (widgets).
// Mirrors the asset surface shape: idempotent upsert keyed on
// (created_by_type, created_by_ref, manifest_id), outbox events on
// `module.widget.{registered,deregistered}` so downstream consumers
// (Convex editor, etc.) can react.
// ---------------------------------------------------------------------

func (s *moduleService) RegisterWidgets(ctx context.Context, req *client.RegisterWidgetsRequest) (*client.ListWidgetsResponse, error) {
	createdByType := "MODULE"
	createdByRef := req.ModuleKey
	if req.CreatedByType != "" && req.CreatedByRef != "" {
		createdByType = req.CreatedByType
		createdByRef = req.CreatedByRef
	}
	saved := make([]*models.Widget, 0, len(req.Widgets))
	for _, in := range req.Widgets {
		alertTypesJSON, err := json.Marshal(in.AlertTypes)
		if err != nil {
			return nil, fmt.Errorf("marshal alert_types for widget %q: %w", in.Name, err)
		}
		w := &models.Widget{
			ID:             uuid.New(),
			Name:           in.Name,
			Description:    in.Description,
			Directory:      in.Directory,
			AlertTypes:     string(alertTypesJSON),
			SettingsSchema: in.SettingsSchema,
			Surface:        in.Surface,
			CreatedByType:  createdByType,
			CreatedByRef:   createdByRef,
			ManifestID:     in.ManifestId,
		}
		if err := s.repo.UpsertWidget(w); err != nil {
			return nil, fmt.Errorf("upsert widget %q: %w", in.Name, err)
		}
		saved = append(saved, w)
	}

	if s.publisher != nil {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   "",
			EntityType:      "module.widget",
			Operation:       "registered",
			Data:            buildWidgetRegisteredData(req.ModuleKey, req.ModuleName, req.Version, saved),
			AutoAcknowledge: true,
		})
	}

	protoWidgets := make([]*client.Widget, len(saved))
	for i, w := range saved {
		protoWidgets[i] = widgetToProto(w)
	}
	return &client.ListWidgetsResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Widgets registered successfully",
		},
		Widgets: protoWidgets,
	}, nil
}

func (s *moduleService) ListWidgets(ctx context.Context, req *client.ListWidgetsRequest) (*client.ListWidgetsResponse, error) {
	widgets, err := s.repo.ListWidgets(req.CreatedByType, req.CreatedByRef)
	if err != nil {
		return nil, err
	}
	protoWidgets := make([]*client.Widget, len(widgets))
	for i, w := range widgets {
		protoWidgets[i] = widgetToProto(w)
	}
	return &client.ListWidgetsResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Widgets retrieved successfully",
		},
		Widgets: protoWidgets,
	}, nil
}

func (s *moduleService) GetWidgetByCanonicalId(ctx context.Context, req *client.GetByCanonicalIdRequest) (*client.WidgetResponse, error) {
	moduleID, kind, manifestID, err := parseCanonicalID(req.CanonicalId)
	if err != nil {
		return nil, twirp.InvalidArgumentError("canonical_id", err.Error())
	}
	if kind != "widget" {
		return nil, twirp.InvalidArgumentError("canonical_id", fmt.Sprintf("expected kind 'widget', got %q", kind))
	}
	w, err := s.repo.GetWidgetByModuleAndManifestID(moduleID, manifestID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.NotFoundError(fmt.Sprintf("no widget %q", req.CanonicalId))
		}
		return nil, err
	}
	return &client.WidgetResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Widget retrieved successfully",
		},
		Widget: widgetToProto(w),
	}, nil
}

func (s *moduleService) DeleteWidgetsByModuleId(ctx context.Context, req *client.DeleteByModuleIdRequest) (*client.ResponseStatus, error) {
	widgets, err := s.repo.ListWidgetsByModulePrefix(req.ModuleId)
	if err != nil {
		return nil, err
	}
	if err := s.repo.DeleteWidgetsByModulePrefix(req.ModuleId); err != nil {
		return nil, err
	}
	if s.publisher != nil && len(widgets) > 0 {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   "",
			EntityType:      "module.widget",
			Operation:       "deregistered",
			Data:            buildWidgetDeregisteredData(req.ModuleId, widgets),
			AutoAcknowledge: true,
		})
	}
	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "Widgets deleted successfully",
	}, nil
}

func widgetToProto(w *models.Widget) *client.Widget {
	var alertTypes []string
	if w.AlertTypes != "" {
		json.Unmarshal([]byte(w.AlertTypes), &alertTypes)
	}
	if alertTypes == nil {
		alertTypes = []string{}
	}
	return &client.Widget{
		Id:             w.ID.String(),
		ModuleId:       moduleIDFromCreatedByRef(w.CreatedByRef),
		ManifestId:     w.ManifestID,
		Name:           w.Name,
		Description:    w.Description,
		Directory:      w.Directory,
		AlertTypes:     alertTypes,
		SettingsSchema: w.SettingsSchema,
		Surface:        w.Surface,
		CreatedByType:  w.CreatedByType,
		CreatedByRef:   w.CreatedByRef,
	}
}

// ---------------------------------------------------------------------
// Asset RPCs.
//
// Module-extension surface for static media (images / audio / video /
// fonts / data). Mirrors the action surface shape: idempotent upsert
// keyed on (created_by_type, created_by_ref, manifest_id), outbox
// events on `module.asset.{registered,deregistered}` so downstream
// consumers (Convex editor, etc.) can react.
// ---------------------------------------------------------------------

func (s *moduleService) RegisterAssets(ctx context.Context, req *client.RegisterAssetsRequest) (*client.ListAssetsResponse, error) {
	createdByType := "MODULE"
	createdByRef := req.ModuleKey
	if req.CreatedByType != "" && req.CreatedByRef != "" {
		createdByType = req.CreatedByType
		createdByRef = req.CreatedByRef
	}
	saved := make([]*models.Asset, 0, len(req.Assets))
	for _, in := range req.Assets {
		a := &models.Asset{
			ID:            uuid.New(),
			Name:          in.Name,
			Description:   in.Description,
			ManifestPath:  in.ManifestPath,
			RepositoryKey: in.RepositoryKey,
			Kind:          in.Kind,
			ContentType:   in.ContentType,
			CreatedByType: createdByType,
			CreatedByRef:  createdByRef,
			ManifestID:    in.ManifestId,
		}
		if err := s.repo.UpsertAsset(a); err != nil {
			return nil, fmt.Errorf("upsert asset %q: %w", in.Name, err)
		}
		saved = append(saved, a)
	}

	if s.publisher != nil {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   "",
			EntityType:      "module.asset",
			Operation:       "registered",
			Data:            buildAssetRegisteredData(req.ModuleKey, req.ModuleName, req.Version, saved),
			AutoAcknowledge: true,
		})
	}

	protoAssets := make([]*client.Asset, len(saved))
	for i, a := range saved {
		protoAssets[i] = assetToProto(a)
	}
	return &client.ListAssetsResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Assets registered successfully",
		},
		Assets: protoAssets,
	}, nil
}

func (s *moduleService) ListAssets(ctx context.Context, req *client.ListAssetsRequest) (*client.ListAssetsResponse, error) {
	assets, err := s.repo.ListAssets(req.CreatedByType, req.CreatedByRef)
	if err != nil {
		return nil, err
	}
	protoAssets := make([]*client.Asset, len(assets))
	for i, a := range assets {
		protoAssets[i] = assetToProto(a)
	}
	return &client.ListAssetsResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Assets retrieved successfully",
		},
		Assets: protoAssets,
	}, nil
}

func (s *moduleService) DeleteAssetsByModuleId(ctx context.Context, req *client.DeleteByModuleIdRequest) (*client.ResponseStatus, error) {
	// Capture rows for the deregistration event before deletion —
	// mirrors DeleteActionsByModuleId.
	assets, err := s.repo.ListAssetsByModulePrefix(req.ModuleId)
	if err != nil {
		return nil, err
	}
	if err := s.repo.DeleteAssetsByModulePrefix(req.ModuleId); err != nil {
		return nil, err
	}
	if s.publisher != nil && len(assets) > 0 {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   "",
			EntityType:      "module.asset",
			Operation:       "deregistered",
			Data:            buildAssetDeregisteredData(req.ModuleId, assets),
			AutoAcknowledge: true,
		})
	}
	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "Assets deleted successfully",
	}, nil
}

func assetToProto(a *models.Asset) *client.Asset {
	return &client.Asset{
		Id:            a.ID.String(),
		ModuleId:      moduleIDFromCreatedByRef(a.CreatedByRef),
		ManifestId:    a.ManifestID,
		Name:          a.Name,
		Description:   a.Description,
		ManifestPath:  a.ManifestPath,
		RepositoryKey: a.RepositoryKey,
		Kind:          a.Kind,
		ContentType:   a.ContentType,
		CreatedByType: a.CreatedByType,
		CreatedByRef:  a.CreatedByRef,
	}
}
