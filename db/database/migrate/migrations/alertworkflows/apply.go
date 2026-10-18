package alertworkflows

import (
	"fmt"
	"log"

	"github.com/google/uuid"
	refsvc "github.com/wolfymaster/woofx3/db/app/services/resource_reference"
	"gorm.io/gorm"
)

// Dialect is what differs between the two schemas for this rewrite.
type Dialect struct {
	// Workflows and References are the dialect-qualified table names.
	Workflows  string
	References string
	// JSON is the placeholder a JSON column takes its value through:
	// postgres stores JSONB and needs the text cast, sqlite stores TEXT.
	JSON string
}

// Summary counts what Apply did.
type Summary struct {
	Split     int
	Created   int
	Untouched int
}

type storedWorkflow struct {
	ID            string
	Name          string
	Steps         *string
	Trigger       *string
	Enabled       bool
	CreatedByType string
	CreatedByRef  string
}

// maxNameLength is the width of workflow_definitions.name.
const maxNameLength = 255

// Apply splits every user workflow holding several triggers of one event (see
// Split). Module workflows are left alone: their module owns them and writes
// them back on every upgrade.
//
// The first trigger keeps the workflow's id, so its run history, the alerts it
// raised and the UI's links to it still lead somewhere; the rest are new
// workflows named after it. Each workflow is rewritten in a transaction of its
// own and the rewrite leaves nothing for Split to find again, so a run that
// died part way is finished by running it again.
func Apply(tx *gorm.DB, dialect Dialect) (Summary, error) {
	var rows []storedWorkflow
	if err := tx.Raw(fmt.Sprintf(
		`SELECT id, name, steps, trigger, enabled, created_by_type, created_by_ref FROM %s
			WHERE created_by_type = 'USER' AND manifest_id = '' ORDER BY created_at, id`,
		dialect.Workflows,
	)).Scan(&rows).Error; err != nil {
		return Summary{}, err
	}

	var summary Summary
	for _, row := range rows {
		plan, err := Split(deref(row.Trigger), deref(row.Steps))
		if err != nil {
			// Unreadable JSON is not this migration's to repair, and the
			// engine refuses such a workflow either way.
			log.Printf("Leaving workflow %s as it is: %v", row.ID, err)
			summary.Untouched++
			continue
		}
		if len(plan.Parts) == 0 {
			log.Printf("Leaving workflow %s as it is: %s", row.ID, plan.Reason)
			summary.Untouched++
			continue
		}
		created, err := applyPlan(tx, dialect, row, plan)
		if err != nil {
			return summary, fmt.Errorf("split workflow %s: %w", row.ID, err)
		}
		log.Printf("Split workflow %s into %d trigger workflow(s)", row.ID, len(plan.Parts))
		summary.Split++
		summary.Created += created
	}
	return summary, nil
}

func applyPlan(tx *gorm.DB, dialect Dialect, row storedWorkflow, plan Plan) (int, error) {
	created := 0
	err := tx.Transaction(func(tx *gorm.DB) error {
		first := plan.Parts[0]
		if err := tx.Exec(
			fmt.Sprintf(`UPDATE %s SET steps = %s, trigger = %s, enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
				dialect.Workflows, dialect.JSON, dialect.JSON),
			first.Steps, first.Trigger, row.Enabled && !first.Paused, row.ID,
		).Error; err != nil {
			return err
		}
		if err := replaceEdges(tx, dialect, row, row.ID, row.Name, first); err != nil {
			return err
		}

		for index, part := range plan.Parts[1:] {
			id := uuid.NewString()
			name := partName(row.Name, index+2)
			if err := tx.Exec(
				fmt.Sprintf(`INSERT INTO %[1]s
					(id, name, steps, trigger, enabled, created_by_type, created_by_ref, manifest_id, taxonomy, created_at, updated_at)
					SELECT ?, ?, %[2]s, %[2]s, ?, created_by_type, created_by_ref, manifest_id, taxonomy, created_at, CURRENT_TIMESTAMP
					FROM %[1]s WHERE id = ?`, dialect.Workflows, dialect.JSON),
				id, name, part.Steps, part.Trigger, row.Enabled && !part.Paused, row.ID,
			).Error; err != nil {
				return err
			}
			if err := replaceEdges(tx, dialect, row, id, name, part); err != nil {
				return err
			}
			created++
		}
		return nil
	})
	return created, err
}

// replaceEdges rewrites the resource_references of one workflow from its new
// definition, as the workflow service does on every save, so a module still
// knows which workflows use its actions.
func replaceEdges(tx *gorm.DB, dialect Dialect, row storedWorkflow, id, name string, part Part) error {
	if err := tx.Exec(
		fmt.Sprintf(`DELETE FROM %s WHERE source_type = 'workflow' AND source_id = ?`, dialect.References), id,
	).Error; err != nil {
		return err
	}
	sourceID, err := uuid.Parse(id)
	if err != nil {
		return fmt.Errorf("workflow id %q: %w", id, err)
	}
	edges := refsvc.ExtractWorkflowEdges(refsvc.WorkflowSource{
		ID:                  sourceID,
		Name:                name,
		SourceCreatedByType: row.CreatedByType,
		SourceCreatedByRef:  row.CreatedByRef,
	}, part.Steps, part.Trigger)
	if len(edges) == 0 {
		return nil
	}
	return tx.Table(dialect.References).Create(&edges).Error
}

// partName names the workflow of a split's position-th trigger (from 2) after
// the workflow it came from, within the column's width.
func partName(name string, position int) string {
	suffix := fmt.Sprintf(" (%d)", position)
	runes := []rune(name)
	if room := maxNameLength - len([]rune(suffix)); len(runes) > room {
		runes = runes[:room]
	}
	return string(runes) + suffix
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
