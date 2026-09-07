package repository

import (
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// ResourceRepository wraps gorm.DB with user-resource helpers. Thin and
// composable, matching OverlayTokenRepository / SceneRepository —
// business rules (validation, id assignment, cycle checks) live in the
// service layer.
type ResourceRepository struct {
	db *gorm.DB
}

func NewResourceRepository(db *gorm.DB) *ResourceRepository {
	return &ResourceRepository{db: db}
}

func (r *ResourceRepository) DB() *gorm.DB {
	return r.db
}

func (r *ResourceRepository) Create(resource *models.Resource) error {
	return r.db.Create(resource).Error
}

func (r *ResourceRepository) Save(resource *models.Resource) error {
	return r.db.Save(resource).Error
}

// GetByID is always application-scoped: a resource id alone is never
// sufficient to read a row, so a leaked id from one application cannot
// address another's content.
func (r *ResourceRepository) GetByID(applicationID, id uuid.UUID) (*models.Resource, error) {
	var resource models.Resource
	err := r.db.
		Where("id = ? AND application_id = ?", id, applicationID).
		First(&resource).Error
	if err != nil {
		return nil, err
	}
	return &resource, nil
}

// ListFilter selects the direct children of one folder. A nil ParentID
// with ParentSet true means "the root"; ParentSet false means "do not
// filter on parent at all".
type ListFilter struct {
	ApplicationID uuid.UUID
	ParentID      *uuid.UUID
	ParentSet     bool
	Kind          string
	Search        string
	Offset        int
	Limit         int
}

// List returns one page of direct children plus the unpaginated total.
// Folders sort ahead of files so the UI never has to re-sort a page.
func (r *ResourceRepository) List(filter ListFilter) ([]*models.Resource, int64, error) {
	query := r.db.Model(&models.Resource{}).
		Where("application_id = ?", filter.ApplicationID)

	if filter.ParentSet {
		if filter.ParentID == nil {
			query = query.Where("parent_id IS NULL")
		} else {
			query = query.Where("parent_id = ?", *filter.ParentID)
		}
	}
	if filter.Kind != "" {
		query = query.Where("kind = ?", filter.Kind)
	}
	if filter.Search != "" {
		// LOWER(...) LIKE keeps the match case-insensitive on both
		// postgres and sqlite without relying on either's collation
		// defaults or on postgres-only ILIKE.
		pattern := "%" + strings.ToLower(filter.Search) + "%"
		query = query.Where("LOWER(name) LIKE ?", pattern)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var resources []*models.Resource
	page := query.Order("is_folder DESC, name ASC")
	if filter.Limit > 0 {
		page = page.Limit(filter.Limit).Offset(filter.Offset)
	}
	if err := page.Find(&resources).Error; err != nil {
		return nil, 0, err
	}
	return resources, total, nil
}

// ListChildren returns every direct child of parent, unpaginated.
// Used by the recursive delete walk.
func (r *ResourceRepository) ListChildren(applicationID, parentID uuid.UUID) ([]*models.Resource, error) {
	var resources []*models.Resource
	err := r.db.
		Where("application_id = ? AND parent_id = ?", applicationID, parentID).
		Find(&resources).Error
	if err != nil {
		return nil, err
	}
	return resources, nil
}

// NameExists reports whether a sibling under the same parent already
// carries this name. Uniqueness within a folder is enforced here rather
// than by a DB constraint because "same parent" includes the NULL-parent
// root, and NULLs do not compare equal in a unique index.
func (r *ResourceRepository) NameExists(applicationID uuid.UUID, parentID *uuid.UUID, name string, excludeID *uuid.UUID) (bool, error) {
	query := r.db.Model(&models.Resource{}).
		Where("application_id = ? AND LOWER(name) = ?", applicationID, strings.ToLower(name))
	if parentID == nil {
		query = query.Where("parent_id IS NULL")
	} else {
		query = query.Where("parent_id = ?", *parentID)
	}
	if excludeID != nil {
		query = query.Where("id <> ?", *excludeID)
	}

	var count int64
	if err := query.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// DeleteSubtree removes a resource and, when it is a folder, everything
// beneath it — returning every repository key in the subtree (uploads
// and thumbnails alike) so the caller can delete those bytes from object
// storage. db-proxy never talks to the object store itself.
//
// The walk is explicit rather than relying on ON DELETE CASCADE because
// the keys have to be collected before the rows disappear, and because
// sqlite only honors foreign keys when the pragma is enabled.
func (r *ResourceRepository) DeleteSubtree(applicationID, id uuid.UUID) ([]string, error) {
	var keys []string
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var root models.Resource
		if err := tx.Where("id = ? AND application_id = ?", id, applicationID).First(&root).Error; err != nil {
			return err
		}

		// Breadth-first so a deep tree does not recurse the Go stack.
		// `depth` bounds a cycle that a corrupted parent_id could
		// otherwise turn into an infinite walk (Tiger Style: the loop
		// must have a bound the data cannot remove).
		const maxDepth = 64
		collected := []*models.Resource{&root}
		frontier := []uuid.UUID{root.ID}
		if !root.IsFolder {
			frontier = nil
		}
		for depth := 0; depth < maxDepth && len(frontier) > 0; depth++ {
			var children []*models.Resource
			if err := tx.Where("application_id = ? AND parent_id IN ?", applicationID, frontier).
				Find(&children).Error; err != nil {
				return err
			}
			frontier = nil
			for _, child := range children {
				collected = append(collected, child)
				if child.IsFolder {
					frontier = append(frontier, child.ID)
				}
			}
		}
		if len(frontier) > 0 {
			return fmt.Errorf("resource tree under %s exceeds max depth %d", id, maxDepth)
		}

		ids := make([]uuid.UUID, 0, len(collected))
		for _, resource := range collected {
			ids = append(ids, resource.ID)
			if resource.RepositoryKey != "" {
				keys = append(keys, resource.RepositoryKey)
			}
			if resource.ThumbnailRepositoryKey != "" {
				keys = append(keys, resource.ThumbnailRepositoryKey)
			}
		}
		return tx.Where("application_id = ? AND id IN ?", applicationID, ids).
			Delete(&models.Resource{}).Error
	})
	if err != nil {
		return nil, err
	}
	return keys, nil
}
