package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

const (
	resourceDefaultPageSize = 50
	resourceMaxPageSize     = 200
	// Bounds how far a move-into-descendant check will walk before it
	// gives up. Also the effective depth limit of the folder tree.
	resourceMaxTreeDepth = 64
)

// resourceService implements `client.ResourceService` — user-uploaded
// assets and the folders that organize them (see `resource.proto`).
//
// This service owns exactly one invariant that the schema cannot
// express: a folder may never be moved inside its own subtree. Postgres
// and sqlite both accept such a write happily and it produces a
// detached cycle, so the check lives here and runs before every move.
type resourceService struct {
	repo *repo.ResourceRepository
}

func NewResourceService(r *repo.ResourceRepository) client.ResourceService {
	return &resourceService{repo: r}
}

func (s *resourceService) CreateResource(ctx context.Context, req *client.CreateResourceRequest) (*client.ResourceResponse, error) {
	applicationID, err := s.resolveApplication(ctx, req.ApplicationId)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, twirp.RequiredArgumentError("name")
	}
	if req.RepositoryKey == "" {
		return nil, twirp.RequiredArgumentError("repository_key")
	}
	kind := req.Kind
	if kind == "" {
		kind = models.ResourceKindOther
	}
	if kind == models.ResourceKindFolder {
		return nil, twirp.InvalidArgumentError("kind", "use CreateFolder to create a folder")
	}
	if !models.ValidResourceKind(kind) {
		return nil, twirp.InvalidArgumentError("kind", "must be image, video, audio, or other")
	}
	status := req.Status
	if status == "" {
		status = models.ResourceStatusPending
	}
	if !models.ValidResourceStatus(status) {
		return nil, twirp.InvalidArgumentError("status", "must be pending, ready, or failed")
	}
	if req.Size < 0 {
		return nil, twirp.InvalidArgumentError("size", "must not be negative")
	}

	parentID, err := s.resolveParent(applicationID, req.ParentId)
	if err != nil {
		return nil, err
	}
	if err := s.requireUniqueName(applicationID, parentID, name, nil); err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	row := &models.Resource{
		ID:            uuid.New(),
		ApplicationID: applicationID,
		ParentID:      parentID,
		IsFolder:      false,
		Name:          name,
		Kind:          kind,
		ContentType:   req.ContentType,
		RepositoryKey: req.RepositoryKey,
		Size:          req.Size,
		Status:        status,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	if err := s.repo.Create(row); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to create resource: %w", err))
	}
	return okResourceResponse(row), nil
}

func (s *resourceService) CreateFolder(ctx context.Context, req *client.CreateFolderRequest) (*client.ResourceResponse, error) {
	applicationID, err := s.resolveApplication(ctx, req.ApplicationId)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, twirp.RequiredArgumentError("name")
	}
	parentID, err := s.resolveParent(applicationID, req.ParentId)
	if err != nil {
		return nil, err
	}
	if err := s.requireUniqueName(applicationID, parentID, name, nil); err != nil {
		return nil, err
	}
	if parentID != nil {
		depth, depthErr := s.depthOf(applicationID, *parentID)
		if depthErr != nil {
			return nil, depthErr
		}
		if depth+1 >= resourceMaxTreeDepth {
			return nil, twirp.InvalidArgumentError("parent_id", "folder nesting limit reached")
		}
	}

	now := time.Now().UTC()
	row := &models.Resource{
		ID:            uuid.New(),
		ApplicationID: applicationID,
		ParentID:      parentID,
		IsFolder:      true,
		Name:          name,
		Kind:          models.ResourceKindFolder,
		Status:        models.ResourceStatusReady,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	if err := s.repo.Create(row); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to create folder: %w", err))
	}
	return okResourceResponse(row), nil
}

func (s *resourceService) GetResource(ctx context.Context, req *client.GetResourceRequest) (*client.ResourceResponse, error) {
	applicationID, err := s.resolveApplication(ctx, req.ApplicationId)
	if err != nil {
		return nil, err
	}
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}
	row, err := s.repo.GetByID(applicationID, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.NotFoundError("resource not found")
		}
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to get resource: %w", err))
	}
	return okResourceResponse(row), nil
}

func (s *resourceService) ListResources(ctx context.Context, req *client.ListResourcesRequest) (*client.ListResourcesResponse, error) {
	applicationID, err := s.resolveApplication(ctx, req.ApplicationId)
	if err != nil {
		return nil, err
	}
	if req.Kind != "" && !models.ValidResourceKind(req.Kind) {
		return nil, twirp.InvalidArgumentError("kind", "unknown resource kind")
	}

	// An absent parent_id lists the root, not "everything" — a flat
	// dump of every resource in the application would ignore the folder
	// hierarchy the caller just asked to browse.
	var parentID *uuid.UUID
	if req.ParentId != nil && *req.ParentId != "" {
		parsed, parseErr := uuid.Parse(*req.ParentId)
		if parseErr != nil {
			return nil, twirp.InvalidArgumentError("parent_id", "invalid UUID format")
		}
		parentID = &parsed
	}

	page := int(req.Page)
	if page < 1 {
		page = 1
	}
	pageSize := int(req.PageSize)
	if pageSize < 1 {
		pageSize = resourceDefaultPageSize
	}
	if pageSize > resourceMaxPageSize {
		pageSize = resourceMaxPageSize
	}

	rows, total, err := s.repo.List(repo.ListFilter{
		ApplicationID: applicationID,
		ParentID:      parentID,
		ParentSet:     true,
		Kind:          req.Kind,
		Search:        req.Search,
		Offset:        (page - 1) * pageSize,
		Limit:         pageSize,
	})
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to list resources: %w", err))
	}

	resources := make([]*client.Resource, len(rows))
	for i, row := range rows {
		resources[i] = toProtoResource(row)
	}
	return &client.ListResourcesResponse{
		Status:    &client.ResponseStatus{Code: client.ResponseStatus_OK},
		Resources: resources,
		Total:     int32(total),
		Page:      int32(page),
		PageSize:  int32(pageSize),
	}, nil
}

func (s *resourceService) UpdateResource(ctx context.Context, req *client.UpdateResourceRequest) (*client.ResourceResponse, error) {
	applicationID, err := s.resolveApplication(ctx, req.ApplicationId)
	if err != nil {
		return nil, err
	}
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}
	row, err := s.repo.GetByID(applicationID, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.NotFoundError("resource not found")
		}
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to get resource: %w", err))
	}

	// Compute the post-update (parent, name) pair first so the sibling
	// uniqueness check sees the same values the write will persist,
	// whether the caller renamed, moved, or did both at once.
	nextParent := row.ParentID
	if req.ParentId != nil {
		nextParent, err = s.resolveParent(applicationID, req.ParentId)
		if err != nil {
			return nil, err
		}
		if err := s.requireNotDescendant(applicationID, row, nextParent); err != nil {
			return nil, err
		}
	}
	nextName := row.Name
	if req.Name != nil {
		nextName = strings.TrimSpace(*req.Name)
		if nextName == "" {
			return nil, twirp.InvalidArgumentError("name", "must not be empty")
		}
	}
	if req.Name != nil || req.ParentId != nil {
		if err := s.requireUniqueName(applicationID, nextParent, nextName, &row.ID); err != nil {
			return nil, err
		}
	}

	row.ParentID = nextParent
	row.Name = nextName
	if req.Status != nil {
		if !models.ValidResourceStatus(*req.Status) {
			return nil, twirp.InvalidArgumentError("status", "must be pending, ready, or failed")
		}
		row.Status = *req.Status
	}
	if req.ContentType != nil {
		row.ContentType = *req.ContentType
	}
	if req.Size != nil {
		if *req.Size < 0 {
			return nil, twirp.InvalidArgumentError("size", "must not be negative")
		}
		row.Size = *req.Size
	}
	if req.ThumbnailRepositoryKey != nil {
		if row.IsFolder && *req.ThumbnailRepositoryKey != "" {
			return nil, twirp.InvalidArgumentError("thumbnail_repository_key", "folders cannot carry a thumbnail")
		}
		row.ThumbnailRepositoryKey = *req.ThumbnailRepositoryKey
	}
	row.UpdatedAt = time.Now().UTC()

	if err := s.repo.Save(row); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to update resource: %w", err))
	}
	return okResourceResponse(row), nil
}

func (s *resourceService) DeleteResource(ctx context.Context, req *client.DeleteResourceRequest) (*client.DeleteResourceResponse, error) {
	applicationID, err := s.resolveApplication(ctx, req.ApplicationId)
	if err != nil {
		return nil, err
	}
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}
	keys, err := s.repo.DeleteSubtree(applicationID, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.NotFoundError("resource not found")
		}
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to delete resource: %w", err))
	}
	return &client.DeleteResourceResponse{
		Status:         &client.ResponseStatus{Code: client.ResponseStatus_OK},
		RepositoryKeys: keys,
	}, nil
}

func (s *resourceService) resolveApplication(ctx context.Context, requested string) (uuid.UUID, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), requested)
	if err != nil {
		return uuid.Nil, err
	}
	applicationID, err := uuid.Parse(appIDStr)
	if err != nil {
		return uuid.Nil, twirp.InvalidArgumentError("application_id", "invalid UUID format")
	}
	return applicationID, nil
}

// resolveParent turns the wire's optional parent_id into a validated
// pointer. Absent or empty means the root. A present id must name an
// existing folder in the same application — pointing a resource at a
// non-folder would produce a tree the UI cannot render.
func (s *resourceService) resolveParent(applicationID uuid.UUID, raw *string) (*uuid.UUID, error) {
	if raw == nil || *raw == "" {
		return nil, nil
	}
	parsed, err := uuid.Parse(*raw)
	if err != nil {
		return nil, twirp.InvalidArgumentError("parent_id", "invalid UUID format")
	}
	parent, err := s.repo.GetByID(applicationID, parsed)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.InvalidArgumentError("parent_id", "parent folder not found")
		}
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to resolve parent: %w", err))
	}
	if !parent.IsFolder {
		return nil, twirp.InvalidArgumentError("parent_id", "parent must be a folder")
	}
	return &parent.ID, nil
}

func (s *resourceService) requireUniqueName(applicationID uuid.UUID, parentID *uuid.UUID, name string, excludeID *uuid.UUID) error {
	exists, err := s.repo.NameExists(applicationID, parentID, name, excludeID)
	if err != nil {
		return twirp.InternalErrorWith(fmt.Errorf("failed to check name uniqueness: %w", err))
	}
	if exists {
		return twirp.NewError(twirp.AlreadyExists, "a resource with that name already exists in this folder")
	}
	return nil
}

// requireNotDescendant rejects moving a folder into itself or into one
// of its own descendants. Walking up from the proposed parent is the
// cheap direction: the chain to the root is at most resourceMaxTreeDepth
// long, whereas the subtree below could be arbitrarily wide.
func (s *resourceService) requireNotDescendant(applicationID uuid.UUID, moving *models.Resource, nextParent *uuid.UUID) error {
	if nextParent == nil || !moving.IsFolder {
		return nil
	}
	if *nextParent == moving.ID {
		return twirp.InvalidArgumentError("parent_id", "a folder cannot be moved into itself")
	}
	cursor := nextParent
	for depth := 0; depth < resourceMaxTreeDepth; depth++ {
		parent, err := s.repo.GetByID(applicationID, *cursor)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return twirp.InvalidArgumentError("parent_id", "parent folder not found")
			}
			return twirp.InternalErrorWith(fmt.Errorf("failed to walk parent chain: %w", err))
		}
		if parent.ParentID == nil {
			return nil
		}
		if *parent.ParentID == moving.ID {
			return twirp.InvalidArgumentError("parent_id", "a folder cannot be moved into its own subtree")
		}
		cursor = parent.ParentID
	}
	return twirp.InvalidArgumentError("parent_id", "folder nesting limit reached")
}

// depthOf counts how many ancestors a folder has. Used to keep
// CreateFolder from building a tree deeper than the delete walk and the
// descendant check are bounded to handle.
func (s *resourceService) depthOf(applicationID, id uuid.UUID) (int, error) {
	cursor := &id
	for depth := 0; depth < resourceMaxTreeDepth; depth++ {
		node, err := s.repo.GetByID(applicationID, *cursor)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return 0, twirp.InvalidArgumentError("parent_id", "parent folder not found")
			}
			return 0, twirp.InternalErrorWith(fmt.Errorf("failed to measure folder depth: %w", err))
		}
		if node.ParentID == nil {
			return depth, nil
		}
		cursor = node.ParentID
	}
	return resourceMaxTreeDepth, nil
}

func okResourceResponse(row *models.Resource) *client.ResourceResponse {
	return &client.ResourceResponse{
		Status:   &client.ResponseStatus{Code: client.ResponseStatus_OK},
		Resource: toProtoResource(row),
	}
}

func toProtoResource(row *models.Resource) *client.Resource {
	proto := &client.Resource{
		Id:                     row.ID.String(),
		ApplicationId:          row.ApplicationID.String(),
		IsFolder:               row.IsFolder,
		Name:                   row.Name,
		Kind:                   row.Kind,
		ContentType:            row.ContentType,
		RepositoryKey:          row.RepositoryKey,
		ThumbnailRepositoryKey: row.ThumbnailRepositoryKey,
		Size:                   row.Size,
		Status:                 row.Status,
		CreatedAt:              timestamppb.New(row.CreatedAt),
		UpdatedAt:              timestamppb.New(row.UpdatedAt),
	}
	if row.ParentID != nil {
		parentID := row.ParentID.String()
		proto.ParentId = &parentID
	}
	return proto
}
