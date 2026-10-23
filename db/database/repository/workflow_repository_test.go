package repository

import (
	"testing"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/dbtest"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

func TestWorkflowUpsertKeepsIdentityAndEnabledOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		r := NewWorkflowRepository(db, database.RandomIDs{})
		workflow := func(name string, enabled bool) *models.WorkflowDefinition {
			return &models.WorkflowDefinition{
				ID: uuid.New(), Name: name, Steps: "[]", Trigger: "{}", Taxonomy: "[]",
				CreatedByType: "MODULE", CreatedByRef: "wheel", ManifestID: "spin-flow", Enabled: enabled,
			}
		}

		first := workflow("Spin", false)
		if err := r.Upsert(first); err != nil {
			t.Fatalf("insert: %v", err)
		}
		second := workflow("Spin again", true)
		if err := r.Upsert(second); err != nil {
			t.Fatalf("update: %v", err)
		}

		if second.ID != first.ID || second.Enabled {
			t.Fatalf("upserted = id %s enabled %v, want id %s and the stored enabled=false", second.ID, second.Enabled, first.ID)
		}
		stored, err := r.GetByID(first.ID)
		if err != nil || stored.Name != "Spin again" {
			t.Fatalf("stored = %+v, %v; want the new name", stored, err)
		}
	})
}
