package models

import "time"

// SegmentDefinition is a set of viewers defined as a condition over each
// viewer's facts. A viewer enters when its facts come to satisfy the
// condition and leaves when they stop, which the db proxy announces as
// viewer.segment.entered and viewer.segment.left.
//
// WindowKind and TimeRelative are derived from Condition and the facts it
// reads, and kept as columns so applying an event reads them without decoding
// the tree.
type SegmentDefinition struct {
	// ID is the canonical segment id, e.g. `user:segment:<slug>`.
	ID          string `gorm:"column:id;type:varchar(255);primaryKey"`
	Name        string `gorm:"column:name;type:text;not null"`
	Description string `gorm:"column:description;type:text;not null;default:''"`
	// Condition is the all/any/not tree of {fact, op, value} atoms as JSON.
	Condition string `gorm:"column:condition;type:jsonb;not null"`
	// WindowKind is `session` when the condition reads any session-window
	// fact, and `lifetime` otherwise.
	WindowKind string `gorm:"column:window_kind;type:varchar(20);not null"`
	// TimeRelative is true when the condition has a within or older_than
	// atom, so whether a viewer satisfies it can change with time alone.
	TimeRelative  bool      `gorm:"column:time_relative;not null;default:false"`
	Revision      int64     `gorm:"column:revision;not null;default:1"`
	CreatedByType string    `gorm:"column:created_by_type;type:text;not null;default:'USER'"`
	CreatedByRef  string    `gorm:"column:created_by_ref;type:text;not null;default:''"`
	CreatedAt     time.Time `gorm:"column:created_at;not null"`
	UpdatedAt     time.Time `gorm:"column:updated_at;not null"`
}

func (SegmentDefinition) TableName() string {
	return "segment_definitions"
}

// SegmentFact records that a segment's condition reads a fact.
type SegmentFact struct {
	SegmentID string `gorm:"column:segment_id;type:varchar(255);primaryKey"`
	FactID    string `gorm:"column:fact_id;type:varchar(255);primaryKey"`
}

func (SegmentFact) TableName() string {
	return "segment_facts"
}

// SegmentMember is a viewer in a segment. WindowKey is "" for a lifetime
// segment and the stream session id for a session segment; a row whose
// WindowKey is not the current session is not a membership.
type SegmentMember struct {
	SegmentID string    `gorm:"column:segment_id;type:varchar(255);primaryKey"`
	Platform  string    `gorm:"column:platform;type:varchar(50);primaryKey"`
	SubjectID string    `gorm:"column:subject_id;type:varchar(100);primaryKey"`
	WindowKey string    `gorm:"column:window_key;type:varchar(100);not null;default:''"`
	EnteredAt time.Time `gorm:"column:entered_at;not null"`
}

func (SegmentMember) TableName() string {
	return "segment_members"
}
