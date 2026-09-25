package sqlite

import (
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"gorm.io/gorm"
)

// tableRebuild describes a column change SQLite's ALTER TABLE cannot make in
// place: dropping a column that carries a FOREIGN KEY or sits in a table-level
// UNIQUE constraint, or relaxing a NOT NULL. Both need the table recreated.
type tableRebuild struct {
	table      string
	dropColumn string
	// nullable lists columns whose NOT NULL is removed by the rebuild.
	nullable []string
}

var (
	notNullRE = regexp.MustCompile(`(?i)\s+NOT\s+NULL\b`)
	// tableConstraintRE matches the keyword a table-level constraint starts
	// with, as opposed to a column definition, which starts with its name.
	tableConstraintRE = regexp.MustCompile(`(?i)^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)\b`)
	// droppableConstraintRE matches the constraint kinds that are removed along
	// with a column they cover. A CHECK is never dropped silently: losing one
	// would relax a rule nobody asked to relax.
	droppableConstraintRE = regexp.MustCompile(`(?i)^(CONSTRAINT\s+\S+\s+)?(UNIQUE|FOREIGN\s+KEY)\b`)
)

// withForeignKeysDisabled runs fn on one pinned connection with SQLite foreign
// key enforcement off, restoring the previous setting afterwards.
//
// A table rebuild drops the original table, and with enforcement on that DROP
// deletes every child row that references it through ON DELETE CASCADE. The
// pragma is a no-op inside an open transaction, so a caller that already opened
// one (gormigrate's UseTransaction) is refused up front, and the setting is
// read back rather than trusted in case one was opened some other way.
func withForeignKeysDisabled(db *gorm.DB, fn func(conn *gorm.DB) error) error {
	if _, inTransaction := db.Statement.ConnPool.(gorm.TxCommitter); inTransaction {
		return errors.New("this migration disables sqlite foreign_keys, which cannot change inside a transaction; " +
			"run it outside one (it manages its own)")
	}
	return db.Connection(func(conn *gorm.DB) error {
		enabled, err := foreignKeysEnabled(conn)
		if err != nil {
			return err
		}
		if !enabled {
			return fn(conn)
		}

		if err := conn.Exec(`PRAGMA foreign_keys = OFF`).Error; err != nil {
			return err
		}
		stillEnabled, err := foreignKeysEnabled(conn)
		if err != nil {
			return err
		}
		if stillEnabled {
			return errors.New(
				"sqlite foreign_keys could not be disabled, most likely because a transaction is already open; " +
					"this migration manages its own transaction and must run outside one",
			)
		}

		fnErr := fn(conn)
		restoreErr := conn.Exec(`PRAGMA foreign_keys = ON`).Error
		return errors.Join(fnErr, restoreErr)
	})
}

func foreignKeysEnabled(conn *gorm.DB) (bool, error) {
	var enabled int
	if err := conn.Raw(`PRAGMA foreign_keys`).Row().Scan(&enabled); err != nil {
		return false, err
	}
	return enabled == 1, nil
}

// assertForeignKeysHold fails when any row references a parent row that does
// not exist. Run it before committing work done with enforcement disabled.
func assertForeignKeysHold(tx *gorm.DB) error {
	rows, err := tx.Raw(`PRAGMA foreign_key_check`).Rows()
	if err != nil {
		return err
	}
	defer rows.Close()

	if rows.Next() {
		var table string
		var rowID sql.NullInt64
		var parent string
		var fkIndex int
		if err := rows.Scan(&table, &rowID, &parent, &fkIndex); err != nil {
			return err
		}
		return fmt.Errorf("foreign key violation: a row in %s (rowid %d) references a missing row in %s",
			table, rowID.Int64, parent)
	}
	return rows.Err()
}

// rebuildTable recreates r.table without r.dropColumn and with r.nullable
// relaxed, following SQLite's documented procedure: create the new shape,
// copy the rows, drop the original, rename, and recreate its indexes.
//
// The new definition is derived from the table's own CREATE statement in
// sqlite_master, so every other column, default and CHECK comes across
// verbatim. Indexes that mention the dropped column must already be gone;
// the rebuild refuses rather than guessing what they should become.
//
// Must run inside a transaction on a connection with foreign keys disabled
// (see withForeignKeysDisabled). A table without r.dropColumn is left alone,
// so the migration can be re-run.
func rebuildTable(tx *gorm.DB, r tableRebuild) error {
	hasColumn, err := columnExists(tx, r.table, r.dropColumn)
	if err != nil {
		return err
	}
	if !hasColumn {
		return nil
	}

	var createSQL string
	if err := tx.Raw(
		`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`, r.table,
	).Row().Scan(&createSQL); err != nil {
		return fmt.Errorf("read definition of %s: %w", r.table, err)
	}

	var triggerCount int64
	if err := tx.Raw(
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?`, r.table,
	).Scan(&triggerCount).Error; err != nil {
		return err
	}
	if triggerCount > 0 {
		return fmt.Errorf("cannot rebuild %s: it has triggers, which the rebuild does not recreate", r.table)
	}

	indexSQL, err := tableIndexSQL(tx, r.table)
	if err != nil {
		return err
	}
	for _, stmt := range indexSQL {
		if referencesIdentifier(stmt, r.dropColumn) {
			return fmt.Errorf("cannot rebuild %s: index still references %s: %s", r.table, r.dropColumn, stmt)
		}
	}

	items, suffix, err := splitCreateTable(createSQL)
	if err != nil {
		return fmt.Errorf("parse definition of %s: %w", r.table, err)
	}
	kept, err := rewriteTableItems(r, items)
	if err != nil {
		return err
	}

	columns, err := tableColumns(tx, r.table)
	if err != nil {
		return err
	}
	copied := make([]string, 0, len(columns))
	for _, column := range columns {
		if column != r.dropColumn {
			copied = append(copied, quoteIdentifier(column))
		}
	}
	columnList := strings.Join(copied, ", ")

	sequence, hasSequence, err := autoincrementSequence(tx, r.table)
	if err != nil {
		return err
	}

	scratch := r.table + "__rebuild"
	statements := []string{
		fmt.Sprintf("CREATE TABLE %s (\n\t%s\n)%s", quoteIdentifier(scratch), strings.Join(kept, ",\n\t"), suffix),
		fmt.Sprintf("INSERT INTO %s (%s) SELECT %s FROM %s",
			quoteIdentifier(scratch), columnList, columnList, quoteIdentifier(r.table)),
		fmt.Sprintf("DROP TABLE %s", quoteIdentifier(r.table)),
		fmt.Sprintf("ALTER TABLE %s RENAME TO %s", quoteIdentifier(scratch), quoteIdentifier(r.table)),
	}
	statements = append(statements, indexSQL...)
	for _, stmt := range statements {
		if err := tx.Exec(stmt).Error; err != nil {
			return fmt.Errorf("rebuild %s: %w", r.table, err)
		}
	}

	// The copy only advances the counter to the highest surviving id. Keeping
	// the original value stops ids of deleted rows from being handed out again.
	if hasSequence {
		if err := tx.Exec(
			`UPDATE sqlite_sequence SET seq = ? WHERE name = ? AND seq < ?`,
			sequence, r.table, sequence,
		).Error; err != nil {
			return err
		}
	}
	return nil
}

// rewriteTableItems applies r to the column definitions and table constraints
// of a CREATE TABLE body.
func rewriteTableItems(r tableRebuild, items []string) ([]string, error) {
	pendingNullable := make(map[string]bool, len(r.nullable))
	for _, column := range r.nullable {
		pendingNullable[column] = true
	}
	droppedColumn := false

	kept := make([]string, 0, len(items))
	for _, item := range items {
		if tableConstraintRE.MatchString(item) {
			if !referencesIdentifier(item, r.dropColumn) {
				kept = append(kept, item)
				continue
			}
			if !droppableConstraintRE.MatchString(item) {
				return nil, fmt.Errorf("cannot rebuild %s: constraint references %s and is not a UNIQUE or FOREIGN KEY: %s",
					r.table, r.dropColumn, item)
			}
			continue
		}

		name := columnDefinitionName(item)
		if name == r.dropColumn {
			droppedColumn = true
			continue
		}
		if referencesIdentifier(item, r.dropColumn) {
			return nil, fmt.Errorf("cannot rebuild %s: column %s references %s: %s", r.table, name, r.dropColumn, item)
		}
		if pendingNullable[name] {
			if !notNullRE.MatchString(item) {
				return nil, fmt.Errorf("cannot rebuild %s: column %s is not NOT NULL", r.table, name)
			}
			item = notNullRE.ReplaceAllString(item, "")
			delete(pendingNullable, name)
		}
		kept = append(kept, item)
	}

	if !droppedColumn {
		return nil, fmt.Errorf("cannot rebuild %s: no column definition for %s", r.table, r.dropColumn)
	}
	for column := range pendingNullable {
		return nil, fmt.Errorf("cannot rebuild %s: no column definition for %s", r.table, column)
	}
	return kept, nil
}

// splitCreateTable returns the top-level items of a CREATE TABLE column list
// (columns and table constraints, comments removed) and any table options
// after it.
func splitCreateTable(createSQL string) ([]string, string, error) {
	stripped := stripSQLComments(createSQL)
	open := strings.Index(stripped, "(")
	closing := strings.LastIndex(stripped, ")")
	if open < 0 || closing < open {
		return nil, "", fmt.Errorf("no column list in %q", createSQL)
	}

	var items []string
	depth := 0
	var quote rune
	start := open + 1
	body := stripped[:closing]
	for i, ch := range body {
		if i <= open {
			continue
		}
		if quote != 0 {
			if ch == quote {
				quote = 0
			}
			continue
		}
		switch ch {
		case '\'', '"', '`':
			quote = ch
		case '[':
			quote = ']'
		case '(':
			depth++
		case ')':
			depth--
		case ',':
			if depth == 0 {
				items = append(items, strings.TrimSpace(body[start:i]))
				start = i + 1
			}
		}
	}
	items = append(items, strings.TrimSpace(body[start:]))
	return items, stripped[closing+1:], nil
}

// stripSQLComments removes -- and /* */ comments outside quoted text.
func stripSQLComments(s string) string {
	var out strings.Builder
	var quote byte
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if quote != 0 {
			out.WriteByte(ch)
			if ch == quote {
				quote = 0
			}
			continue
		}
		switch {
		case ch == '\'' || ch == '"' || ch == '`':
			quote = ch
			out.WriteByte(ch)
		case ch == '[':
			quote = ']'
			out.WriteByte(ch)
		case ch == '-' && i+1 < len(s) && s[i+1] == '-':
			for i < len(s) && s[i] != '\n' {
				i++
			}
			out.WriteByte('\n')
		case ch == '/' && i+1 < len(s) && s[i+1] == '*':
			end := strings.Index(s[i+2:], "*/")
			if end < 0 {
				i = len(s)
			} else {
				i += end + 3
			}
			out.WriteByte(' ')
		default:
			out.WriteByte(ch)
		}
	}
	return out.String()
}

// columnDefinitionName returns the (unquoted) column name a column definition
// starts with.
func columnDefinitionName(item string) string {
	fields := strings.Fields(item)
	if len(fields) == 0 {
		return ""
	}
	return strings.Trim(fields[0], "\"`[]")
}

// referencesIdentifier reports whether sql mentions ident as a whole word, so
// idx_permission_application_id does not count as a reference to
// application_id.
func referencesIdentifier(sql, ident string) bool {
	re := regexp.MustCompile(`(?i)(^|[^A-Za-z0-9_])` + regexp.QuoteMeta(ident) + `([^A-Za-z0-9_]|$)`)
	return re.MatchString(sql)
}

func quoteIdentifier(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

// tableIndexSQL returns the CREATE statements of a table's explicit indexes.
// Indexes SQLite creates for UNIQUE and PRIMARY KEY constraints have no SQL;
// the rebuilt table's own constraints recreate them.
func tableIndexSQL(tx *gorm.DB, table string) ([]string, error) {
	var statements []string
	if err := tx.Raw(
		`SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL ORDER BY name`,
		table,
	).Scan(&statements).Error; err != nil {
		return nil, err
	}
	return statements, nil
}

func tableColumns(tx *gorm.DB, table string) ([]string, error) {
	rows, err := tx.Raw(fmt.Sprintf("PRAGMA table_info(%s)", quoteIdentifier(table))).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var columns []string
	for rows.Next() {
		var cid int
		var name string
		var colType string
		var notNull int
		var dfltValue any
		var pk int
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dfltValue, &pk); err != nil {
			return nil, err
		}
		columns = append(columns, name)
	}
	return columns, rows.Err()
}

// autoincrementSequence returns the AUTOINCREMENT counter of table, if it has
// one.
func autoincrementSequence(tx *gorm.DB, table string) (int64, bool, error) {
	hasSequenceTable, err := tableExists(tx, "sqlite_sequence")
	if err != nil {
		return 0, false, err
	}
	if !hasSequenceTable {
		return 0, false, nil
	}
	var sequences []int64
	if err := tx.Raw(`SELECT seq FROM sqlite_sequence WHERE name = ?`, table).Scan(&sequences).Error; err != nil {
		return 0, false, err
	}
	if len(sequences) == 0 {
		return 0, false, nil
	}
	return sequences[0], true, nil
}
