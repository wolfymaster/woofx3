package services

import (
	"context"
	"database/sql"
	"fmt"
)

// storageSchemaVersion is the module_storage layout this build reads and
// writes, recorded in the storage file's PRAGMA user_version. The storage file
// is separate from the system database and has no other migrations, so the
// version lives in the file itself.
const storageSchemaVersion = 1

// storageSchema creates module_storage. The value column holds the exact
// string a module stored: compare-and-set compares it byte for byte, which
// TEXT's default BINARY collation does. The partial indexes serve the two
// bulk clears that do not filter by namespace.
const storageSchema = `
CREATE TABLE module_storage (
  namespace            TEXT    NOT NULL,
  key                  TEXT    NOT NULL,
  value                TEXT    NOT NULL,
  created_at           INTEGER NOT NULL,
  expires_at           INTEGER NOT NULL DEFAULT 0,
  clear_on_session_end INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (namespace, key)
) WITHOUT ROWID;
CREATE INDEX module_storage_session ON module_storage (namespace, key) WHERE clear_on_session_end = 1;
CREATE INDEX module_storage_expiry ON module_storage (expires_at) WHERE expires_at <> 0;
`

// EnsureStorageSchema creates module_storage in a new storage file and refuses
// a file written by a newer build, whose layout this one cannot know.
func EnsureStorageSchema(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin storage schema: %w", err)
	}
	defer tx.Rollback()

	var version int
	if err := tx.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&version); err != nil {
		return fmt.Errorf("read storage schema version: %w", err)
	}
	if version == storageSchemaVersion {
		return nil
	}
	if version != 0 {
		return fmt.Errorf("module storage schema version %d is not %d, the version this build uses", version, storageSchemaVersion)
	}

	if _, err := tx.ExecContext(ctx, storageSchema); err != nil {
		return fmt.Errorf("create module storage schema: %w", err)
	}
	if _, err := tx.ExecContext(ctx, fmt.Sprintf(`PRAGMA user_version = %d`, storageSchemaVersion)); err != nil {
		return fmt.Errorf("record storage schema version: %w", err)
	}
	return tx.Commit()
}
