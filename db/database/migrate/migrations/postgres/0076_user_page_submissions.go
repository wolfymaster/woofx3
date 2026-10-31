package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddUserPageSubmissions creates the table of form submissions from public
// user pages. submission_id is the sender's idempotency key, so the primary
// key is what turns a redelivery into a no-op.
func AddUserPageSubmissions() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0076_user_page_submissions",
		Migrate: func(db *gorm.DB) error {
			log.Println("Creating user_page_submissions...")
			err := db.Exec(`CREATE TABLE IF NOT EXISTS public.user_page_submissions (
				submission_id VARCHAR(255) NOT NULL PRIMARY KEY,
				page_id       VARCHAR(255) NOT NULL,
				form_id       VARCHAR(255) NOT NULL,
				payload       JSONB        NOT NULL,
				submitted_at  TIMESTAMPTZ  NOT NULL,
				recorded_at   TIMESTAMPTZ  NOT NULL
			)`).Error
			if err != nil {
				return err
			}
			log.Println("user_page_submissions migration complete")
			return nil
		},
		Rollback: func(db *gorm.DB) error {
			return db.Exec(`DROP TABLE IF EXISTS public.user_page_submissions`).Error
		},
	}
}
