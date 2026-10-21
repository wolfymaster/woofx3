package models

import "time"

// LocalUISetting is one value of the dashboard's own data, kept by the
// engine when it runs without an account (docs/services/local-ui-settings.md).
//
// A row is never removed: a delete turns it into a tombstone (Deleted, Value
// nil) with a new Revision, so a reader of changes since a revision sees it.
type LocalUISetting struct {
	Namespace string `gorm:"column:namespace;primaryKey"`
	Key       string `gorm:"column:key;primaryKey"`
	// Value is JSON text, nil exactly when Deleted.
	Value *string `gorm:"column:value"`
	// Revision is the engine-wide counter's value at this row's last write,
	// unique across every namespace.
	Revision  int64     `gorm:"column:revision;not null;uniqueIndex:uq_local_ui_settings_revision"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null"`
	Deleted   bool      `gorm:"column:deleted;not null"`
}

func (LocalUISetting) TableName() string {
	return "local_ui_settings"
}
