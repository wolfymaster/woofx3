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

func (r *ResourceRepository) Create(resource *models.Resource) error {
	return r.db.Create(resource).Error
}

func (r *ResourceRepository) Save(resource *models.Resource) error {
	return r.db.Save(resource).Error
}

func (r *ResourceRepository) GetByID(id uuid.UUID) (*models.Resource, error) {
	var resource models.Resource
	err := r.db.
		Where("id = ?", id).
		First(&resource).Error
	if err != nil {
		return nil, err
	}
	return &resource, nil
}

// Usage sums the size of every file row; folders hold no bytes.
func (r *ResourceRepository) Usage() (bytes int64, files int64, err error) {
	var totals struct {
		Bytes int64
		Files int64
	}
	err = r.db.Model(&models.Resource{}).
		Select("COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS files").
		Where("is_folder = ?", false).
		Scan(&totals).Error
	if err != nil {
		return 0, 0, err
	}
	return totals.Bytes, totals.Files, nil
}

// ListFilter selects the direct children of one folder. A nil ParentID
// with ParentSet true means "the root"; ParentSet false means "do not
// filter on parent at all".
//
// An empty Kind lists every kind except module archives, which only a
// listing asking for them by kind returns.
type ListFilter struct {
	ParentID  *uuid.UUID
	ParentSet bool
	Kind      string
	Search    string
	Offset    int
	Limit     int
}

// List returns one page of direct children plus the unpaginated total.
// Folders sort ahead of files so the UI never has to re-sort a page.
func (r *ResourceRepository) List(filter ListFilter) ([]*models.Resource, int64, error) {
	query := r.db.Model(&models.Resource{})

	if filter.ParentSet {
		if filter.ParentID == nil {
			query = query.Where("parent_id IS NULL")
		} else {
			query = query.Where("parent_id = ?", *filter.ParentID)
		}
	}
	if filter.Kind != "" {
		query = query.Where("kind = ?", filter.Kind)
	} else {
		query = query.Where("kind <> ?", models.ResourceKindCustomModule)
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
func (r *ResourceRepository) ListChildren(parentID uuid.UUID) ([]*models.Resource, error) {
	var resources []*models.Resource
	err := r.db.
		Where("parent_id = ?", parentID).
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
func (r *ResourceRepository) NameExists(parentID *uuid.UUID, name string, excludeID *uuid.UUID) (bool, error) {
	query := r.db.Model(&models.Resource{}).
		Where("LOWER(name) = ?", strings.ToLower(name))
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

// ResourceInstalledError refuses deleting a resource that an installed
// module was installed from (`modules.upload_resource_id`).
type ResourceInstalledError struct {
	ResourceName string
	ModuleName   string
}

func (e *ResourceInstalledError) Error() string {
	return fmt.Sprintf("%q is the archive module %q was installed from; uninstall the module before deleting it",
		e.ResourceName, e.ModuleName)
}

// DeleteSubtree removes a resource and, when it is a folder, everything
// beneath it — returning every repository key in the subtree (uploads
// and thumbnails alike) so the caller can delete those bytes from object
// storage. db-proxy never talks to the object store itself.
//
// Nothing is deleted when an installed module was installed from any
// resource in the subtree: that returns a *ResourceInstalledError. The check
// shares the delete's transaction so a module recorded meanwhile cannot be
// left naming a deleted resource.
//
// The walk is explicit rather than relying on ON DELETE CASCADE because
// the keys have to be collected before the rows disappear, and because
// sqlite only honors foreign keys when the pragma is enabled.
func (r *ResourceRepository) DeleteSubtree(id uuid.UUID) ([]string, error) {
	var keys []string
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var root models.Resource
		if err := tx.Where("id = ?", id).First(&root).Error; err != nil {
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
			if err := tx.Where("parent_id IN ?", frontier).
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
		idStrings := make([]string, 0, len(collected))
		byID := make(map[string]*models.Resource, len(collected))
		for _, resource := range collected {
			ids = append(ids, resource.ID)
			idStrings = append(idStrings, resource.ID.String())
			byID[resource.ID.String()] = resource
			if resource.RepositoryKey != "" {
				keys = append(keys, resource.RepositoryKey)
			}
			if resource.ThumbnailRepositoryKey != "" {
				keys = append(keys, resource.ThumbnailRepositoryKey)
			}
		}

		var installed []models.Module
		if err := tx.Select("name", "upload_resource_id").
			Where("upload_resource_id IN ?", idStrings).
			Limit(1).
			Find(&installed).Error; err != nil {
			return err
		}
		if len(installed) > 0 {
			resource := byID[*installed[0].UploadResourceID]
			if resource == nil {
				return fmt.Errorf("module %q names upload resource %s outside the subtree it was found in",
					installed[0].Name, *installed[0].UploadResourceID)
			}
			return &ResourceInstalledError{ResourceName: resource.Name, ModuleName: installed[0].Name}
		}

		return tx.Where("id IN ?", ids).
			Delete(&models.Resource{}).Error
	})
	if err != nil {
		return nil, err
	}
	return keys, nil
}
