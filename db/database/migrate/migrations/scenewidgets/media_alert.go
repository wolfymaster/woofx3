// Package scenewidgets holds scene-data rewrites shared by the postgres and
// sqlite migrations.
package scenewidgets

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"gorm.io/gorm"
)

// alertWidgetCanonicalID is the bundled alert widget that replaced media_alert.
const alertWidgetCanonicalID = "woofx3:widget:alert"

// mediaAlertModuleKeys are the module keys media_alert was placed under: the
// bundled woofx3 module, and the `builtin` key it had before that.
var mediaAlertModuleKeys = map[string]bool{"woofx3": true, "builtin": true}

// ReplaceMediaAlertPlacements rewrites every media_alert placement in a
// scene's widgets JSON into an alert widget named "default".
//
// Every media_alert played every alert, and an alert with no target plays on
// every alert widget named "default", so the scene keeps showing the alerts
// it showed before. The old settings are dropped: they configured rendering
// that each alert now carries in its own layout. Returns the input unchanged,
// and false, when there is nothing to replace.
func ReplaceMediaAlertPlacements(widgetsJSON string) (string, bool, error) {
	var placements []map[string]any
	if err := json.Unmarshal([]byte(widgetsJSON), &placements); err != nil {
		return "", false, fmt.Errorf("parse widgets_json: %w", err)
	}
	changed := false
	for _, placement := range placements {
		if !isMediaAlert(placement) {
			continue
		}
		placement["widgetCanonicalId"] = alertWidgetCanonicalID
		delete(placement, "widgetDefinitionRef")
		placement["name"] = "Alert"
		placement["settings"] = map[string]any{"name": "default"}
		changed = true
	}
	if !changed {
		return widgetsJSON, false, nil
	}
	out, err := json.Marshal(placements)
	if err != nil {
		return "", false, fmt.Errorf("encode widgets_json: %w", err)
	}
	return string(out), true, nil
}

// ReplaceMediaAlertPlacementsInScenes applies ReplaceMediaAlertPlacements to
// every scene. The dialects differ only in the casts their SQL needs.
//
// A scene whose widgets JSON does not parse is logged and left alone: the
// scene manager already renders it as empty, and one damaged row must not
// stop every other scene from migrating.
func ReplaceMediaAlertPlacementsInScenes(tx *gorm.DB, selectScenes, updateScene string) error {
	var scenes []struct {
		ID          string `gorm:"column:id"`
		WidgetsJSON string `gorm:"column:widgets_json"`
	}
	if err := tx.Raw(selectScenes).Scan(&scenes).Error; err != nil {
		return fmt.Errorf("list scenes: %w", err)
	}
	for _, scene := range scenes {
		next, changed, err := ReplaceMediaAlertPlacements(scene.WidgetsJSON)
		if err != nil {
			log.Printf("scene %s: %v; leaving it as it is", scene.ID, err)
			continue
		}
		if !changed {
			continue
		}
		if err := tx.Exec(updateScene, next, scene.ID).Error; err != nil {
			return fmt.Errorf("update scene %s: %w", scene.ID, err)
		}
		log.Printf("scene %s: media_alert placements replaced with alert widgets", scene.ID)
	}
	return nil
}

func isMediaAlert(placement map[string]any) bool {
	id, _ := placement["widgetCanonicalId"].(string)
	if id == "" {
		id, _ = placement["widgetDefinitionRef"].(string)
	}
	const marker = ":widget:"
	at := strings.LastIndex(id, marker)
	if at <= 0 || id[at+len(marker):] != "media_alert" {
		return false
	}
	moduleKey, _, _ := strings.Cut(id[:at], ":")
	return mediaAlertModuleKeys[moduleKey]
}
