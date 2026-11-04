package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// DatabaseKind is the canonical kind of a database resource instance: the one
// bundled kind whose settings the db service understands, because it owns the
// rows they describe and validates every write to them.
const DatabaseKind = "woofx3:database"

// databaseColumnsSetting is the instance setting holding the column
// definitions.
const databaseColumnsSetting = "columns"

// DatabaseLimits are integrity bounds of every database, on every engine. Must
// match DATABASE_LIMITS in shared/clients/typescript/api.
type DatabaseLimits struct {
	MaxColumns int
	// MaxRecords is a fixed cap, not a plan entitlement.
	MaxRecords int64
	// MaxPageSize bounds one listing.
	MaxPageSize int
}

// DefaultDatabaseLimits are the limits the db service runs with.
func DefaultDatabaseLimits() DatabaseLimits {
	return DatabaseLimits{MaxColumns: 32, MaxRecords: 10_000, MaxPageSize: 100}
}

// DatabaseColumnType is what a column's cells hold.
type DatabaseColumnType string

const (
	DatabaseColumnText    DatabaseColumnType = "text"
	DatabaseColumnNumber  DatabaseColumnType = "number"
	DatabaseColumnBoolean DatabaseColumnType = "boolean"
	DatabaseColumnDate    DatabaseColumnType = "date"
	DatabaseColumnURL     DatabaseColumnType = "url"
	DatabaseColumnSelect  DatabaseColumnType = "select"
)

var databaseColumnTypes = map[DatabaseColumnType]bool{
	DatabaseColumnText: true, DatabaseColumnNumber: true, DatabaseColumnBoolean: true,
	DatabaseColumnDate: true, DatabaseColumnURL: true, DatabaseColumnSelect: true,
}

const (
	maxDatabaseColumnLabel   = 100
	maxDatabaseSelectOptions = 50
)

// databaseColumnIDPattern is the form question id rule, so every question id
// is a valid column id; an id of only digits is refused because a
// `${...values.<id>}` path would read it as a list index.
var (
	databaseColumnIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	allDigits               = regexp.MustCompile(`^[0-9]+$`)
)

// DatabaseColumn is one column definition of the `columns` setting.
type DatabaseColumn struct {
	ID    string             `json:"id"`
	Label string             `json:"label"`
	Type  DatabaseColumnType `json:"type"`
	// Public columns are the only ones that leave the engine toward the
	// public user page.
	Public  bool                   `json:"public"`
	Options []DatabaseColumnOption `json:"options,omitempty"`
}

type DatabaseColumnOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// hasOption reports whether a select column offers value.
func (c DatabaseColumn) hasOption(value string) bool {
	for _, option := range c.Options {
		if option.Value == value {
			return true
		}
	}
	return false
}

// parseDatabaseColumns reads and checks the column definitions of a database
// instance's settings. Settings without `columns` define no columns yet.
func parseDatabaseColumns(settingsJSON string, limits DatabaseLimits) ([]DatabaseColumn, error) {
	settings := map[string]json.RawMessage{}
	if strings.TrimSpace(settingsJSON) != "" {
		if err := json.Unmarshal([]byte(settingsJSON), &settings); err != nil {
			return nil, kindSettingsErrorf("settings must be a JSON object")
		}
	}
	raw, ok := settings[databaseColumnsSetting]
	if !ok || string(raw) == "null" {
		return []DatabaseColumn{}, nil
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var columns []DatabaseColumn
	if err := decoder.Decode(&columns); err != nil {
		return nil, kindSettingsErrorf("columns must be a list of column definitions: %v", err)
	}
	if len(columns) > limits.MaxColumns {
		return nil, kindSettingsErrorf("a database holds at most %d columns", limits.MaxColumns)
	}
	seen := make(map[string]bool, len(columns))
	for i, column := range columns {
		if err := checkDatabaseColumn(column); err != nil {
			return nil, kindSettingsErrorf("column %d: %s", i+1, err.Error())
		}
		if seen[column.ID] {
			return nil, kindSettingsErrorf("column %d: id %q is used by another column", i+1, column.ID)
		}
		seen[column.ID] = true
	}
	if columns == nil {
		columns = []DatabaseColumn{}
	}
	return columns, nil
}

func checkDatabaseColumn(column DatabaseColumn) error {
	if !databaseColumnIDPattern.MatchString(column.ID) || allDigits.MatchString(column.ID) {
		return fmt.Errorf("id must be 1 to 64 letters, digits, \"-\" or \"_\", and not only digits")
	}
	if err := checkDatabaseLabel(column.Label); err != nil {
		return fmt.Errorf("label %s", err.Error())
	}
	if !databaseColumnTypes[column.Type] {
		return fmt.Errorf("type must be text, number, boolean, date, url or select")
	}
	if column.Type != DatabaseColumnSelect {
		if len(column.Options) > 0 {
			return fmt.Errorf("only a select column has options")
		}
		return nil
	}
	if len(column.Options) == 0 || len(column.Options) > maxDatabaseSelectOptions {
		return fmt.Errorf("a select column has 1 to %d options", maxDatabaseSelectOptions)
	}
	values := make(map[string]bool, len(column.Options))
	for _, option := range column.Options {
		if !databaseColumnIDPattern.MatchString(option.Value) {
			return fmt.Errorf("option values must be 1 to 64 letters, digits, \"-\" or \"_\"")
		}
		if values[option.Value] {
			return fmt.Errorf("option value %q repeats", option.Value)
		}
		values[option.Value] = true
		if err := checkDatabaseLabel(option.Label); err != nil {
			return fmt.Errorf("option label %s", err.Error())
		}
	}
	return nil
}

func checkDatabaseLabel(label string) error {
	if strings.ContainsRune(label, 0) {
		return fmt.Errorf("must not contain a NUL character")
	}
	if n := utf8.RuneCountInString(label); n == 0 || n > maxDatabaseColumnLabel {
		return fmt.Errorf("must be 1 to %d characters", maxDatabaseColumnLabel)
	}
	return nil
}
