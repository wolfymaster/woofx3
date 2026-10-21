package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

// Limits on what the dashboard may store. A namespace names a kind of data
// (`dashboardLayouts`), so it stays short; a key is often an id the dashboard
// generated. The value cap leaves room for a large dashboard layout or a long
// note while keeping one row from growing without bound, and every change is
// also delivered whole in a `ui.setting.changed` webhook.
const (
	maxLocalUISettingNamespaceBytes = 64
	maxLocalUISettingKeyBytes       = 256
	maxLocalUISettingValueBytes     = 256 * 1024
)

// Page sizes for ListLocalUISettingChanges. The maximum bounds one response
// at roughly this many values of up to maxLocalUISettingValueBytes each.
const (
	defaultLocalUISettingChangesLimit = 100
	maxLocalUISettingChangesLimit     = 500
)

// localUISettingService implements `client.LocalUISettingService`. It
// publishes nothing to the outbox: the api, which calls it on the dashboard's
// behalf, announces each change itself, and a reader that missed one catches
// up with ListLocalUISettingChanges.
type localUISettingService struct {
	settings *repo.LocalUISettingRepository
	now      func() time.Time
}

func NewLocalUISettingService(settingRepo *repo.LocalUISettingRepository, now func() time.Time) client.LocalUISettingService {
	return &localUISettingService{
		settings: settingRepo,
		now:      now,
	}
}

func (s *localUISettingService) ListLocalUISettings(ctx context.Context, req *client.ListLocalUISettingsRequest) (*client.ListLocalUISettingsResponse, error) {
	if err := validateLocalUISettingNamespace(req.Namespace); err != nil {
		return nil, err
	}
	settings, err := s.settings.List(ctx, req.Namespace)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to list local ui settings: %w", err))
	}
	return &client.ListLocalUISettingsResponse{
		Status:   &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Local UI settings retrieved successfully"},
		Settings: localUISettingsToProto(settings),
	}, nil
}

func (s *localUISettingService) GetLocalUISetting(ctx context.Context, req *client.GetLocalUISettingRequest) (*client.GetLocalUISettingResponse, error) {
	if err := validateLocalUISettingAddress(req.Namespace, req.Key); err != nil {
		return nil, err
	}
	setting, err := s.settings.Get(ctx, req.Namespace, req.Key)
	if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && setting.Deleted) {
		return nil, twirp.NotFoundError("local ui setting not found")
	}
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to load local ui setting: %w", err))
	}
	return &client.GetLocalUISettingResponse{
		Status:  &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Local UI setting retrieved successfully"},
		Setting: localUISettingToProto(setting),
	}, nil
}

func (s *localUISettingService) SetLocalUISetting(ctx context.Context, req *client.SetLocalUISettingRequest) (*client.SetLocalUISettingResponse, error) {
	if err := validateLocalUISettingAddress(req.Namespace, req.Key); err != nil {
		return nil, err
	}
	if err := validateLocalUISettingValue(req.ValueJson); err != nil {
		return nil, err
	}
	if err := validateExpectedRevision(req.ExpectedRevision); err != nil {
		return nil, err
	}
	value := req.ValueJson
	status, setting, conflict, err := s.write(ctx, repo.LocalUISettingWrite{
		Namespace:        req.Namespace,
		Key:              req.Key,
		Value:            &value,
		ExpectedRevision: req.ExpectedRevision,
		At:               s.now(),
	})
	if err != nil {
		return nil, err
	}
	return &client.SetLocalUISettingResponse{Status: status, Setting: setting, Conflict: conflict}, nil
}

func (s *localUISettingService) DeleteLocalUISetting(ctx context.Context, req *client.DeleteLocalUISettingRequest) (*client.DeleteLocalUISettingResponse, error) {
	if err := validateLocalUISettingAddress(req.Namespace, req.Key); err != nil {
		return nil, err
	}
	if err := validateExpectedRevision(req.ExpectedRevision); err != nil {
		return nil, err
	}
	status, setting, conflict, err := s.write(ctx, repo.LocalUISettingWrite{
		Namespace:        req.Namespace,
		Key:              req.Key,
		ExpectedRevision: req.ExpectedRevision,
		At:               s.now(),
	})
	if err != nil {
		return nil, err
	}
	return &client.DeleteLocalUISettingResponse{Status: status, Setting: setting, Conflict: conflict}, nil
}

// write applies one set or delete and returns the fields both write
// responses share.
func (s *localUISettingService) write(ctx context.Context, write repo.LocalUISettingWrite) (*client.ResponseStatus, *client.LocalUISetting, bool, error) {
	result, err := s.settings.Write(ctx, write)
	if err != nil {
		return nil, nil, false, twirp.InternalErrorWith(fmt.Errorf("failed to write local ui setting: %w", err))
	}
	message := "Local UI setting written"
	if result.Conflict {
		message = "Local UI setting revision does not match the expected revision"
	}
	status := &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: message}
	if result.Setting == nil {
		return status, nil, result.Conflict, nil
	}
	return status, localUISettingToProto(result.Setting), result.Conflict, nil
}

func (s *localUISettingService) ListLocalUISettingChanges(ctx context.Context, req *client.ListLocalUISettingChangesRequest) (*client.ListLocalUISettingChangesResponse, error) {
	if req.AfterRevision < 0 {
		return nil, twirp.InvalidArgumentError("after_revision", "must not be negative")
	}
	limit := int(req.Limit)
	switch {
	case limit < 0:
		return nil, twirp.InvalidArgumentError("limit", "must not be negative")
	case limit == 0:
		limit = defaultLocalUISettingChangesLimit
	case limit > maxLocalUISettingChangesLimit:
		return nil, twirp.InvalidArgumentError("limit", fmt.Sprintf("must be at most %d", maxLocalUISettingChangesLimit))
	}

	settings, hasMore, err := s.settings.ChangesSince(ctx, req.AfterRevision, limit)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to list local ui setting changes: %w", err))
	}
	return &client.ListLocalUISettingChangesResponse{
		Status:   &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Local UI setting changes retrieved successfully"},
		Settings: localUISettingsToProto(settings),
		HasMore:  hasMore,
	}, nil
}

func validateLocalUISettingNamespace(namespace string) error {
	if namespace == "" {
		return twirp.RequiredArgumentError("namespace")
	}
	if len(namespace) > maxLocalUISettingNamespaceBytes {
		return twirp.InvalidArgumentError("namespace", fmt.Sprintf("must be at most %d bytes", maxLocalUISettingNamespaceBytes))
	}
	return nil
}

func validateLocalUISettingAddress(namespace, key string) error {
	if err := validateLocalUISettingNamespace(namespace); err != nil {
		return err
	}
	if key == "" {
		return twirp.RequiredArgumentError("key")
	}
	if len(key) > maxLocalUISettingKeyBytes {
		return twirp.InvalidArgumentError("key", fmt.Sprintf("must be at most %d bytes", maxLocalUISettingKeyBytes))
	}
	return nil
}

func validateLocalUISettingValue(valueJSON string) error {
	if valueJSON == "" {
		return twirp.RequiredArgumentError("value_json")
	}
	if len(valueJSON) > maxLocalUISettingValueBytes {
		return twirp.InvalidArgumentError("value_json", fmt.Sprintf("must be at most %d bytes", maxLocalUISettingValueBytes))
	}
	if !json.Valid([]byte(valueJSON)) {
		return twirp.InvalidArgumentError("value_json", "must be valid JSON")
	}
	return nil
}

func validateExpectedRevision(expected *int64) error {
	if expected != nil && *expected < 0 {
		return twirp.InvalidArgumentError("expected_revision", "must not be negative")
	}
	return nil
}

func localUISettingsToProto(settings []*models.LocalUISetting) []*client.LocalUISetting {
	out := make([]*client.LocalUISetting, 0, len(settings))
	for _, setting := range settings {
		out = append(out, localUISettingToProto(setting))
	}
	return out
}

func localUISettingToProto(m *models.LocalUISetting) *client.LocalUISetting {
	value := ""
	if m.Value != nil {
		value = *m.Value
	}
	return &client.LocalUISetting{
		Namespace: m.Namespace,
		Key:       m.Key,
		ValueJson: value,
		Revision:  m.Revision,
		UpdatedAt: timestamppb.New(m.UpdatedAt),
		Deleted:   m.Deleted,
	}
}
