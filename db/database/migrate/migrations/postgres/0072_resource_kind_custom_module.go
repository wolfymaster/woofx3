package postgres

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AllowCustomModuleResourceKind admits `kind = 'custom_module'` on resources: a module
// archive uploaded through the ordinary upload grant so the engine can
// install it from storage. It is a resource like any other upload, counted
// in storage usage, but kept out of the media library and never served
// publicly.
func AllowCustomModuleResourceKind() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0072_resource_kind_custom_module",
		Migrate: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.resources
				DROP CONSTRAINT IF EXISTS resources_kind_check,
				ADD CONSTRAINT resources_kind_check
					CHECK (kind IN ('image', 'video', 'audio', 'other', 'folder', 'custom_module'))`).Error
		},
		// Fails while any module resource exists rather than deleting
		// uploads to make the narrower check hold.
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.resources
				DROP CONSTRAINT IF EXISTS resources_kind_check,
				ADD CONSTRAINT resources_kind_check
					CHECK (kind IN ('image', 'video', 'audio', 'other', 'folder'))`).Error
		},
	}
}
