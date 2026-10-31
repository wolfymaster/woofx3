package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddUserPageSubmissions creates the table of form submissions from public
// user pages. See the postgres migration of the same ID.
func AddUserPageSubmissions() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0076_user_page_submissions",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating user_page_submissions...")
			if err := execStatements(tx, []string{
				`CREATE TABLE IF NOT EXISTS user_page_submissions (
					submission_id TEXT     NOT NULL PRIMARY KEY,
					page_id       TEXT     NOT NULL,
					form_id       TEXT     NOT NULL,
					payload       TEXT     NOT NULL,
					submitted_at  DATETIME NOT NULL,
					recorded_at   DATETIME NOT NULL
				)`,
			}); err != nil {
				return err
			}
			log.Println("user_page_submissions migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return execStatements(tx, []string{`DROP TABLE IF EXISTS user_page_submissions`})
		},
	}
}
