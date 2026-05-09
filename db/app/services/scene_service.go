package services

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// sceneService implements `client.SceneService` (Twirp-generated).
//
// Mirrors `workflowService` in shape — typed audit fields go through
// columns, the heavy `widgets_json` / `layout_json` payloads pass
// through as opaque strings the engine never inspects.
//
// Outbox publishing is opt-in via `publisher`. When set, every CRUD
// op emits a `db.scene.<op>.<applicationId>` event so downstream
// consumers (Convex projector, future cache layers) can react. When
// nil, the service is silent — useful for tests and for early-boot
// pre-NATS scenarios.
type sceneService struct {
	repo      *repo.SceneRepository
	publisher *workers.EventPublisher
}

func NewSceneService(
	sceneRepo *repo.SceneRepository,
	publisher *workers.EventPublisher,
) client.SceneService {
	return &sceneService{
		repo:      sceneRepo,
		publisher: publisher,
	}
}

func (s *sceneService) CreateScene(ctx context.Context, req *client.CreateSceneRequest) (*client.SceneResponse, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, twirp.InvalidArgumentError("application_id", "invalid UUID format")
	}
	if req.Name == "" {
		return nil, twirp.RequiredArgumentError("name")
	}

	widgetsJSON := req.WidgetsJson
	if widgetsJSON == "" {
		widgetsJSON = "[]"
	}
	layoutJSON := req.LayoutJson
	if layoutJSON == "" {
		layoutJSON = "{}"
	}
	createdByType := req.CreatedByType
	if createdByType == "" {
		createdByType = "USER"
	}

	scene := &models.Scene{
		ApplicationID: applicationID,
		Name:          req.Name,
		Description:   req.Description,
		WidgetsJSON:   widgetsJSON,
		LayoutJSON:    layoutJSON,
		CreatedByType: createdByType,
		CreatedByRef:  req.CreatedByRef,
	}

	if err := s.repo.Create(scene); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to create scene: %w", err))
	}

	s.publishChange(appIDStr, scene, "created")

	return &client.SceneResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Scene created successfully",
		},
		Scene: s.sceneToProto(scene),
	}, nil
}

func (s *sceneService) GetScene(ctx context.Context, req *client.GetSceneRequest) (*client.SceneResponse, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}

	scene, err := s.repo.GetByID(id)
	if err != nil {
		return nil, twirp.NotFoundError("scene not found")
	}

	return &client.SceneResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Scene retrieved successfully",
		},
		Scene: s.sceneToProto(scene),
	}, nil
}

func (s *sceneService) UpdateScene(ctx context.Context, req *client.UpdateSceneRequest) (*client.SceneResponse, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}
	scene, err := s.repo.GetByID(id)
	if err != nil {
		return nil, twirp.NotFoundError("scene not found")
	}

	// Patch semantics — empty string means "leave unchanged" for now.
	// Same convention as `UpdateWorkflowRequest`; revisit when the
	// rest of the request migrates to `optional` scalars.
	if req.Name != "" {
		scene.Name = req.Name
	}
	if req.Description != "" {
		scene.Description = req.Description
	}
	if req.WidgetsJson != "" {
		scene.WidgetsJSON = req.WidgetsJson
	}
	if req.LayoutJson != "" {
		scene.LayoutJSON = req.LayoutJson
	}

	if err := s.repo.Update(scene); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to update scene: %w", err))
	}

	s.publishChange(scene.ApplicationID.String(), scene, "updated")

	return &client.SceneResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Scene updated successfully",
		},
		Scene: s.sceneToProto(scene),
	}, nil
}

func (s *sceneService) DeleteScene(ctx context.Context, req *client.DeleteSceneRequest) (*client.ResponseStatus, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}
	scene, err := s.repo.GetByID(id)
	if err != nil {
		return nil, twirp.NotFoundError("scene not found")
	}

	if err := s.repo.Delete(scene); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to delete scene: %w", err))
	}

	s.publishChange(scene.ApplicationID.String(), scene, "deleted")

	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "Scene deleted successfully",
	}, nil
}

func (s *sceneService) ListScenes(ctx context.Context, req *client.ListScenesRequest) (*client.ListScenesResponse, error) {
	var scenes []*models.Scene
	var err error

	if req.ApplicationId != "" {
		appID, parseErr := uuid.Parse(req.ApplicationId)
		if parseErr != nil {
			return nil, twirp.InvalidArgumentError("application_id", "invalid UUID format")
		}
		scenes, err = s.repo.GetByApplicationID(appID)
	} else {
		scenes, err = s.repo.GetAll()
	}
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to list scenes: %w", err))
	}

	out := make([]*client.Scene, len(scenes))
	for i, sc := range scenes {
		out[i] = s.sceneToProto(sc)
	}

	return &client.ListScenesResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Scenes retrieved successfully",
		},
		Scenes:     out,
		TotalCount: int32(len(out)),
		Page:       req.Page,
		PageSize:   req.PageSize,
	}, nil
}

func (s *sceneService) sceneToProto(m *models.Scene) *client.Scene {
	// gorm doesn't surface the auto-managed `created_at` / `updated_at`
	// columns on the typed model today (same gap as `workflowToProto`);
	// leave them as nil-typed timestamps until a follow-up exposes them.
	var createdAt, updatedAt *timestamppb.Timestamp
	return &client.Scene{
		Id:            m.ID.String(),
		ApplicationId: m.ApplicationID.String(),
		Name:          m.Name,
		Description:   m.Description,
		WidgetsJson:   m.WidgetsJSON,
		LayoutJson:    m.LayoutJSON,
		CreatedByType: m.CreatedByType,
		CreatedByRef:  m.CreatedByRef,
		CreatedAt:     createdAt,
		UpdatedAt:     updatedAt,
	}
}

func (s *sceneService) publishChange(applicationID string, scene *models.Scene, op string) {
	if s.publisher == nil {
		return
	}
	s.publisher.Publish(workers.PublishOptions{
		ApplicationID:   applicationID,
		EntityType:      "scene",
		EntityID:        scene.ID.String(),
		Operation:       op,
		Data:            buildSceneChangeData(scene),
		AutoAcknowledge: true,
	})
}

func buildSceneChangeData(scene *models.Scene) map[string]interface{} {
	return map[string]interface{}{
		"id":              scene.ID.String(),
		"application_id":  scene.ApplicationID.String(),
		"name":            scene.Name,
		"description":     scene.Description,
		"widgets_json":    scene.WidgetsJSON,
		"layout_json":     scene.LayoutJSON,
		"created_by_type": scene.CreatedByType,
		"created_by_ref":  scene.CreatedByRef,
	}
}
