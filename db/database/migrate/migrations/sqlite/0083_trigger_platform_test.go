package sqlite

import "testing"

func TestTriggerPlatformPinsOnlyTheTwitchModulesExistingTriggers(t *testing.T) {
	db := openMigratedTo(t, "0082_module_marketplace_license_key")
	mustExec(t, db, `INSERT INTO triggers (id, name, description, event, created_by_ref, manifest_id)
		VALUES ('t1', 'Follow', 'Follow', 'channel.follow', 'pups', 'follow'),
		       ('t2', 'Follow', 'Follow', 'channel.follow', 'woofx3_twitch', 'channel_follow')`)

	if err := migrateAll(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := AddTriggerPlatform().Migrate(db); err != nil {
		t.Fatalf("running the migration again: %v", err)
	}

	if n := count(t, db, `SELECT COUNT(*) FROM triggers WHERE id = 't1' AND platform = ''`); n != 1 {
		t.Fatalf("another module's trigger was pinned to a platform")
	}
	if n := count(t, db, `SELECT COUNT(*) FROM triggers WHERE id = 't2' AND platform = 'twitch'`); n != 1 {
		t.Fatalf("the Twitch module's existing trigger was left unpinned, so it would fire on Kick events")
	}
	mustExec(t, db, `UPDATE triggers SET platform = 'kick' WHERE id = 't1'`)
	if n := count(t, db, `SELECT COUNT(*) FROM triggers WHERE platform = 'kick'`); n != 1 {
		t.Fatalf("the platform column did not store what was written")
	}
}
