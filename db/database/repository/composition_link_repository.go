package repository

import (
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// CompositionLinkRepository stores which steps play which composition. The
// service validates owners and compositions; this layer keeps an owner's
// links consistent by replacing them in one transaction.
type CompositionLinkRepository struct {
	db *gorm.DB
}

func NewCompositionLinkRepository(db *gorm.DB) *CompositionLinkRepository {
	return &CompositionLinkRepository{db: db}
}

// CompositionLinkTarget is one step of an owner and the composition it plays.
type CompositionLinkTarget struct {
	CompositionID uuid.UUID
	StepID        string
}

// ReplaceForOwner makes `targets` the owner's only links, in one transaction.
// A step whose composition is unchanged keeps its row, and so its
// `created_at`; a step that now plays another composition is updated in
// place; steps no longer listed are removed. Step ids must be unique within
// `targets`. Returns the owner's links afterwards, ordered by step id.
func (r *CompositionLinkRepository) ReplaceForOwner(
	ownerKind, ownerID string,
	targets []CompositionLinkTarget,
	now time.Time,
) ([]*models.CompositionLink, error) {
	var result []*models.CompositionLink
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var existing []*models.CompositionLink
		if err := tx.Where("owner_kind = ? AND owner_id = ?", ownerKind, ownerID).Find(&existing).Error; err != nil {
			return err
		}
		byStep := make(map[string]*models.CompositionLink, len(existing))
		for _, link := range existing {
			byStep[link.StepID] = link
		}
		wanted := make(map[string]bool, len(targets))
		for _, target := range targets {
			wanted[target.StepID] = true
			current, ok := byStep[target.StepID]
			if !ok {
				link := &models.CompositionLink{
					ID:            uuid.New(),
					CompositionID: target.CompositionID,
					OwnerKind:     ownerKind,
					OwnerID:       ownerID,
					StepID:        target.StepID,
					CreatedAt:     now,
					UpdatedAt:     now,
				}
				if err := tx.Create(link).Error; err != nil {
					return err
				}
				continue
			}
			if current.CompositionID == target.CompositionID {
				continue
			}
			if err := tx.Model(&models.CompositionLink{}).Where("id = ?", current.ID).
				Updates(map[string]any{"composition_id": target.CompositionID, "updated_at": now}).Error; err != nil {
				return err
			}
		}
		for step, link := range byStep {
			if wanted[step] {
				continue
			}
			if err := tx.Delete(&models.CompositionLink{}, "id = ?", link.ID).Error; err != nil {
				return err
			}
		}
		return tx.Where("owner_kind = ? AND owner_id = ?", ownerKind, ownerID).
			Order("step_id").Find(&result).Error
	})
	return result, err
}

// ListForComposition returns every link to one composition, ordered by
// owner kind, owner id and step id.
func (r *CompositionLinkRepository) ListForComposition(compositionID uuid.UUID) ([]*models.CompositionLink, error) {
	var links []*models.CompositionLink
	err := r.db.Where("composition_id = ?", compositionID).
		Order("owner_kind").Order("owner_id").Order("step_id").Find(&links).Error
	return links, err
}

// CountForComposition returns how many steps play one composition.
func (r *CompositionLinkRepository) CountForComposition(compositionID uuid.UUID) (int64, error) {
	var n int64
	err := r.db.Model(&models.CompositionLink{}).Where("composition_id = ?", compositionID).Count(&n).Error
	return n, err
}
