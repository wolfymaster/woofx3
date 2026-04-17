package services

import (
	"context"
	"errors"
	"fmt"

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
	repo      *repo.ModuleRepository
	refRepo   *repo.ResourceReferenceRepository
	publisher *workers.EventPublisher
}

func NewModuleService(
	moduleRepo *repo.ModuleRepository,
	refRepo *repo.ResourceReferenceRepository,
	publisher *workers.EventPublisher,
) *moduleService {
	return &moduleService{
		repo:      moduleRepo,
		refRepo:   refRepo,
		publisher: publisher,
	}
}

func (s *moduleService) CreateModule(ctx context.Context, req *client.CreateModuleRequest) (*client.ModuleResponse, error) {
	// Idempotency: if a module with this module_key already exists, return it as success
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
			CreatedByType: "MODULE",
			CreatedByRef:  req.ModuleKey,
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

func (s *moduleService) DeleteTriggersByModuleId(ctx context.Context, req *client.DeleteByModuleIdRequest) (*client.ResponseStatus, error) {
	if err := s.repo.DeleteTriggersByModulePrefix(req.ModuleId); err != nil {
		return nil, err
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
	}
}

func (s *moduleService) RegisterActions(ctx context.Context, req *client.RegisterActionsRequest) (*client.ListActionsResponse, error) {
	saved := make([]*models.Action, 0, len(req.Actions))
	for _, in := range req.Actions {
		a := &models.Action{
			ID:            uuid.New(),
			Name:          in.Name,
			Description:   in.Description,
			Call:          in.Call,
			ParamsSchema:  in.ParamsSchema,
			CreatedByType: "MODULE",
			CreatedByRef:  req.ModuleKey,
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

func (s *moduleService) DeleteActionsByModuleId(ctx context.Context, req *client.DeleteByModuleIdRequest) (*client.ResponseStatus, error) {
	if err := s.repo.DeleteActionsByModulePrefix(req.ModuleId); err != nil {
		return nil, err
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

	if s.publisher != nil {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   applicationID,
			ClientID:        clientID,
			EntityType:      "module",
			EntityID:        req.ModuleId,
			Operation:       operation,
			Data: map[string]interface{}{
				"module_id":   req.ModuleId,
				"module_name": req.ModuleName,
				"module_key":  moduleKey,
				"version":     req.Version,
				"status":      req.Status,
				"error":       req.Error,
			},
			AutoAcknowledge: true,
		})
	}

	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: fmt.Sprintf("Module install %s notification sent", operation),
	}, nil
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

		for _, ref := range refs {
			res, ok := resourceByKey[key{ref.TargetType, ref.TargetName}]
			if !ok {
				continue
			}
			usage, ok := usageByResource[res.ID]
			if !ok {
				usage = &client.ResourceUsage{
					ResourceId:   res.ID.String(),
					ResourceType: res.ResourceType,
					ResourceName: res.ResourceName,
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
			"resource_id":   r.ResourceId,
			"resource_type": r.ResourceType,
			"resource_name": r.ResourceName,
			"used_by":       usedBy,
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
