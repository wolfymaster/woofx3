package postgres

import "gorm.io/gorm"

// columnExists reports whether a column is present on a schema-qualified table.
func columnExists(tx *gorm.DB, schema, table, column string) (bool, error) {
	var count int64
	err := tx.Raw(
		`SELECT COUNT(*) FROM information_schema.columns
			WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
		schema, table, column,
	).Scan(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}
