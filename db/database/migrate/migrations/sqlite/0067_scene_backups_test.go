package sqlite

import "testing"

func TestSceneBackupsAcceptOnlyKnownValues(t *testing.T) {
	db := openMigratedTo(t, "0067_scene_backups")
	const scene = "00000000-0000-0000-0000-00000000b4c1"
	mustExec(t, db, `INSERT INTO scene_backups (id, scene_id, version, source_column, reason, content)
		VALUES ('b1', ?, 'draft', 'widgets', 'unreadable_column', 'not json {')`, scene)

	for name, insert := range map[string]string{
		"an unknown version": `INSERT INTO scene_backups (id, scene_id, version, source_column, reason, content)
			VALUES ('b2', ?, 'staging', 'widgets', 'unreadable_column', '')`,
		"an unknown column": `INSERT INTO scene_backups (id, scene_id, version, source_column, reason, content)
			VALUES ('b3', ?, 'draft', 'inputs', 'unreadable_column', '')`,
		"an unknown reason": `INSERT INTO scene_backups (id, scene_id, version, source_column, reason, content)
			VALUES ('b4', ?, 'draft', 'widgets', 'tidy', '')`,
	} {
		if err := db.Exec(insert, scene).Error; err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
}
