package scenewidgets

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strconv"

	"gorm.io/gorm"
)

// FractionPlacementOpacity rewrites one placement's `opacity` from a percent
// to the fraction 0–1 a placement carries, as CSS does.
//
// The scene editor once stored opacity as a percent, so a saved placement
// holds 100 where a fraction holds 1. A fraction is never above 1, which is
// what tells the two apart: a number above 1 is a percent and is divided by
// 100, clamped to 1; anything else, including an absent opacity, is left as it
// is. Reports whether the placement changed.
func FractionPlacementOpacity(placement map[string]any) bool {
	value, ok := placement["opacity"]
	if !ok {
		return false
	}
	percent, ok := numberOf(value)
	if !ok || percent <= 1 {
		return false
	}
	placement["opacity"] = min(percent/100, 1)
	return true
}

// FractionPlacementsOpacity applies FractionPlacementOpacity to every
// placement of a widgets array: a scene's `widgets_json` or its draft.
// Returns the input unchanged, and false, when nothing needed rewriting.
func FractionPlacementsOpacity(widgetsJSON string) (string, bool, error) {
	var placements []any
	if err := decode(widgetsJSON, &placements); err != nil {
		return "", false, fmt.Errorf("parse widgets: %w", err)
	}
	if !fractionAll(placements) {
		return widgetsJSON, false, nil
	}
	return encode(placements)
}

// FractionStepsOpacity applies FractionPlacementOpacity to the layout widgets
// of every step in a list: a workflow's `steps`, or a command's `actions`,
// which take the same shape.
//
// An alert step carries the widgets it shows as `parameters.layout.widgets`.
// Any step with that shape is rewritten, whichever action it names, since a
// layout's widgets are placements wherever they appear.
func FractionStepsOpacity(stepsJSON string) (string, bool, error) {
	var steps []any
	if err := decode(stepsJSON, &steps); err != nil {
		return "", false, fmt.Errorf("parse steps: %w", err)
	}
	changed := false
	for _, step := range steps {
		if fractionLayoutOf(step) {
			changed = true
		}
	}
	if !changed {
		return stepsJSON, false, nil
	}
	return encode(steps)
}

// FractionAlertPayloadOpacity applies FractionPlacementOpacity to the layout
// widgets of a dispatched alert's envelope, `{ id, parameters, event }`, which
// a replay plays again as it was stored.
func FractionAlertPayloadOpacity(payloadJSON string) (string, bool, error) {
	var payload any
	if err := decode(payloadJSON, &payload); err != nil {
		return "", false, fmt.Errorf("parse alert payload: %w", err)
	}
	if !fractionLayoutOf(payload) {
		return payloadJSON, false, nil
	}
	return encode(payload)
}

// OpacityColumn is one JSON column that holds placements, and how to rewrite
// it. Select must name its columns `id` and `json`; Update takes the new JSON
// then the id. The dialects differ only in the casts their SQL needs.
type OpacityColumn struct {
	What    string
	Select  string
	Update  string
	Rewrite func(string) (string, bool, error)
}

// FractionOpacityInColumns applies each column's Rewrite to every row its
// Select returns, writing back only the rows that changed.
//
// A row whose JSON does not parse is logged and left alone: one damaged row
// must not stop every other row from migrating.
func FractionOpacityInColumns(tx *gorm.DB, columns []OpacityColumn) error {
	for _, column := range columns {
		var rows []struct {
			ID   string         `gorm:"column:id"`
			JSON sql.NullString `gorm:"column:json"`
		}
		if err := tx.Raw(column.Select).Scan(&rows).Error; err != nil {
			return fmt.Errorf("list %s rows: %w", column.What, err)
		}
		for _, row := range rows {
			if !row.JSON.Valid {
				continue
			}
			next, changed, err := column.Rewrite(row.JSON.String)
			if err != nil {
				log.Printf("%s %s: %v; leaving it as it is", column.What, row.ID, err)
				continue
			}
			if !changed {
				continue
			}
			if err := tx.Exec(column.Update, next, row.ID).Error; err != nil {
				return fmt.Errorf("update %s %s: %w", column.What, row.ID, err)
			}
			log.Printf("%s %s: widget opacity rewritten as a fraction", column.What, row.ID)
		}
	}
	return nil
}

// fractionLayoutOf rewrites the placements under `parameters.layout.widgets`
// of a step or alert envelope, reporting whether any changed.
func fractionLayoutOf(holder any) bool {
	object, ok := holder.(map[string]any)
	if !ok {
		return false
	}
	parameters, ok := object["parameters"].(map[string]any)
	if !ok {
		return false
	}
	layout, ok := parameters["layout"].(map[string]any)
	if !ok {
		return false
	}
	widgets, ok := layout["widgets"].([]any)
	if !ok {
		return false
	}
	return fractionAll(widgets)
}

func fractionAll(placements []any) bool {
	changed := false
	for _, entry := range placements {
		placement, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		if FractionPlacementOpacity(placement) {
			changed = true
		}
	}
	return changed
}

func numberOf(value any) (float64, bool) {
	switch v := value.(type) {
	case json.Number:
		f, err := strconv.ParseFloat(v.String(), 64)
		return f, err == nil
	case float64:
		return v, true
	default:
		return 0, false
	}
}

// decode keeps numbers as written, so values the rewrite does not touch (a
// large integer id, say) are not rounded through float64 on the way back out.
func decode(text string, into any) error {
	decoder := json.NewDecoder(bytes.NewReader([]byte(text)))
	decoder.UseNumber()
	return decoder.Decode(into)
}

func encode(value any) (string, bool, error) {
	out, err := json.Marshal(value)
	if err != nil {
		return "", false, fmt.Errorf("encode: %w", err)
	}
	return string(out), true, nil
}
