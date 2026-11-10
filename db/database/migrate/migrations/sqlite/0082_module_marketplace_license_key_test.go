package sqlite

import "testing"

func TestModuleMarketplaceLicenseKeyLeavesExistingModulesWithoutAKey(t *testing.T) {
	db := openMigratedTo(t, "0081_client_events_target")
	mustExec(t, db, `INSERT INTO modules (id, module_key, module_id, name, version, marketplace_listing_id, marketplace_edition)
		VALUES ('m1', 'cozy:1.0.0:abcdef0', 'cozy', 'Cozy', '1.0.0', 'cozy', 1)`)

	if err := migrateAll(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := AddModuleMarketplaceLicenseKey().Migrate(db); err != nil {
		t.Fatalf("running the migration again: %v", err)
	}

	if n := count(t, db, `SELECT COUNT(*) FROM modules
		WHERE id = 'm1' AND marketplace_listing_id = 'cozy' AND marketplace_license_key_sealed IS NULL`); n != 1 {
		t.Fatalf("an existing module was given a license key, or lost its provenance")
	}
	mustExec(t, db, `UPDATE modules SET marketplace_license_key_sealed = 'v1:sealed' WHERE id = 'm1'`)
	if n := count(t, db, `SELECT COUNT(*) FROM modules WHERE marketplace_license_key_sealed = 'v1:sealed'`); n != 1 {
		t.Fatalf("the license key column did not store what was written")
	}
}
