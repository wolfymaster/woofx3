package sqlite

import "testing"

func TestModuleMarketplaceProvenanceLeavesExistingModulesUnattributed(t *testing.T) {
	db := openMigratedTo(t, "0061_session_compaction")
	mustExec(t, db, `INSERT INTO modules (id, module_key, module_id, name, version)
		VALUES ('m1', 'cozy:1.0.0:abcdef0', 'cozy', 'Cozy', '1.0.0')`)

	if err := migrateAll(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	if n := count(t, db, `SELECT COUNT(*) FROM modules
		WHERE id = 'm1' AND marketplace_listing_id IS NULL AND marketplace_edition IS NULL`); n != 1 {
		t.Fatalf("an existing module was given a marketplace provenance")
	}
	mustExec(t, db, `UPDATE modules SET marketplace_listing_id = 'cozy-v2', marketplace_edition = 2 WHERE id = 'm1'`)
	if n := count(t, db, `SELECT COUNT(*) FROM modules
		WHERE marketplace_listing_id = 'cozy-v2' AND marketplace_edition = 2`); n != 1 {
		t.Fatalf("the provenance columns did not store what was written")
	}
}
