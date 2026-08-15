package sqlite

import (
	"fmt"
	"regexp"
	"strings"

	"gorm.io/gorm"
)

var (
	addColumnIfNotExistsRE = regexp.MustCompile(
		`(?is)^\s*ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(\w+)\s+`,
	)
	dropColumnIfExistsRE = regexp.MustCompile(
		`(?is)^\s*ALTER\s+TABLE\s+(\w+)\s+DROP\s+COLUMN\s+IF\s+EXISTS\s+(\w+)\s*;?\s*$`,
	)
)

// tableExists reports whether a user table is present in sqlite_master.
func tableExists(tx *gorm.DB, name string) (bool, error) {
	var count int64
	err := tx.Raw(
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`,
		name,
	).Scan(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// columnExists reports whether a column is present via PRAGMA table_info.
func columnExists(tx *gorm.DB, table, column string) (bool, error) {
	rows, err := tx.Raw(fmt.Sprintf("PRAGMA table_info(%s)", table)).Rows()
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var colType string
		var notNull int
		var dfltValue any
		var pk int
		if scanErr := rows.Scan(&cid, &name, &colType, &notNull, &dfltValue, &pk); scanErr != nil {
			return false, scanErr
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}

// renameTableIfNeeded renames from→to when from exists and to does not.
func renameTableIfNeeded(tx *gorm.DB, from, to string) error {
	fromOK, err := tableExists(tx, from)
	if err != nil {
		return err
	}
	toOK, err := tableExists(tx, to)
	if err != nil {
		return err
	}
	if fromOK && !toOK {
		return tx.Exec(fmt.Sprintf("ALTER TABLE %s RENAME TO %s", from, to)).Error
	}
	return nil
}

// splitPart1SQL returns a SQLite expression equivalent to Postgres
// split_part(expr, ':', 1).
func splitPart1SQL(expr string) string {
	return fmt.Sprintf(
		"CASE WHEN instr(%s, ':') > 0 THEN substr(%s, 1, instr(%s, ':') - 1) ELSE %s END",
		expr, expr, expr, expr,
	)
}

// execSQL runs a statement, emulating ADD/DROP COLUMN IF [NOT] EXISTS via
// PRAGMA table_info because this project's embedded SQLite (modernc 3.40)
// does not accept ADD COLUMN IF NOT EXISTS.
func execSQL(tx *gorm.DB, stmt string) error {
	if m := addColumnIfNotExistsRE.FindStringSubmatch(stmt); m != nil {
		table, col := m[1], m[2]
		exists, err := columnExists(tx, table, col)
		if err != nil {
			return err
		}
		if exists {
			return nil
		}
		rewritten := addColumnIfNotExistsRE.ReplaceAllString(
			stmt,
			fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s ", table, col),
		)
		return tx.Exec(rewritten).Error
	}

	if m := dropColumnIfExistsRE.FindStringSubmatch(strings.TrimSpace(stmt)); m != nil {
		table, col := m[1], m[2]
		exists, err := columnExists(tx, table, col)
		if err != nil {
			return err
		}
		if !exists {
			return nil
		}
		return tx.Exec(fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", table, col)).Error
	}

	return tx.Exec(stmt).Error
}

// execStatements runs each statement via execSQL.
func execStatements(tx *gorm.DB, statements []string) error {
	for _, stmt := range statements {
		if err := execSQL(tx, stmt); err != nil {
			return err
		}
	}
	return nil
}
