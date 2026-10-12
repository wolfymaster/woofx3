package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	refsvc "github.com/wolfymaster/woofx3/db/app/services/resource_reference"
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
// op emits a `db.scene.<op>.system` event so downstream
// consumers (Convex projector, future cache layers) can react. When
// nil, the service is silent — useful for tests and for early-boot
// pre-NATS scenarios.
type sceneService struct {
	repo *repo.SceneRepository
	// Deleting a scene has to revoke the tokens that address it; without this
	// they keep resolving to an id nothing answers for.
	overlayTokenRepo *repo.OverlayTokenRepository
	// Records the themes a scene's widgets select, which is what keeps an
	// on-screen theme from being uninstalled. Optional, as for workflows.
	refRepo   *repo.ResourceReferenceRepository
	publisher *workers.EventPublisher
}

func NewSceneService(
	sceneRepo *repo.SceneRepository,
	overlayTokenRepo *repo.OverlayTokenRepository,
	refRepo *repo.ResourceReferenceRepository,
	publisher *workers.EventPublisher,
) client.SceneService {
	return &sceneService{
		repo:             sceneRepo,
		overlayTokenRepo: overlayTokenRepo,
		refRepo:          refRepo,
		publisher:        publisher,
	}
}

// syncSceneEdges recomputes the resource_references edges for a scene.
// Failures are logged but do not fail the parent request: the edges are a
// secondary index and the scene row is already written.
func (s *sceneService) syncSceneEdges(scene *models.Scene) {
	if s.refRepo == nil {
		return
	}
	src := refsvc.SceneSource{
		ID:                  scene.ID,
		Name:                scene.Name,
		SourceCreatedByType: scene.CreatedByType,
		SourceCreatedByRef:  scene.CreatedByRef,
	}
	edges := refsvc.ExtractSceneEdges(src, scene.WidgetsJSON)
	if err := s.refRepo.ReplaceEdgesForSource("scene", scene.ID, edges); err != nil {
		log.Printf("scene_service: ReplaceEdgesForSource failed for scene %s: %v", scene.ID, err)
	}
}

func (s *sceneService) CreateScene(ctx context.Context, req *client.CreateSceneRequest) (*client.SceneResponse, error) {
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
	kind := req.Kind
	if kind == "" {
		kind = models.SceneKindScene
	}
	if !isSceneKind(kind) {
		return nil, twirp.InvalidArgumentError("kind", `must be "scene" or "alert"`)
	}
	behaviorsJSON := req.BehaviorsJson
	if behaviorsJSON == "" {
		behaviorsJSON = "{}"
	}
	if !isJSONObject(behaviorsJSON) {
		return nil, twirp.InvalidArgumentError("behaviors_json", "must be a JSON object")
	}
	inputsJSON := req.InputsJson
	if inputsJSON == "" {
		inputsJSON = "[]"
	}
	if problem := invalidInputs(inputsJSON); problem != "" {
		return nil, twirp.InvalidArgumentError("inputs_json", problem)
	}

	// The id is assigned here: the column default is Postgres-only
	// (uuid_generate_v4()), and on SQLite every row would get the zero UUID.
	scene := &models.Scene{
		ID:            uuid.New(),
		Kind:          kind,
		BehaviorsJSON: behaviorsJSON,
		InputsJSON:    inputsJSON,
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
	s.syncSceneEdges(scene)

	s.publishChange(scene, "created")

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

// isJSONObject reports whether text is valid JSON whose top level is an object.
func isJSONObject(text string) bool {
	if !json.Valid([]byte(text)) {
		return false
	}
	trimmed := strings.TrimLeft(text, " \t\r\n")
	return strings.HasPrefix(trimmed, "{")
}

func isSceneKind(kind string) bool {
	return kind == models.SceneKindScene || kind == models.SceneKindAlert
}

// invalidInputs says why text is not a composition's inputs, or "" when it
// is: a JSON array of input fields, each an object with a non-empty `id`
// (unique among them) and `type` and a string `label`, the fields every
// input renderer needs. Other fields are the field type's own and pass as
// they are.
func invalidInputs(text string) string {
	var fields []map[string]any
	if err := json.Unmarshal([]byte(text), &fields); err != nil {
		return "must be a JSON array of objects"
	}
	seen := make(map[string]bool, len(fields))
	for i, field := range fields {
		id, _ := field["id"].(string)
		fieldType, _ := field["type"].(string)
		_, labelIsText := field["label"].(string)
		if id == "" || fieldType == "" || !labelIsText {
			return fmt.Sprintf("input %d needs a non-empty id and type and a string label", i)
		}
		if seen[id] {
			return fmt.Sprintf("input id %q is declared twice", id)
		}
		seen[id] = true
	}
	return ""
}

// The columns holding a scene's documents; writing any of them without
// editor state clears the stored editor state.
var sceneDocumentColumns = []string{
	"widgets_json", "layout_json", "behaviors_json", "inputs_json",
	"draft_widgets_json", "draft_layout_json", "draft_behaviors_json",
}

func (s *sceneService) UpdateScene(ctx context.Context, req *client.UpdateSceneRequest) (*client.SceneResponse, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}
	if req.EditorStateJson != "" && req.ClearEditorState {
		return nil, twirp.InvalidArgumentError("clear_editor_state", "cannot be set together with editor_state_json")
	}
	if req.EditorStateJson != "" && !isJSONObject(req.EditorStateJson) {
		return nil, twirp.InvalidArgumentError("editor_state_json", "must be a JSON object")
	}
	if req.BehaviorsJson != "" && !isJSONObject(req.BehaviorsJson) {
		return nil, twirp.InvalidArgumentError("behaviors_json", "must be a JSON object")
	}
	writesDraft := !req.ClearDraft && req.DraftWidgetsJson != "" && req.DraftLayoutJson != ""
	if req.DraftBehaviorsJson != "" && !writesDraft {
		return nil, twirp.InvalidArgumentError("draft_behaviors_json", "is stored only with a draft")
	}
	if req.DraftBehaviorsJson != "" && !isJSONObject(req.DraftBehaviorsJson) {
		return nil, twirp.InvalidArgumentError("draft_behaviors_json", "must be a JSON object")
	}
	if req.InputsJson != "" {
		if problem := invalidInputs(req.InputsJson); problem != "" {
			return nil, twirp.InvalidArgumentError("inputs_json", problem)
		}
	}
	scene, err := s.repo.GetByID(id)
	if err != nil {
		return nil, twirp.NotFoundError("scene not found")
	}

	// Patch semantics — empty string means "leave unchanged" for now.
	// Same convention as `UpdateWorkflowRequest`; revisit when the
	// rest of the request migrates to `optional` scalars.
	columns := map[string]any{}
	if req.Name != "" {
		columns["name"] = req.Name
	}
	if req.Description != "" {
		columns["description"] = req.Description
	}
	if req.WidgetsJson != "" {
		columns["widgets_json"] = req.WidgetsJson
	}
	if req.LayoutJson != "" {
		columns["layout_json"] = req.LayoutJson
	}
	if req.BehaviorsJson != "" {
		columns["behaviors_json"] = req.BehaviorsJson
	}
	if req.InputsJson != "" {
		columns["inputs_json"] = req.InputsJson
	}
	if req.ClearDraft {
		columns["draft_widgets_json"], columns["draft_layout_json"], columns["draft_behaviors_json"] = nil, nil, nil
	} else if writesDraft {
		draftBehaviors := req.DraftBehaviorsJson
		if draftBehaviors == "" {
			draftBehaviors = "{}"
		}
		columns["draft_widgets_json"], columns["draft_layout_json"] = req.DraftWidgetsJson, req.DraftLayoutJson
		columns["draft_behaviors_json"] = draftBehaviors
	}
	changesDocuments := false
	for _, column := range sceneDocumentColumns {
		if _, ok := columns[column]; ok {
			changesDocuments = true
		}
	}
	// Editor state describes the documents stored beside it. A document
	// write that carries no state (an external save) makes the stored state
	// describe other documents, so it is cleared and the editor starts over.
	if req.EditorStateJson != "" {
		columns["editor_state_json"] = req.EditorStateJson
	} else if req.ClearEditorState || changesDocuments {
		columns["editor_state_json"] = nil
	}

	// Only the named columns are written, in one statement: a concurrent
	// writer's columns survive, and documents, draft and editor state are
	// stored together or not at all.
	if len(columns) > 0 {
		if err := s.repo.UpdateColumns(id, columns); err != nil {
			return nil, twirp.InternalErrorWith(fmt.Errorf("failed to update scene: %w", err))
		}
	}
	scene, err = s.repo.GetByID(id)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to reload scene: %w", err))
	}
	s.syncSceneEdges(scene)

	s.publishChange(scene, "updated")

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

	// Revoke first. A token that outlives its scene still resolves -- the
	// overlay shell renders empty and the only explanation is a log line, which
	// from a browser source is indistinguishable from a scene with nothing to
	// show. Revoking rather than deleting matches how tokens are retired
	// everywhere else (see `tombstone`): the row is the operator's history, and
	// the outbox event it emits is what poisons the resolver caches holding the
	// old mapping.
	//
	// Done before the delete so a failure here leaves the scene intact and the
	// operation retryable, rather than a deleted scene with live tokens.
	revoked, err := s.revokeTokensForScene(scene)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to revoke overlay tokens for scene: %w", err))
	}

	if err := s.repo.Delete(scene); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to delete scene: %w", err))
	}
	if s.refRepo != nil {
		if err := s.refRepo.DeleteEdgesBySource("scene", scene.ID); err != nil {
			log.Printf("scene_service: DeleteEdgesBySource failed for scene %s: %v", scene.ID, err)
		}
	}

	s.publishChange(scene, "deleted")

	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: fmt.Sprintf("Scene deleted successfully; revoked %d overlay token(s)", revoked),
	}, nil
}

// revokeTokensForScene tombstones every still-active token addressing the
// scene, returning how many were retired.
//
// Already-revoked tokens are left alone so their `revoked_at` keeps saying
// when they were actually retired, and no duplicate outbox event is emitted
// for them.
func (s *sceneService) revokeTokensForScene(scene *models.Scene) (int, error) {
	if s.overlayTokenRepo == nil {
		return 0, nil
	}
	sceneID := scene.ID
	tokens, err := s.overlayTokenRepo.List(&sceneID, false)
	if err != nil {
		return 0, err
	}
	revoked := 0
	for _, token := range tokens {
		if token.Status == models.OverlayTokenStatusRevoked {
			continue
		}
		if err := tombstone(s.overlayTokenRepo, token); err != nil {
			return revoked, err
		}
		s.publishOverlayTokenChange(token, "updated")
		revoked++
	}
	return revoked, nil
}

// publishOverlayTokenChange mirrors overlayTokenService.publishChange so a
// cascade emits the same event shape a direct revoke does -- subscribers
// poisoning their caches cannot tell, and should not have to.
func (s *sceneService) publishOverlayTokenChange(token *models.OverlayToken, op string) {
	if s.publisher == nil {
		return
	}
	s.publisher.Publish(workers.PublishOptions{
		EntityType:      "overlay_token",
		EntityID:        token.ID.String(),
		Operation:       op,
		Data:            buildOverlayTokenChangeData(token),
		AutoAcknowledge: true,
	})
}

func (s *sceneService) ListScenes(ctx context.Context, req *client.ListScenesRequest) (*client.ListScenesResponse, error) {
	kind := req.Kind
	if kind == "" {
		kind = models.SceneKindScene
	}
	if !isSceneKind(kind) {
		return nil, twirp.InvalidArgumentError("kind", `must be "scene" or "alert"`)
	}
	scenes, err := s.repo.ListByKind(kind)
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
	scene := &client.Scene{
		Id:            m.ID.String(),
		Kind:          m.Kind,
		BehaviorsJson: m.BehaviorsJSON,
		InputsJson:    m.InputsJSON,
		Name:          m.Name,
		Description:   m.Description,
		WidgetsJson:   m.WidgetsJSON,
		LayoutJson:    m.LayoutJSON,
		CreatedByType: m.CreatedByType,
		CreatedByRef:  m.CreatedByRef,
		CreatedAt:     createdAt,
		UpdatedAt:     updatedAt,
	}
	if m.DraftWidgetsJSON != nil && m.DraftLayoutJSON != nil {
		scene.DraftWidgetsJson = *m.DraftWidgetsJSON
		scene.DraftLayoutJson = *m.DraftLayoutJSON
		scene.DraftBehaviorsJson = "{}"
		if m.DraftBehaviorsJSON != nil {
			scene.DraftBehaviorsJson = *m.DraftBehaviorsJSON
		}
		scene.HasDraft = true
	}
	if m.EditorStateJSON != nil {
		scene.EditorStateJson = *m.EditorStateJSON
	}
	return scene
}

func (s *sceneService) publishChange(scene *models.Scene, op string) {
	if s.publisher == nil {
		return
	}
	s.publisher.Publish(workers.PublishOptions{
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
		"kind":            scene.Kind,
		"name":            scene.Name,
		"description":     scene.Description,
		"widgets_json":    scene.WidgetsJSON,
		"layout_json":     scene.LayoutJSON,
		"behaviors_json":  scene.BehaviorsJSON,
		"inputs_json":     scene.InputsJSON,
		"created_by_type": scene.CreatedByType,
		"created_by_ref":  scene.CreatedByRef,
	}
}
