package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations/moduleworkflows"
	"gorm.io/gorm"
)

// OrderModuleWorkflows puts each module workflow in line with the others on its
// event. See the moduleworkflows package.
func OrderModuleWorkflows() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0077_order_module_workflows",
		Migrate: func(tx *gorm.DB) error {
			ordered, err := moduleworkflows.Apply(tx, moduleworkflows.Dialect{
				Workflows: "workflow_definitions",
				JSON:      "?",
			})
			if err != nil {
				return err
			}
			log.Printf("Ordered %d module workflow(s)", ordered)
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			// Not reversible: the order may have been changed since, and a
			// workflow with an order runs correctly under older code.
			return nil
		},
	}
}
