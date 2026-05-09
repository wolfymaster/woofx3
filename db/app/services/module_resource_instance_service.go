package services

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

// Resource-instance RPCs live on the same `*moduleService` receiver as
// the rest of the ModuleService surface (Twirp generates one server
// interface per .proto service). The repository dependency is threaded
// through the constructor in module_service.go.

func (s *moduleService) CreateResourceInstance(ctx context.Context, req *client.CreateResourceInstanceRequest) (*client.ResourceInstanceResponse, error) {
	if s.instanceRepo == nil {
		return nil, twirp.NewError(twirp.Internal, "resource instance repository not configured")
	}
	kind := strings.TrimSpace(req.Kind)
	if kind == "" {
		return nil, twirp.RequiredArgumentError("kind")
	}
	instanceID := strings.TrimSpace(req.InstanceId)
	if instanceID == "" {
		return nil, twirp.RequiredArgumentError("instance_id")
	}
	if err := validateInstanceSegment(kind, "kind"); err != nil {
		return nil, twirp.InvalidArgumentError("kind", err.Error())
	}
	if err := validateInstanceSegment(instanceID, "instance_id"); err != nil {
		return nil, twirp.InvalidArgumentError("instance_id", err.Error())
	}

	// Resolve owning module — accept either `module_id` (UUID) or
	// `module_name` (manifest id). UUID wins when both are set so callers
	// that already have the UUID save a name lookup.
	var module *models.Module
	var resolveErr error
	switch {
	case strings.TrimSpace(req.ModuleId) != "":
		moduleID, parseErr := uuid.Parse(req.ModuleId)
		if parseErr != nil {
			return nil, twirp.InvalidArgumentError("module_id", "invalid UUID format")
		}
		module, resolveErr = s.repo.GetByID(moduleID)
	case strings.TrimSpace(req.ModuleName) != "":
		module, resolveErr = s.repo.GetByName(strings.TrimSpace(req.ModuleName))
	default:
		return nil, twirp.RequiredArgumentError("module_id or module_name")
	}
	if resolveErr != nil {
		if errors.Is(resolveErr, gorm.ErrRecordNotFound) {
			return nil, twirp.NotFoundError("module not found")
		}
		return nil, twirp.InternalErrorWith(fmt.Errorf("load module: %w", resolveErr))
	}
	moduleID := module.ID

	inst := &models.ModuleResourceInstance{
		ID:          uuid.New(),
		ModuleID:    moduleID,
		Kind:        kind,
		InstanceID:  instanceID,
		DisplayName: req.DisplayName,
	}
	if err := s.instanceRepo.Create(inst); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("create resource instance: %w", err))
	}

	s.publishInstanceEvent(req.RequestContext, module, inst, "created")

	return &client.ResourceInstanceResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Resource instance created successfully",
		},
		Instance: resourceInstanceToProto(module, inst),
	}, nil
}

func (s *moduleService) DeleteResourceInstance(ctx context.Context, req *client.DeleteResourceInstanceRequest) (*client.ResponseStatus, error) {
	if s.instanceRepo == nil {
		return nil, twirp.NewError(twirp.Internal, "resource instance repository not configured")
	}
	module, inst, err := s.resolveInstanceFromCanonical(req.CanonicalId)
	if err != nil {
		return nil, err
	}
	if err := s.instanceRepo.Delete(inst); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("delete resource instance: %w", err))
	}

	s.publishInstanceEvent(req.RequestContext, module, inst, "deleted")

	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "Resource instance deleted successfully",
	}, nil
}

func (s *moduleService) GetResourceInstance(ctx context.Context, req *client.GetResourceInstanceRequest) (*client.ResourceInstanceResponse, error) {
	if s.instanceRepo == nil {
		return nil, twirp.NewError(twirp.Internal, "resource instance repository not configured")
	}
	module, inst, err := s.resolveInstanceFromCanonical(req.CanonicalId)
	if err != nil {
		return nil, err
	}
	return &client.ResourceInstanceResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Resource instance retrieved successfully",
		},
		Instance: resourceInstanceToProto(module, inst),
	}, nil
}

func (s *moduleService) ListResourceInstancesByKind(ctx context.Context, req *client.ListResourceInstancesByKindRequest) (*client.ListResourceInstancesResponse, error) {
	if s.instanceRepo == nil {
		return nil, twirp.NewError(twirp.Internal, "resource instance repository not configured")
	}
	kind := strings.TrimSpace(req.Kind)
	if kind == "" {
		return nil, twirp.RequiredArgumentError("kind")
	}
	instances, err := s.instanceRepo.ListByKind(kind)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("list instances by kind: %w", err))
	}
	return s.respondWithInstances(instances)
}

func (s *moduleService) ListResourceInstancesByModule(ctx context.Context, req *client.ListResourceInstancesByModuleRequest) (*client.ListResourceInstancesResponse, error) {
	if s.instanceRepo == nil {
		return nil, twirp.NewError(twirp.Internal, "resource instance repository not configured")
	}
	moduleID, err := uuid.Parse(req.ModuleId)
	if err != nil {
		return nil, twirp.InvalidArgumentError("module_id", "invalid UUID format")
	}
	instances, err := s.instanceRepo.ListByModuleID(moduleID)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("list instances by module: %w", err))
	}
	return s.respondWithInstances(instances)
}

// resolveInstanceFromCanonical parses a canonical id and looks up the
// owning module + instance row in one shot. Returns Twirp errors so
// callers can return them directly.
func (s *moduleService) resolveInstanceFromCanonical(canonicalID string) (*models.Module, *models.ModuleResourceInstance, error) {
	moduleSeg, kind, instanceID, err := parseCanonicalID(canonicalID)
	if err != nil {
		return nil, nil, twirp.InvalidArgumentError("canonical_id", err.Error())
	}
	module, err := s.repo.GetByName(moduleSeg)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, twirp.NotFoundError(fmt.Sprintf("module %q not found", moduleSeg))
		}
		return nil, nil, twirp.InternalErrorWith(fmt.Errorf("load module: %w", err))
	}
	inst, err := s.instanceRepo.GetByModuleKindInstance(module.ID, kind, instanceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, twirp.NotFoundError(fmt.Sprintf("instance %q not found", canonicalID))
		}
		return nil, nil, twirp.InternalErrorWith(fmt.Errorf("load instance: %w", err))
	}
	return module, inst, nil
}

func (s *moduleService) respondWithInstances(instances []*models.ModuleResourceInstance) (*client.ListResourceInstancesResponse, error) {
	moduleByID := make(map[uuid.UUID]*models.Module, len(instances))
	out := make([]*client.ModuleResourceInstance, 0, len(instances))
	for _, inst := range instances {
		m, ok := moduleByID[inst.ModuleID]
		if !ok {
			module, err := s.repo.GetByID(inst.ModuleID)
			if err != nil {
				// Skip orphaned rows. The FK cascade should keep this from
				// happening in practice — log nothing here, the consumer
				// gets a clean list.
				continue
			}
			moduleByID[inst.ModuleID] = module
			m = module
		}
		out = append(out, resourceInstanceToProto(m, inst))
	}
	return &client.ListResourceInstancesResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: fmt.Sprintf("Found %d resource instance(s)", len(out)),
		},
		Instances: out,
	}, nil
}

func (s *moduleService) publishInstanceEvent(reqCtx *client.RequestContext, module *models.Module, inst *models.ModuleResourceInstance, op string) {
	if s.publisher == nil {
		return
	}
	applicationID := ""
	clientID := ""
	if reqCtx != nil {
		applicationID = reqCtx.ApplicationId
		clientID = reqCtx.ClientId
	}
	s.publisher.Publish(workers.PublishOptions{
		ApplicationID:   applicationID,
		ClientID:        clientID,
		EntityType:      "module.resource.instance",
		EntityID:        inst.ID.String(),
		Operation:       op,
		Data:            buildResourceInstanceData(module, inst),
		AutoAcknowledge: true,
	})
}

// validateInstanceSegment enforces the same character set as
// barkloader's `validate_segment`: [A-Za-z0-9._-]+, non-empty. Mirrors
// `barkloader/.../canonical_id.rs:validate_segment` so kind and
// instance_id round-trip through the canonical id format without
// surprises.
func validateInstanceSegment(value, label string) error {
	if value == "" {
		return fmt.Errorf("%s segment is empty", label)
	}
	for _, c := range value {
		ok := (c >= 'A' && c <= 'Z') ||
			(c >= 'a' && c <= 'z') ||
			(c >= '0' && c <= '9') ||
			c == '.' || c == '_' || c == '-'
		if !ok {
			return fmt.Errorf("%s segment %q contains disallowed character %q; allowed: [A-Za-z0-9._-]", label, value, c)
		}
	}
	return nil
}

func resourceInstanceToProto(module *models.Module, inst *models.ModuleResourceInstance) *client.ModuleResourceInstance {
	moduleName := ""
	if module != nil {
		moduleName = module.Name
	}
	canonicalID := ""
	if moduleName != "" {
		canonicalID = canonicalIDFor(moduleName, inst.Kind, inst.InstanceID)
	}
	return &client.ModuleResourceInstance{
		Id:          inst.ID.String(),
		ModuleId:    inst.ModuleID.String(),
		ModuleName:  moduleName,
		Kind:        inst.Kind,
		InstanceId:  inst.InstanceID,
		DisplayName: inst.DisplayName,
		CanonicalId: canonicalID,
		CreatedAt:   timestamppb.New(inst.CreatedAt),
		UpdatedAt:   timestamppb.New(inst.UpdatedAt),
	}
}

// buildResourceInstanceData is the snake_case payload for
// `db.module.resource.instance.{created,deleted}.<appId>` outbox events.
// Mirrors the trigger / action builders in module_event_payload.go.
func buildResourceInstanceData(module *models.Module, inst *models.ModuleResourceInstance) map[string]interface{} {
	moduleName := ""
	if module != nil {
		moduleName = module.Name
	}
	canonicalID := ""
	if moduleName != "" {
		canonicalID = canonicalIDFor(moduleName, inst.Kind, inst.InstanceID)
	}
	return map[string]interface{}{
		"id":           inst.ID.String(),
		"module_id":    inst.ModuleID.String(),
		"module_name":  moduleName,
		"kind":         inst.Kind,
		"instance_id":  inst.InstanceID,
		"display_name": inst.DisplayName,
		"canonical_id": canonicalID,
	}
}
