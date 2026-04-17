package repository

import (
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

type ResourceReferenceRepository struct {
	db *gorm.DB
}

func NewResourceReferenceRepository(db *gorm.DB) *ResourceReferenceRepository {
	return &ResourceReferenceRepository{db: db}
}

// ReplaceEdgesForSource removes every existing edge originating from the given
// source and inserts the provided edges in a single transaction. This is the
// primary write path callers use after a workflow or command is created or
// updated.
func (r *ResourceReferenceRepository) ReplaceEdgesForSource(
	sourceType string,
	sourceID uuid.UUID,
	edges []models.ResourceReference,
) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("source_type = ? AND source_id = ?", sourceType, sourceID).
			Delete(&models.ResourceReference{}).Error; err != nil {
			return err
		}
		if len(edges) == 0 {
			return nil
		}
		return tx.Create(&edges).Error
	})
}

// DeleteEdgesBySource removes every edge originating from the given source.
// Used when the source itself is deleted.
func (r *ResourceReferenceRepository) DeleteEdgesBySource(
	sourceType string,
	sourceID uuid.UUID,
) error {
	return r.db.Where("source_type = ? AND source_id = ?", sourceType, sourceID).
		Delete(&models.ResourceReference{}).Error
}

// FindExternalReferencesToModule returns every edge whose target resource is
// owned by the given module (created_by_ref == moduleName) and whose source is
// NOT owned by the same module. This is the delete-time "is in use" check.
func (r *ResourceReferenceRepository) FindExternalReferencesToModule(
	moduleName string,
	resourceTypes []string,
	resourceNames []string,
) ([]*models.ResourceReference, error) {
	if len(resourceTypes) == 0 || len(resourceNames) == 0 {
		return nil, nil
	}
	var refs []*models.ResourceReference
	err := r.db.
		Where("target_type IN ? AND target_name IN ?", resourceTypes, resourceNames).
		Where("NOT (source_created_by_type = 'MODULE' AND source_created_by_ref = ?)", moduleName).
		Find(&refs).Error
	return refs, err
}
