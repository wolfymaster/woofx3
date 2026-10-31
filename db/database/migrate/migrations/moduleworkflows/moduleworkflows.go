// Package moduleworkflows gives every module workflow already stored a place in
// the order of the workflows on its event, as installing one now does. Shared
// by the postgres and sqlite migrations.
package moduleworkflows

import (
	"encoding/json"
	"fmt"
	"log"

	"gorm.io/gorm"
)

// Dialect is what differs between the two schemas for this rewrite.
type Dialect struct {
	// Workflows is the dialect-qualified table name.
	Workflows string
	// JSON is the placeholder a JSON column takes its value through: postgres
	// stores JSONB and needs the text cast, sqlite stores TEXT.
	JSON string
}

type storedWorkflow struct {
	ID            string
	Trigger       *string
	CreatedByType string
	ManifestID    string `gorm:"column:manifest_id"`
}

type orderedTrigger struct {
	Type  string `json:"type"`
	Event string `json:"event"`
	Order *int   `json:"order"`
}

// Apply appends each unordered module workflow after the workflows already
// ordered on its event, oldest first. Workflows that are ordered, user workflows
// and command workflows keep what they have, so running it again changes nothing.
// A trigger that can't be read is left alone: the engine refuses that workflow
// either way.
func Apply(tx *gorm.DB, dialect Dialect) (int, error) {
	var rows []storedWorkflow
	if err := tx.Raw(fmt.Sprintf(
		`SELECT id, trigger, created_by_type, manifest_id FROM %s ORDER BY created_at, id`,
		dialect.Workflows,
	)).Scan(&rows).Error; err != nil {
		return 0, err
	}

	next := map[string]int{}
	for _, row := range rows {
		trigger, ok := readTrigger(row)
		if ok && trigger.Order != nil && *trigger.Order >= next[trigger.Event] {
			next[trigger.Event] = *trigger.Order + 1
		}
	}

	ordered := 0
	for _, row := range rows {
		trigger, ok := readTrigger(row)
		if !ok || trigger.Order != nil || row.CreatedByType != "MODULE" || row.ManifestID == "" {
			continue
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal([]byte(*row.Trigger), &fields); err != nil {
			return ordered, fmt.Errorf("read trigger of workflow %s: %w", row.ID, err)
		}
		order, err := json.Marshal(next[trigger.Event])
		if err != nil {
			return ordered, fmt.Errorf("write order of workflow %s: %w", row.ID, err)
		}
		fields["order"] = order
		written, err := json.Marshal(fields)
		if err != nil {
			return ordered, fmt.Errorf("write trigger of workflow %s: %w", row.ID, err)
		}
		if err := tx.Exec(
			fmt.Sprintf(`UPDATE %s SET trigger = %s, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
				dialect.Workflows, dialect.JSON),
			string(written), row.ID,
		).Error; err != nil {
			return ordered, fmt.Errorf("order workflow %s: %w", row.ID, err)
		}
		next[trigger.Event]++
		ordered++
	}
	return ordered, nil
}

// readTrigger reports the row's trigger when it is an event trigger, the only
// kind the engine orders.
func readTrigger(row storedWorkflow) (orderedTrigger, bool) {
	if row.Trigger == nil {
		return orderedTrigger{}, false
	}
	var trigger orderedTrigger
	if err := json.Unmarshal([]byte(*row.Trigger), &trigger); err != nil {
		log.Printf("Leaving workflow %s as it is: %v", row.ID, err)
		return orderedTrigger{}, false
	}
	return trigger, trigger.Type == "event" && trigger.Event != ""
}
