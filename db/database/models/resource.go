package models

import (
	"time"

	"github.com/google/uuid"
)

// Resource is one user-uploaded asset, or one folder that organizes
// them (see `resource.proto` for the full design note). Folders and
// uploads share this table: a folder is a row with IsFolder true, an
// empty RepositoryKey, and Kind ResourceKindFolder.
//
// ParentID is self-referencing and nullable; nil means the row sits at
// the root of its application's tree.
//
// ThumbnailRepositoryKey is a column, never a separate row. That is
// what makes "thumbnails are never listed as their own resource" a
// structural property rather than a filter every read path has to
// remember to apply.
type Resource struct {
	ID            uuid.UUID  `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	ApplicationID uuid.UUID  `gorm:"column:application_id;type:uuid;not null;index:idx_resources_app_parent,priority:1;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	ParentID      *uuid.UUID `gorm:"column:parent_id;type:uuid;index:idx_resources_app_parent,priority:2"`
	IsFolder      bool       `gorm:"column:is_folder;not null;default:false"`
	Name          string     `gorm:"column:name;type:text;not null"`
	Kind          string     `gorm:"column:kind;type:text;not null;default:'other'"`
	ContentType   string     `gorm:"column:content_type;type:text;not null;default:''"`
	RepositoryKey string     `gorm:"column:repository_key;type:text;not null;default:''"`
	// Empty means no thumbnail: either not generated yet, or not
	// applicable (audio). The two are distinguished by Status, not by
	// this column.
	ThumbnailRepositoryKey string    `gorm:"column:thumbnail_repository_key;type:text;not null;default:''"`
	Size                   int64     `gorm:"column:size;not null;default:0"`
	Status                 string    `gorm:"column:status;type:text;not null;default:'pending'"`
	CreatedAt              time.Time `gorm:"column:created_at"`
	UpdatedAt              time.Time `gorm:"column:updated_at"`
}

const (
	ResourceKindImage  = "image"
	ResourceKindVideo  = "video"
	ResourceKindAudio  = "audio"
	ResourceKindOther  = "other"
	ResourceKindFolder = "folder"

	// A row exists and an upload URL was issued, but the bytes are not
	// confirmed present yet. Not servable.
	ResourceStatusPending = "pending"
	// Bytes confirmed at RepositoryKey.
	ResourceStatusReady = "ready"
	// The upload, or a processing step, failed terminally.
	ResourceStatusFailed = "failed"
)

func (Resource) TableName() string {
	return "resources"
}

// ValidResourceKind reports whether kind is one of the values the
// engine assigns. Callers upstream derive kind from a MIME type; this
// is the fail-fast check that a bad value never reaches the table.
func ValidResourceKind(kind string) bool {
	switch kind {
	case ResourceKindImage, ResourceKindVideo, ResourceKindAudio, ResourceKindOther, ResourceKindFolder:
		return true
	default:
		return false
	}
}

// ValidResourceStatus reports whether status is a known lifecycle value.
func ValidResourceStatus(status string) bool {
	switch status {
	case ResourceStatusPending, ResourceStatusReady, ResourceStatusFailed:
		return true
	default:
		return false
	}
}
