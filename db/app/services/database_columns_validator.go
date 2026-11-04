package services

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

// DatabaseColumnsValidator is the settings validator of DatabaseKind. It
// checks the column definitions, refuses a change that would misread values
// records already hold, and strips the values of deleted columns, all in the
// transaction that writes the settings.
type DatabaseColumnsValidator struct {
	records *repo.DatabaseRecordRepository
	limits  DatabaseLimits
}

func NewDatabaseColumnsValidator(records *repo.DatabaseRecordRepository, limits DatabaseLimits) (*DatabaseColumnsValidator, error) {
	if records == nil {
		return nil, errors.New("database columns validator: record repository is nil")
	}
	return &DatabaseColumnsValidator{records: records, limits: limits}, nil
}

func (v *DatabaseColumnsValidator) ApplySettings(ctx context.Context, tx *gorm.DB, instanceID uuid.UUID, previous, next string) error {
	columns, err := parseDatabaseColumns(next, v.limits)
	if err != nil {
		return err
	}
	if previous == "" {
		return nil
	}
	// The stored definition passed this check when it was written, so a
	// failure to read it is corruption, not the caller's mistake.
	before, err := parseDatabaseColumns(previous, v.limits)
	if err != nil {
		return fmt.Errorf("read stored columns of database %s: %w", instanceID, err)
	}
	records := v.records.WithTx(tx)
	byID := make(map[string]DatabaseColumn, len(columns))
	for _, column := range columns {
		byID[column.ID] = column
	}
	for _, old := range before {
		column, kept := byID[old.ID]
		if !kept {
			if _, err := records.StripColumn(ctx, instanceID, old.ID); err != nil {
				return err
			}
			continue
		}
		if err := v.checkKeptColumn(ctx, records, instanceID, old, column); err != nil {
			return err
		}
	}
	return nil
}

// checkKeptColumn refuses a change to a column that records' values would no
// longer fit: a new type while any record holds a value, or a removed select
// option while any record holds it.
func (v *DatabaseColumnsValidator) checkKeptColumn(ctx context.Context, records *repo.DatabaseRecordRepository, instanceID uuid.UUID, old, column DatabaseColumn) error {
	if old.Type != column.Type {
		count, err := records.CountByColumn(ctx, instanceID, column.ID)
		if err != nil {
			return err
		}
		if count > 0 {
			return kindSettingsErrorf("column %q keeps its type while %d row(s) hold a value in it", column.Label, count)
		}
		return nil
	}
	if column.Type != DatabaseColumnSelect {
		return nil
	}
	for _, option := range old.Options {
		if column.hasOption(option.Value) {
			continue
		}
		count, err := records.CountByColumnValue(ctx, instanceID, column.ID, option.Value)
		if err != nil {
			return err
		}
		if count > 0 {
			return kindSettingsErrorf("column %q keeps option %q while %d row(s) use it", column.Label, option.Label, count)
		}
	}
	return nil
}
