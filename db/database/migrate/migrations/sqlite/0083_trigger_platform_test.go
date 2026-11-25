package sqlite

import "testing"

func TestTriggerPlatformLeavesExistingTriggersUnpinned(t *testing.T) {
	db := openMigratedTo(t, "0082_module_marketplace_license_key")
	mustExec(t, db, `INSERT INTO triggers (id, name, description, event, created_by_ref, manifest_id)
		VALUES ('t1', 'Follow', 'Follow', 'channel.follow', 'pups', 'follow')`)

	if err := migrateAll(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := AddTriggerPlatform().Migrate(db); err != nil {
		t.Fatalf("running the migration again: %v", err)
	}

	if n := count(t, db, `SELECT COUNT(*) FROM triggers WHERE id = 't1' AND platform = ''`); n != 1 {
		t.Fatalf("an existing trigger was pinned to a platform")
	}
	mustExec(t, db, `UPDATE triggers SET platform = 'twitch' WHERE id = 't1'`)
	if n := count(t, db, `SELECT COUNT(*) FROM triggers WHERE platform = 'twitch'`); n != 1 {
		t.Fatalf("the platform column did not store what was written")
	}
}
