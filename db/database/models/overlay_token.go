package models

import (
	"time"

	"github.com/google/uuid"
)

// OverlayToken binds a public overlay URL to a scene. Plaintext at
// rest (local-first single-operator db; the UI must reproduce working
// URLs from a list call — hash-at-rest is the documented seam if the
// threat model changes). Revocation is a tombstone, never a delete:
// `Status` flips to "revoked" and `RevokedAt` is stamped so rotation
// history and the operator `Label` survive.
//
// No FK to scenes — tombstones outlive their scene the same way
// widgets outlive their module rows; resolution validates at read time.
type OverlayToken struct {
	ID            uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	Token         string    `gorm:"column:token;type:text;not null;uniqueIndex:idx_overlay_tokens_token"`
	SceneID       uuid.UUID `gorm:"column:scene_id;type:uuid;not null;index:idx_overlay_tokens_scene_id"`
	ApplicationID uuid.UUID `gorm:"column:application_id;type:uuid;not null;index:idx_overlay_tokens_application_id"`
	Label         string    `gorm:"column:label;type:text;not null;default:''"`
	// "active" | "revoked".
	Status     string `gorm:"column:status;type:text;not null;default:'active'"`
	CreatedAt  time.Time
	RevokedAt  *time.Time `gorm:"column:revoked_at"`
	LastUsedAt *time.Time `gorm:"column:last_used_at"`
}

const (
	OverlayTokenStatusActive  = "active"
	OverlayTokenStatusRevoked = "revoked"
)

func (OverlayToken) TableName() string {
	return "overlay_tokens"
}
