package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations/alertworkflows"
	"gorm.io/gorm"
)

// SplitAlertWorkflows stores each alert trigger as a workflow of its own. See
// the alertworkflows package for what is split, what is left as it is, and how
// the split keeps the order triggers ran in.
func SplitAlertWorkflows() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0065_split_alert_workflows",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Splitting alert workflows into one workflow per trigger...")
			summary, err := alertworkflows.Apply(tx, alertworkflows.Dialect{
				Workflows:  "public.workflow_definitions",
				References: "public.resource_references",
				JSON:       "?::jsonb",
			})
			if err != nil {
				return err
			}
			log.Printf("Split %d alert workflow(s), creating %d; left %d as they were",
				summary.Split, summary.Created, summary.Untouched)
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			// Not reversible: the split workflows may have been edited since.
			return nil
		},
	}
}
