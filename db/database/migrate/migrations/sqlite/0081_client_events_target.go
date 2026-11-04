package sqlite

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddClientEventsTarget adds where the engine ships a client's events in place
// of its callback URL. The CHECK keeps the URL and token set or empty together.
func AddClientEventsTarget() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0081_client_events_target",
		Migrate: func(tx *gorm.DB) error {
			if err := execSQL(tx, `ALTER TABLE clients
				ADD COLUMN IF NOT EXISTS events_url VARCHAR(255) NOT NULL DEFAULT ''`); err != nil {
				return err
			}
			return execSQL(tx, `ALTER TABLE clients
				ADD COLUMN IF NOT EXISTS events_token VARCHAR(255) NOT NULL DEFAULT ''
				CONSTRAINT clients_events_target_paired CHECK ((events_url = '') = (events_token = ''))`)
		},
		Rollback: func(tx *gorm.DB) error {
			if err := execSQL(tx, `ALTER TABLE clients DROP COLUMN IF EXISTS events_token`); err != nil {
				return err
			}
			return execSQL(tx, `ALTER TABLE clients DROP COLUMN IF EXISTS events_url`)
		},
	}
}
