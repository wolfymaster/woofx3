package repository

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ErrDatabaseRecordRevisionConflict is returned by Update when the record no
// longer holds the revision the caller expected.
var ErrDatabaseRecordRevisionConflict = errors.New("database record revision conflict")

// ErrDatabaseRecordValueHasNUL is returned for a value holding a NUL
// character, which Postgres jsonb cannot store. Refusing it on both dialects
// keeps a SQLite engine from holding rows a Postgres one would reject.
var ErrDatabaseRecordValueHasNUL = errors.New("database record value contains a NUL character")

// updateRetryAttempts bounds how often Update re-reads a record another writer
// changed between its read and its write, when the caller set no expected
// revision. Each retry means a concurrent write landed.
const updateRetryAttempts = 8

// DatabaseRecordSort orders a listing. An empty ColumnID sorts by creation
// time. Empty cells sort last in either direction.
type DatabaseRecordSort struct {
	ColumnID   string
	Descending bool
}

// DatabaseRecordRepository stores the rows of database resource instances.
// A service composes a record write with its outbox event in one transaction
// by running the write on WithTx(tx) inside Transaction.
//
// Cell values are JSON scalars: string, float64 or bool. The column id and
// any compared value are always bound parameters, never part of the SQL text.
type DatabaseRecordRepository struct {
	db  *gorm.DB
	now func() time.Time
}

func NewDatabaseRecordRepository(db *gorm.DB, now func() time.Time) (*DatabaseRecordRepository, error) {
	if db == nil {
		return nil, errors.New("database record repository: db is nil")
	}
	if now == nil {
		return nil, errors.New("database record repository: clock is nil")
	}
	return &DatabaseRecordRepository{db: db, now: now}, nil
}

// Transaction runs fn in one transaction, bound to ctx.
func (r *DatabaseRecordRepository) Transaction(ctx context.Context, fn func(tx *gorm.DB) error) error {
	return r.db.WithContext(ctx).Transaction(fn)
}

// WithTx is the repository running on tx, such as one Transaction opened.
func (r *DatabaseRecordRepository) WithTx(tx *gorm.DB) *DatabaseRecordRepository {
	return &DatabaseRecordRepository{db: tx, now: r.now}
}

// Insert stores a new record with revision 1, unless the record's InsertKey
// is already stored for its database. It returns the stored record and
// whether this call wrote it: on a repeat key, the existing record.
//
// The duplicate is detected by the unique index rather than a lookup first,
// so two racing writers with the same key produce one row.
func (r *DatabaseRecordRepository) Insert(ctx context.Context, databaseID uuid.UUID, values map[string]any, insertKey *string) (*models.DatabaseRecord, bool, error) {
	encoded, err := encodeRecordValues(values)
	if err != nil {
		return nil, false, err
	}
	now := r.timestamp()
	record := &models.DatabaseRecord{
		DatabaseInstanceID: databaseID,
		Values:             encoded,
		InsertKey:          insertKey,
		Revision:           1,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	if insertKey == nil {
		if err := r.db.WithContext(ctx).Create(record).Error; err != nil {
			return nil, false, fmt.Errorf("insert database record: %w", err)
		}
		return record, true, nil
	}
	result := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "database_instance_id"}, {Name: "insert_key"}},
		DoNothing: true,
	}).Create(record)
	if result.Error != nil {
		return nil, false, fmt.Errorf("insert database record: %w", result.Error)
	}
	if result.RowsAffected > 0 {
		return record, true, nil
	}
	var existing models.DatabaseRecord
	if err := r.db.WithContext(ctx).Where("database_instance_id = ? AND insert_key = ?", databaseID, *insertKey).Take(&existing).Error; err != nil {
		return nil, false, fmt.Errorf("read database record of a repeated insert key: %w", err)
	}
	return &existing, false, nil
}

// Update applies patch to a record's values: a key with a nil value clears
// that cell, any other key sets it, and cells not in patch keep their value.
// The revision grows by one.
//
// With expectedRevision set, the update applies only while the record holds
// that revision, and ErrDatabaseRecordRevisionConflict reports that it does
// not. Without it, a concurrent write is re-read and the patch applied on top.
// A missing record is gorm.ErrRecordNotFound.
func (r *DatabaseRecordRepository) Update(ctx context.Context, databaseID, id uuid.UUID, patch map[string]any, expectedRevision *int64) (*models.DatabaseRecord, error) {
	// stylegate:ignore ANY-ERR-007 reason="a lost compare-and-set on one row, retried at once like CompareAndSetResourceInstanceSetting; no remote call to back off from"
	for attempt := 0; attempt < updateRetryAttempts; attempt++ {
		record, err := r.Get(ctx, databaseID, id)
		if err != nil {
			return nil, err
		}
		if expectedRevision != nil && record.Revision != *expectedRevision {
			return nil, ErrDatabaseRecordRevisionConflict
		}
		values, err := DecodeRecordValues(record.Values)
		if err != nil {
			return nil, err
		}
		for columnID, value := range patch {
			if value == nil {
				delete(values, columnID)
				continue
			}
			values[columnID] = value
		}
		encoded, err := encodeRecordValues(values)
		if err != nil {
			return nil, err
		}
		now := r.timestamp()
		result := r.db.WithContext(ctx).Model(&models.DatabaseRecord{}).
			Where("id = ? AND revision = ?", id, record.Revision).
			Updates(&models.DatabaseRecord{Values: encoded, Revision: record.Revision + 1, UpdatedAt: now})
		if result.Error != nil {
			return nil, fmt.Errorf("update database record: %w", result.Error)
		}
		if result.RowsAffected == 0 {
			if expectedRevision != nil {
				return nil, ErrDatabaseRecordRevisionConflict
			}
			continue
		}
		record.Values = encoded
		record.Revision++
		record.UpdatedAt = now
		return record, nil
	}
	return nil, ErrDatabaseRecordRevisionConflict
}

// Delete removes a record and returns it as it was. A missing record is
// gorm.ErrRecordNotFound.
func (r *DatabaseRecordRepository) Delete(ctx context.Context, databaseID, id uuid.UUID) (*models.DatabaseRecord, error) {
	record, err := r.Get(ctx, databaseID, id)
	if err != nil {
		return nil, err
	}
	result := r.db.WithContext(ctx).Where("id = ? AND database_instance_id = ?", id, databaseID).Delete(&models.DatabaseRecord{})
	if result.Error != nil {
		return nil, fmt.Errorf("delete database record: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	return record, nil
}

// Get reads one record of a database. A record of another database is
// gorm.ErrRecordNotFound, like a missing one.
func (r *DatabaseRecordRepository) Get(ctx context.Context, databaseID, id uuid.UUID) (*models.DatabaseRecord, error) {
	var record models.DatabaseRecord
	if err := r.db.WithContext(ctx).Where("id = ? AND database_instance_id = ?", id, databaseID).Take(&record).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

// List reads one page of a database's records in the given order. Ties fall
// to creation time, then id, so pages never overlap.
func (r *DatabaseRecordRepository) List(ctx context.Context, databaseID uuid.UUID, sort DatabaseRecordSort, offset, limit int) ([]*models.DatabaseRecord, error) {
	direction := "ASC"
	if sort.Descending {
		direction = "DESC"
	}
	// One ORDER BY expression: gorm drops an expression ordering when a later
	// Order call merges in plain columns.
	order := clause.Expr{SQL: "created_at " + direction + ", id " + direction}
	if sort.ColumnID != "" {
		order = clause.Expr{
			SQL:  r.cellSQL() + " " + direction + " NULLS LAST, created_at " + direction + ", id " + direction,
			Vars: []any{r.cellPath(sort.ColumnID)},
		}
	}
	var records []*models.DatabaseRecord
	err := r.db.WithContext(ctx).Where("database_instance_id = ?", databaseID).
		Order(clause.OrderBy{Expression: order}).
		Offset(offset).
		Limit(limit).
		Find(&records).Error
	if err != nil {
		return nil, fmt.Errorf("list database records: %w", err)
	}
	return records, nil
}

// Count is how many records a database holds.
func (r *DatabaseRecordRepository) Count(ctx context.Context, databaseID uuid.UUID) (int64, error) {
	var count int64
	if err := r.db.WithContext(ctx).Model(&models.DatabaseRecord{}).Where("database_instance_id = ?", databaseID).Count(&count).Error; err != nil {
		return 0, fmt.Errorf("count database records: %w", err)
	}
	return count, nil
}

// CountByColumn is how many records of a database hold a value for a column.
func (r *DatabaseRecordRepository) CountByColumn(ctx context.Context, databaseID uuid.UUID, columnID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&models.DatabaseRecord{}).
		Where("database_instance_id = ?", databaseID).
		Where(r.cellSQL()+" IS NOT NULL", r.cellPath(columnID)).
		Count(&count).Error
	if err != nil {
		return 0, fmt.Errorf("count database records by column: %w", err)
	}
	return count, nil
}

// CountByColumnValue is how many records of a database hold value in a
// column.
func (r *DatabaseRecordRepository) CountByColumnValue(ctx context.Context, databaseID uuid.UUID, columnID string, value any) (int64, error) {
	cell, bound, err := r.cellEquals(columnID, value)
	if err != nil {
		return 0, err
	}
	var count int64
	err = r.db.WithContext(ctx).Model(&models.DatabaseRecord{}).
		Where("database_instance_id = ?", databaseID).
		Where(cell, bound...).
		Count(&count).Error
	if err != nil {
		return 0, fmt.Errorf("count database records by column value: %w", err)
	}
	return count, nil
}

// FindFirstByColumnValue reads the earliest-created record of a database
// holding value in a column. None is gorm.ErrRecordNotFound.
func (r *DatabaseRecordRepository) FindFirstByColumnValue(ctx context.Context, databaseID uuid.UUID, columnID string, value any) (*models.DatabaseRecord, error) {
	cell, bound, err := r.cellEquals(columnID, value)
	if err != nil {
		return nil, err
	}
	var record models.DatabaseRecord
	err = r.db.WithContext(ctx).Where("database_instance_id = ?", databaseID).
		Where(cell, bound...).
		Order("created_at ASC").
		Order("id ASC").
		Take(&record).Error
	if err != nil {
		return nil, err
	}
	return &record, nil
}

// StripColumn removes a column's value from every record of a database, so a
// later column with the same id starts empty. It leaves revisions alone: the
// column is gone from the definition, so no reader shows the cell anyway.
func (r *DatabaseRecordRepository) StripColumn(ctx context.Context, databaseID uuid.UUID, columnID string) (int64, error) {
	var stripped string
	// stylegate:ignore ANY-ABS-001 reason="the repository picks SQL per dialect on a dialect-checked path, the convention TestSQLStringsWorkOnBothDialects enforces"
	if r.isPostgres() {
		stripped = "record_values - ?::text"
	} else {
		stripped = `json_remove(record_values, ?)`
	}
	result := r.db.WithContext(ctx).Model(&models.DatabaseRecord{}).
		Where("database_instance_id = ?", databaseID).
		Where(r.cellSQL()+" IS NOT NULL", r.cellPath(columnID)).
		Update("record_values", gorm.Expr(stripped, r.cellPath(columnID)))
	if result.Error != nil {
		return 0, fmt.Errorf("strip database column: %w", result.Error)
	}
	return result.RowsAffected, nil
}

// cellSQL is one cell of record_values as a SQL expression taking the cell's
// path (see cellPath) as its one parameter. It is NULL for an empty cell.
//
// The cell keeps its JSON type on both dialects, so numbers order by value,
// text as text, and booleans false before true, with no cast that a malformed
// row could fail: a Postgres jsonb value compares as jsonb, and SQLite's
// json_extract returns a native INTEGER, REAL or TEXT.
func (r *DatabaseRecordRepository) cellSQL() string {
	if r.isPostgres() {
		return "(record_values -> ?::text)"
	}
	return "json_extract(record_values, ?)"
}

// cellPath is what cellSQL binds for a column: the key itself on Postgres, a
// JSON path on SQLite. Column ids are letters, digits, "_" and "-", so the
// quoted path names exactly that key.
func (r *DatabaseRecordRepository) cellPath(columnID string) string {
	if r.isPostgres() {
		return columnID
	}
	return `$."` + columnID + `"`
}

// cellEquals is a condition that a column's cell equals value, with its
// parameters. SQLite's json_extract reads a JSON boolean as 0 or 1, so a
// boolean is bound as that integer there; Postgres compares jsonb values.
func (r *DatabaseRecordRepository) cellEquals(columnID string, value any) (string, []any, error) {
	// stylegate:ignore ANY-ABS-001 reason="the repository picks SQL per dialect on a dialect-checked path, the convention TestSQLStringsWorkOnBothDialects enforces"
	if r.isPostgres() {
		encoded, err := json.Marshal(value)
		if err != nil {
			return "", nil, fmt.Errorf("encode compared value: %w", err)
		}
		return r.cellSQL() + " = ?::jsonb", []any{r.cellPath(columnID), string(encoded)}, nil
	}
	bound := value
	if b, ok := value.(bool); ok {
		bound = 0
		if b {
			bound = 1
		}
	}
	return r.cellSQL() + " = ?", []any{r.cellPath(columnID), bound}, nil
}

// timestamp is the clock's time in UTC at microsecond precision, the finest
// both dialects store, so a record reads back with the time it was written.
func (r *DatabaseRecordRepository) timestamp() time.Time {
	return r.now().UTC().Truncate(time.Microsecond)
}

func (r *DatabaseRecordRepository) isPostgres() bool {
	return database.Dialect(r.db.Name()) == database.DialectPostgres
}

// DecodeRecordValues reads a record's stored values.
func DecodeRecordValues(encoded string) (map[string]any, error) {
	values := map[string]any{}
	if err := json.Unmarshal([]byte(encoded), &values); err != nil {
		return nil, fmt.Errorf("decode database record values: %w", err)
	}
	if values == nil {
		values = map[string]any{}
	}
	return values, nil
}

// encodeRecordValues writes values as compact JSON, with HTML escaping off so
// text is stored as it was typed.
func encodeRecordValues(values map[string]any) (string, error) {
	for _, value := range values {
		if text, ok := value.(string); ok && strings.ContainsRune(text, 0) {
			return "", ErrDatabaseRecordValueHasNUL
		}
	}
	if values == nil {
		values = map[string]any{}
	}
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(values); err != nil {
		return "", fmt.Errorf("encode database record values: %w", err)
	}
	return strings.TrimSuffix(buf.String(), "\n"), nil
}
