package repository

import (
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// StreamGaugeRepository wraps gorm.DB with the per-minute gauge samples.
type StreamGaugeRepository struct {
	db *gorm.DB
}

func NewStreamGaugeRepository(db *gorm.DB) *StreamGaugeRepository {
	return &StreamGaugeRepository{db: db}
}

// Record inserts a sample unless its segment already has one for the same
// minute, and returns the stored row either way. The bool reports whether
// this call wrote it.
//
// The conflict is resolved by the unique constraint rather than a lookup
// first, so two writers racing for one minute still produce a single row.
func (r *StreamGaugeRepository) Record(sample *models.StreamGaugeSample) (*models.StreamGaugeSample, bool, error) {
	result := r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "segment_id"}, {Name: "sampled_at"}},
		DoNothing: true,
	}).Create(sample)
	if result.Error != nil {
		return nil, false, result.Error
	}
	if result.RowsAffected == 1 {
		return sample, true, nil
	}

	var stored models.StreamGaugeSample
	if err := r.db.Where("segment_id = ? AND sampled_at = ?", sample.SegmentID, sample.SampledAt).
		First(&stored).Error; err != nil {
		return nil, false, err
	}
	return &stored, false, nil
}

// ListForSession returns the samples taken in the segments the session owns
// now, oldest first. Resolving through stream_session_segments rather than the
// stamped session_id is what keeps the answer right after a split.
func (r *StreamGaugeRepository) ListForSession(streamSessionID uuid.UUID) ([]*models.StreamGaugeSample, error) {
	var samples []*models.StreamGaugeSample
	err := r.db.
		Where("segment_id IN (?)", r.db.Model(&models.StreamSessionSegment{}).
			Select("id").
			Where("stream_session_id = ?", streamSessionID)).
		Order("sampled_at ASC").
		Find(&samples).Error
	return samples, err
}
