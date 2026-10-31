package repository

import (
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// UserPageSubmissionRepository wraps gorm.DB with the user page form
// submissions.
type UserPageSubmissionRepository struct {
	db *gorm.DB
}

func NewUserPageSubmissionRepository(db *gorm.DB) *UserPageSubmissionRepository {
	return &UserPageSubmissionRepository{db: db}
}

// Record inserts the submission unless its id is already stored, and reports
// whether this call wrote it. On a new row recordEvent runs in the same
// transaction, so the row and what recordEvent writes commit or roll back
// together; on a repeat it does not run.
//
// The conflict is resolved by the primary key rather than a lookup first, so
// two deliveries racing each other still produce a single row and one call to
// recordEvent that commits.
func (r *UserPageSubmissionRepository) Record(
	submission *models.UserPageSubmission,
	recordEvent func(tx *gorm.DB) error,
) (bool, error) {
	created := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "submission_id"}},
			DoNothing: true,
		}).Create(submission)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		created = true
		return recordEvent(tx)
	})
	if err != nil {
		return false, err
	}
	return created, nil
}
