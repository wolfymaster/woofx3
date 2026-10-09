package services

import (
	"bytes"
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

	settings, err := normalizeInstanceSettings(req.SettingsJson)
	if err != nil {
		return nil, twirp.InvalidArgumentError("settings_json", err.Error())
	}

	inst := &models.ModuleResourceInstance{
		ID:          uuid.New(),
		ModuleID:    moduleID,
		Kind:        kind,
		InstanceID:  instanceID,
		DisplayName: req.DisplayName,
		Settings:    settings,
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

// UpdateResourceInstance changes an instance's name and settings. What it is
// addressed by does not change, so every workflow, command and widget holding
// its canonical id keeps working.
func (s *moduleService) UpdateResourceInstance(ctx context.Context, req *client.UpdateResourceInstanceRequest) (*client.ResourceInstanceResponse, error) {
	if s.instanceRepo == nil {
		return nil, twirp.NewError(twirp.Internal, "resource instance repository not configured")
	}
	module, inst, err := s.resolveInstanceFromCanonical(req.CanonicalId)
	if err != nil {
		return nil, err
	}

	settings, err := normalizeInstanceSettings(req.SettingsJson)
	if err != nil {
		return nil, twirp.InvalidArgumentError("settings_json", err.Error())
	}

	inst.DisplayName = req.DisplayName
	inst.Settings = settings
	if err := s.instanceRepo.Update(inst); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("update resource instance: %w", err))
	}

	s.publishInstanceEvent(req.RequestContext, module, inst, "updated")

	return &client.ResourceInstanceResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Resource instance updated successfully",
		},
		Instance: resourceInstanceToProto(module, inst),
	}, nil
}

// instanceSettingCASAttempts bounds how often CompareAndSetResourceInstanceSetting
// re-reads an instance whose settings changed between its read and its write.
// Each retry means another writer swapped in the meantime, so the bound is
// only reached under sustained contention, which answers as not swapped.
const instanceSettingCASAttempts = 8

// CompareAndSetResourceInstanceSetting writes one key of an instance's
// settings only while that key still holds the expected value, so concurrent
// read-modify-write updates, such as two runs each adding an entry to a
// wheel's list, can't lose one another's change. Only the module that owns the
// instance may write it: a kind's settings mean something only to the module
// that declares the kind.
//
// The settings are one JSON object, so the write replaces the whole object
// only while it is still the one this call read. A change to another key in
// the meantime is not a conflict for this one; the call reads again and
// decides afresh.
func (s *moduleService) CompareAndSetResourceInstanceSetting(ctx context.Context, req *client.CompareAndSetResourceInstanceSettingRequest) (*client.CompareAndSetResourceInstanceSettingResponse, error) {
	if s.instanceRepo == nil {
		return nil, twirp.NewError(twirp.Internal, "resource instance repository not configured")
	}
	if req.Key == "" {
		return nil, twirp.RequiredArgumentError("key")
	}
	caller := strings.TrimSpace(req.ModuleName)
	if caller == "" {
		return nil, twirp.RequiredArgumentError("module_name")
	}
	expected, err := decodeOptionalJSON(req.ExpectedJson)
	if err != nil {
		return nil, twirp.InvalidArgumentError("expected_json", err.Error())
	}
	if strings.TrimSpace(req.ValueJson) == "" {
		return nil, twirp.RequiredArgumentError("value_json")
	}
	var value json.RawMessage
	if err := json.Unmarshal([]byte(req.ValueJson), &value); err != nil {
		return nil, twirp.InvalidArgumentError("value_json", fmt.Sprintf("must be JSON: %v", err))
	}

	module, inst, err := s.resolveInstanceFromCanonical(req.CanonicalId)
	if err != nil {
		return nil, err
	}
	if owner := instanceModuleName(module); owner != caller {
		return nil, twirp.NewError(twirp.PermissionDenied,
			fmt.Sprintf("module %q may not write the settings of %q, which module %q owns", caller, req.CanonicalId, owner))
	}

	for attempt := 0; attempt < instanceSettingCASAttempts; attempt++ {
		read := instanceSettingsOrEmpty(inst.Settings)
		settings := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(read), &settings); err != nil || settings == nil {
			return nil, twirp.InternalErrorWith(fmt.Errorf("instance %q holds settings that are not a JSON object", req.CanonicalId))
		}
		current, present := settings[req.Key]
		matches, err := instanceSettingMatches(current, present, expected)
		if err != nil {
			return nil, twirp.InternalErrorWith(fmt.Errorf("read setting %q of %q: %w", req.Key, req.CanonicalId, err))
		}
		if !matches {
			return &client.CompareAndSetResourceInstanceSettingResponse{Swapped: false, CurrentJson: string(current)}, nil
		}

		settings[req.Key] = emptyListWhereAListWas(current, value)
		written, err := encodeInstanceSettings(settings)
		if err != nil {
			return nil, twirp.InternalErrorWith(fmt.Errorf("encode settings of %q: %w", req.CanonicalId, err))
		}
		swapped, err := s.instanceRepo.CompareAndSetSettings(inst.ID, inst.Settings, written)
		if err != nil {
			return nil, twirp.InternalErrorWith(fmt.Errorf("write settings of %q: %w", req.CanonicalId, err))
		}
		if swapped {
			inst.Settings = written
			s.publishInstanceEvent(req.RequestContext, module, inst, "updated")
			return &client.CompareAndSetResourceInstanceSettingResponse{Swapped: true, CurrentJson: string(settings[req.Key])}, nil
		}

		inst, err = s.instanceRepo.GetByID(inst.ID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, twirp.NotFoundError(fmt.Sprintf("instance %q not found", req.CanonicalId))
			}
			return nil, twirp.InternalErrorWith(fmt.Errorf("load instance: %w", err))
		}
	}

	settings := map[string]json.RawMessage{}
	_ = json.Unmarshal([]byte(instanceSettingsOrEmpty(inst.Settings)), &settings)
	return &client.CompareAndSetResourceInstanceSettingResponse{Swapped: false, CurrentJson: string(settings[req.Key])}, nil
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

// ListAllResourceInstances backs the Convex UI's periodic full-snapshot
// reconcile — lets it self-heal its cache from the engine's authoritative
// data instead of relying solely on webhook delivery.
func (s *moduleService) ListAllResourceInstances(ctx context.Context, req *client.ListAllResourceInstancesRequest) (*client.ListResourceInstancesResponse, error) {
	if s.instanceRepo == nil {
		return nil, twirp.NewError(twirp.Internal, "resource instance repository not configured")
	}
	instances, err := s.instanceRepo.ListAll()
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("list all instances: %w", err))
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
	clientID := ""
	if reqCtx != nil {
		clientID = reqCtx.ClientId
	}
	s.publisher.Publish(workers.PublishOptions{
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

// instanceModuleName is the module segment of an instance's canonical id: the
// owning module's manifest id, which is what modules, workflows and the
// dashboard address instances by. `Name` is the manifest's display name and is
// only a fallback for a row installed before the manifest id was recorded.
func instanceModuleName(module *models.Module) string {
	if module == nil {
		return ""
	}
	if module.ModuleID != "" {
		return module.ModuleID
	}
	return module.Name
}

func resourceInstanceToProto(module *models.Module, inst *models.ModuleResourceInstance) *client.ModuleResourceInstance {
	moduleName := instanceModuleName(module)
	canonicalID := ""
	if moduleName != "" {
		canonicalID = canonicalIDFor(moduleName, inst.Kind, inst.InstanceID)
	}
	moduleKey := ""
	if module != nil {
		moduleKey = module.ModuleKey
	}
	return &client.ModuleResourceInstance{
		Id:           inst.ID.String(),
		ModuleId:     inst.ModuleID.String(),
		ModuleName:   moduleName,
		Kind:         inst.Kind,
		InstanceId:   inst.InstanceID,
		DisplayName:  inst.DisplayName,
		CanonicalId:  canonicalID,
		CreatedAt:    timestamppb.New(inst.CreatedAt),
		UpdatedAt:    timestamppb.New(inst.UpdatedAt),
		ModuleKey:    moduleKey,
		SettingsJson: instanceSettingsOrEmpty(inst.Settings),
	}
}

// normalizeInstanceSettings accepts what the create form produced. The engine
// does not know what a kind's settings mean, but it does refuse anything that
// is not a JSON object, so every reader can decode one without a special case.
func normalizeInstanceSettings(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return "{}", nil
	}
	var settings map[string]any
	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		return "", fmt.Errorf("must be a JSON object: %w", err)
	}
	if settings == nil {
		return "{}", nil
	}
	return raw, nil
}

func instanceSettingsOrEmpty(settings string) string {
	if strings.TrimSpace(settings) == "" {
		return "{}"
	}
	return settings
}

// buildResourceInstanceData is the snake_case payload for
// `db.module.resource.instance.{created,deleted}.system` outbox events.
// Mirrors the trigger / action builders in module_event_payload.go.
func buildResourceInstanceData(module *models.Module, inst *models.ModuleResourceInstance) map[string]interface{} {
	moduleName := instanceModuleName(module)
	moduleKey := ""
	if module != nil {
		moduleKey = module.ModuleKey
	}
	canonicalID := ""
	if moduleName != "" {
		canonicalID = canonicalIDFor(moduleName, inst.Kind, inst.InstanceID)
	}
	return map[string]interface{}{
		"id":            inst.ID.String(),
		"module_id":     inst.ModuleID.String(),
		"module_name":   moduleName,
		"kind":          inst.Kind,
		"instance_id":   inst.InstanceID,
		"display_name":  inst.DisplayName,
		"canonical_id":  canonicalID,
		"module_key":    moduleKey,
		"settings_json": instanceSettingsOrEmpty(inst.Settings),
	}
}

// decodeOptionalJSON reads a JSON value that may be left out: empty text and
// `null` both read as nil.
func decodeOptionalJSON(raw string) (any, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil, fmt.Errorf("must be JSON: %w", err)
	}
	return value, nil
}

// instanceSettingMatches reports whether a settings key holds what a caller
// expects. A key the instance does not hold reads as null, which is what a
// function reading it sees (undefined in JavaScript, nil in Lua), so a nil
// expectation matches it.
func instanceSettingMatches(current json.RawMessage, present bool, expected any) (bool, error) {
	if !present {
		return expected == nil, nil
	}
	var stored any
	if err := json.Unmarshal(current, &stored); err != nil {
		return false, err
	}
	return settingValuesEqual(stored, expected), nil
}

// settingValuesEqual reports whether two decoded JSON values are the same as a
// module function reads them: numbers by value (1 equals 1.0), objects
// regardless of key order, and an empty object equal to an empty array,
// because Lua has one empty table for both. Must match `setting_values_equal`
// in barkloader/lib_sandbox/src/host/mod.rs.
func settingValuesEqual(a, b any) bool {
	switch x := a.(type) {
	case []any:
		switch y := b.(type) {
		case []any:
			if len(x) != len(y) {
				return false
			}
			for i := range x {
				if !settingValuesEqual(x[i], y[i]) {
					return false
				}
			}
			return true
		case map[string]any:
			return len(x) == 0 && len(y) == 0
		default:
			return false
		}
	case map[string]any:
		switch y := b.(type) {
		case map[string]any:
			if len(x) != len(y) {
				return false
			}
			for k, v := range x {
				w, ok := y[k]
				if !ok || !settingValuesEqual(v, w) {
					return false
				}
			}
			return true
		case []any:
			return len(x) == 0 && len(y) == 0
		default:
			return false
		}
	default:
		return a == b
	}
}

// emptyListWhereAListWas writes an empty object replacing a list as an empty
// list. Lua has one empty table for both, so a Lua function clearing a list
// hands over `{}`, and every reader of the list expects an array.
func emptyListWhereAListWas(current, value json.RawMessage) json.RawMessage {
	if !strings.HasPrefix(strings.TrimSpace(string(current)), "[") {
		return value
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(value, &object); err != nil || object == nil || len(object) != 0 {
		return value
	}
	return json.RawMessage("[]")
}

// encodeInstanceSettings writes settings back as compact JSON. HTML escaping is
// off so text a streamer typed is stored as they typed it.
func encodeInstanceSettings(settings map[string]json.RawMessage) (string, error) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(settings); err != nil {
		return "", err
	}
	return strings.TrimSuffix(buf.String(), "\n"), nil
}
