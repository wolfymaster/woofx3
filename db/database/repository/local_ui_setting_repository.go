package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// LocalUISettingRepository wraps gorm.DB with `local_ui_settings` and the
// engine-wide revision counter its writes draw from.
type LocalUISettingRepository struct {
	db *gorm.DB
}

// errLocalUISettingConflict rolls back a write refused by its expected
// revision; Write turns it into a result, never returns it.
var errLocalUISettingConflict = errors.New("local ui setting revision conflict")

func NewLocalUISettingRepository(db *gorm.DB) *LocalUISettingRepository {
	return &LocalUISettingRepository{db: db}
}

// LocalUISettingWrite is one set or delete. A nil Value is a delete, which
// stores a tombstone.
type LocalUISettingWrite struct {
	Namespace string
	Key       string
	Value     *string
	// ExpectedRevision, when set, refuses the write unless it matches the
	// stored row's revision. 0 matches a key with no live value: never
	// written, or a tombstone.
	ExpectedRevision *int64
	At               time.Time
}

// LocalUISettingWriteResult is the row after the write, or, when Conflict is
// true, the row that refused it (nil when the key was never written).
type LocalUISettingWriteResult struct {
	Setting  *models.LocalUISetting
	Conflict bool
}

// List returns a namespace's live rows, ordered by key.
func (r *LocalUISettingRepository) List(ctx context.Context, namespace string) ([]*models.LocalUISetting, error) {
	var settings []*models.LocalUISetting
	err := r.db.WithContext(ctx).
		Where("namespace = ? AND deleted = ?", namespace, false).
		Order("key ASC").
		Find(&settings).Error
	return settings, err
}

// Get returns the stored row, a tombstone included, or gorm.ErrRecordNotFound.
func (r *LocalUISettingRepository) Get(ctx context.Context, namespace, key string) (*models.LocalUISetting, error) {
	var setting models.LocalUISetting
	if err := r.db.WithContext(ctx).Where("namespace = ? AND key = ?", namespace, key).First(&setting).Error; err != nil {
		return nil, err
	}
	return &setting, nil
}

// ChangesSince returns up to limit rows, tombstones included, whose revision
// is greater than after, in revision order. The bool reports whether more
// rows follow the last one returned.
func (r *LocalUISettingRepository) ChangesSince(ctx context.Context, after int64, limit int) ([]*models.LocalUISetting, bool, error) {
	var settings []*models.LocalUISetting
	err := r.db.WithContext(ctx).
		Where("revision > ?", after).
		Order("revision ASC").
		Limit(limit + 1).
		Find(&settings).Error
	if err != nil {
		return nil, false, err
	}
	if len(settings) > limit {
		return settings[:limit], true, nil
	}
	return settings, false, nil
}

// Write applies a set or delete under the next revision.
//
// The counter is bumped before the stored row is read. That takes the
// counter's write lock first, so every other write waits until this one
// commits: the expected-revision check reads a row no one else can change
// before the write lands, and revisions become visible in the order they were
// handed out. A refused write rolls back, so it consumes no revision.
//
// Cancelling ctx rolls the transaction back, which releases the counter lock.
func (r *LocalUISettingRepository) Write(ctx context.Context, write LocalUISettingWrite) (*LocalUISettingWriteResult, error) {
	var result *LocalUISettingWriteResult

	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		revision, err := nextLocalUISettingRevision(tx)
		if err != nil {
			return err
		}

		var current *models.LocalUISetting
		var stored models.LocalUISetting
		err = tx.Where("namespace = ? AND key = ?", write.Namespace, write.Key).First(&stored).Error
		switch {
		case err == nil:
			current = &stored
		case errors.Is(err, gorm.ErrRecordNotFound):
		default:
			return fmt.Errorf("read local ui setting: %w", err)
		}

		if write.ExpectedRevision != nil && !revisionMatches(current, *write.ExpectedRevision) {
			result = &LocalUISettingWriteResult{Setting: current, Conflict: true}
			return errLocalUISettingConflict
		}

		row := &models.LocalUISetting{
			Namespace: write.Namespace,
			Key:       write.Key,
			Value:     write.Value,
			Revision:  revision,
			UpdatedAt: write.At,
			Deleted:   write.Value == nil,
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "namespace"}, {Name: "key"}},
			DoUpdates: clause.AssignmentColumns([]string{"value", "revision", "updated_at", "deleted"}),
		}).Create(row).Error; err != nil {
			return fmt.Errorf("store local ui setting: %w", err)
		}
		result = &LocalUISettingWriteResult{Setting: row}
		return nil
	})
	if errors.Is(err, errLocalUISettingConflict) {
		return result, nil
	}
	if err != nil {
		return nil, err
	}
	return result, nil
}

// nextLocalUISettingRevision bumps the single counter row and returns its new
// value. The row is seeded by the migration, so a missing row is a broken
// schema, not a first write.
func nextLocalUISettingRevision(tx *gorm.DB) (int64, error) {
	var revisions []int64
	if err := tx.Raw(
		`UPDATE local_ui_settings_revision SET revision = revision + 1 WHERE id = 1 RETURNING revision`,
	).Scan(&revisions).Error; err != nil {
		return 0, fmt.Errorf("bump local ui setting revision: %w", err)
	}
	if len(revisions) != 1 {
		return 0, fmt.Errorf("bump local ui setting revision: counter row missing")
	}
	return revisions[0], nil
}

// revisionMatches reports whether expected names the stored state: the row's
// own revision, or 0 for a key with no live value.
func revisionMatches(current *models.LocalUISetting, expected int64) bool {
	if current != nil && current.Revision == expected {
		return true
	}
	return expected == 0 && (current == nil || current.Deleted)
}
