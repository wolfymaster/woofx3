package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
)

// The reasons a database action reports for not changing a row. Must match
// the `returns` of the database actions in modules/woofx3/manifest.json.
const (
	databaseReasonDuplicate = "duplicate"
	databaseReasonFull      = "full"
	databaseReasonMissing   = "missing"
)

// databaseWrite is the parsed parameters of `database.insert` and
// `database.update`. Values are text per column id: the db service converts
// each to its column's type and refuses, naming the column, a value that does
// not fit.
type databaseWrite struct {
	target    string
	recordID  string
	values    map[string]string
	insertKey *string
}

type databaseRead struct {
	target      string
	matchColumn string
	match       string
}

// NewDatabaseInsertAction is the engine handler registered as
// `database.insert`: it adds a row to a database. A repeated `key` answers
// `inserted: false, reason: "duplicate"` with the row the first run stored, so
// a redelivered trigger adds nothing. A full database is not a failure either:
// like a full queue, it answers `reason: "full"`.
//
// Canonical id of the corresponding action declaration row:
// `woofx3:action:database.insert`.
func NewDatabaseInsertAction() tasks.ActionFunc[AppServices] {
	return func(ctx tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		write, err := parseDatabaseInsertParams(params)
		if err != nil {
			return nil, err
		}
		records := ctx.Services.DatabaseRecords()
		if records == nil {
			return nil, fmt.Errorf("the database service is not available")
		}
		resp, err := records.CreateDatabaseRecord(ctx.Context, &dbv1.CreateDatabaseRecordRequest{
			DatabaseId: write.target,
			Values:     &dbv1.CreateDatabaseRecordRequest_TextValues{TextValues: &dbv1.DatabaseTextValues{Values: write.values}},
			InsertKey:  write.insertKey,
		})
		if err != nil {
			return nil, fmt.Errorf("add a row to %s: %w", write.target, err)
		}
		return databaseInsertResult(write.target, resp)
	}
}

func databaseInsertResult(target string, resp *dbv1.CreateDatabaseRecordResponse) (map[string]any, error) {
	result := map[string]any{"target": target, "recordId": resp.GetRecord().GetId(), "inserted": false, "reason": ""}
	switch resp.Outcome {
	case dbv1.CreateDatabaseRecordOutcome_CREATE_DATABASE_RECORD_OUTCOME_CREATED:
		result["inserted"] = true
	case dbv1.CreateDatabaseRecordOutcome_CREATE_DATABASE_RECORD_OUTCOME_DUPLICATE:
		result["reason"] = databaseReasonDuplicate
	case dbv1.CreateDatabaseRecordOutcome_CREATE_DATABASE_RECORD_OUTCOME_FULL:
		result["reason"] = databaseReasonFull
	default:
		return nil, fmt.Errorf("add a row to %s: the database service answered outcome %s", target, resp.Outcome)
	}
	return result, nil
}

// NewDatabaseUpdateAction is the engine handler registered as
// `database.update`: it changes the columns given of one row and leaves the
// rest. An empty value clears its cell. A row that no longer exists answers
// `updated: false, reason: "missing"`.
//
// Canonical id: `woofx3:action:database.update`.
func NewDatabaseUpdateAction() tasks.ActionFunc[AppServices] {
	return func(ctx tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		write, err := parseDatabaseUpdateParams(params)
		if err != nil {
			return nil, err
		}
		records := ctx.Services.DatabaseRecords()
		if records == nil {
			return nil, fmt.Errorf("the database service is not available")
		}
		resp, err := records.UpdateDatabaseRecord(ctx.Context, &dbv1.UpdateDatabaseRecordRequest{
			DatabaseId: write.target,
			RecordId:   write.recordID,
			Values:     &dbv1.UpdateDatabaseRecordRequest_TextValues{TextValues: &dbv1.DatabaseTextValues{Values: write.values}},
		})
		if err != nil {
			return nil, fmt.Errorf("change row %s in %s: %w", write.recordID, write.target, err)
		}
		result := map[string]any{"target": write.target, "recordId": write.recordID, "updated": resp.Updated, "reason": ""}
		if !resp.Updated {
			result["reason"] = databaseReasonMissing
		}
		return result, nil
	}
}

// NewDatabaseGetAction is the engine handler registered as `database.get`: it
// reads one row, by its id or by the first row (oldest first) holding `match`
// in `matchColumn`. `values` is keyed by column id, so a later step reads
// `${steps.<id>.values.<column>}`.
//
// Canonical id: `woofx3:action:database.get`.
func NewDatabaseGetAction() tasks.ActionFunc[AppServices] {
	return func(ctx tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		read, err := parseDatabaseGetParams(params)
		if err != nil {
			return nil, err
		}
		records := ctx.Services.DatabaseRecords()
		if records == nil {
			return nil, fmt.Errorf("the database service is not available")
		}
		resp, err := records.FindDatabaseRecord(ctx.Context, &dbv1.FindDatabaseRecordRequest{
			DatabaseId: read.target,
			ColumnId:   read.matchColumn,
			Match:      read.match,
		})
		if err != nil {
			return nil, fmt.Errorf("read a row from %s: %w", read.target, err)
		}
		return databaseGetResult(read.target, resp)
	}
}

func databaseGetResult(target string, resp *dbv1.FindDatabaseRecordResponse) (map[string]any, error) {
	result := map[string]any{"target": target, "found": false, "recordId": "", "createdAt": "", "values": map[string]any{}}
	if !resp.Found {
		return result, nil
	}
	record := resp.GetRecord()
	values := map[string]any{}
	if err := json.Unmarshal([]byte(record.GetValuesJson()), &values); err != nil {
		return nil, fmt.Errorf("read a row from %s: the row's values are not an object: %w", target, err)
	}
	result["found"] = true
	result["recordId"] = record.GetId()
	result["createdAt"] = record.GetCreatedAt().AsTime().UTC().Format("2006-01-02T15:04:05.000Z07:00")
	result["values"] = values
	return result, nil
}

// The dry runs check the step's parameters as the real run would. Whether the
// values fit the database's columns is only known to the db service, which a
// dry run does not ask.
var (
	databaseInsertActionSpec = tasks.ActionSpec{
		SideEffect: true,
		DryRun: func(params map[string]any) (string, error) {
			write, err := parseDatabaseInsertParams(params)
			if err != nil {
				return "", err
			}
			return fmt.Sprintf("would add a row with %d value(s) to %s", len(write.values), write.target), nil
		},
	}
	databaseUpdateActionSpec = tasks.ActionSpec{
		SideEffect: true,
		DryRun: func(params map[string]any) (string, error) {
			write, err := parseDatabaseUpdateParams(params)
			if err != nil {
				return "", err
			}
			return fmt.Sprintf("would change %d value(s) of row %s in %s", len(write.values), write.recordID, write.target), nil
		},
	}
	databaseGetActionSpec = tasks.ActionSpec{SideEffect: false}
)

func parseDatabaseInsertParams(params map[string]any) (databaseWrite, error) {
	target, err := databaseTargetParam(params)
	if err != nil {
		return databaseWrite{}, err
	}
	values, err := databaseValuesParam(params["values"])
	if err != nil {
		return databaseWrite{}, err
	}
	write := databaseWrite{target: target, values: values}
	key, err := optionalTextParam(params, "key")
	if err != nil {
		return databaseWrite{}, err
	}
	if key != "" {
		write.insertKey = &key
	}
	return write, nil
}

func parseDatabaseUpdateParams(params map[string]any) (databaseWrite, error) {
	target, err := databaseTargetParam(params)
	if err != nil {
		return databaseWrite{}, err
	}
	recordID, err := optionalTextParam(params, "record")
	if err != nil {
		return databaseWrite{}, err
	}
	if recordID == "" {
		return databaseWrite{}, fmt.Errorf("record must be a row id, got %s", describeParam(params["record"]))
	}
	values, err := databaseValuesParam(params["values"])
	if err != nil {
		return databaseWrite{}, err
	}
	return databaseWrite{target: target, recordID: recordID, values: values}, nil
}

func parseDatabaseGetParams(params map[string]any) (databaseRead, error) {
	target, err := databaseTargetParam(params)
	if err != nil {
		return databaseRead{}, err
	}
	matchColumn, err := optionalTextParam(params, "matchColumn")
	if err != nil {
		return databaseRead{}, err
	}
	match, err := textOfValue(params["match"])
	if err != nil || strings.TrimSpace(match) == "" {
		return databaseRead{}, fmt.Errorf("match must be the text to look for, got %s", describeParam(params["match"]))
	}
	return databaseRead{target: target, matchColumn: matchColumn, match: match}, nil
}

func databaseTargetParam(params map[string]any) (string, error) {
	target, _ := params["target"].(string)
	if strings.TrimSpace(target) == "" {
		return "", fmt.Errorf("target must be a database, got %s", describeParam(params["target"]))
	}
	return target, nil
}

func optionalTextParam(params map[string]any, name string) (string, error) {
	text, err := textOfValue(params[name])
	if err != nil {
		return "", fmt.Errorf("%s must be text, got %s", name, describeParam(params[name]))
	}
	return text, nil
}

// databaseValuesParam reads a `database_values` parameter: an object of
// column id to value. An expression can resolve to a number or a boolean, so
// those become their text and reach the db service like typed-in text.
func databaseValuesParam(raw any) (map[string]string, error) {
	if raw == nil {
		return map[string]string{}, nil
	}
	object, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("values must be an object of column values, got %s", describeParam(raw))
	}
	values := make(map[string]string, len(object))
	for columnID, value := range object {
		text, err := textOfValue(value)
		if err != nil {
			return nil, fmt.Errorf("values.%s must be text, a number or true/false, got %s", columnID, describeParam(value))
		}
		values[columnID] = text
	}
	return values, nil
}

func textOfValue(value any) (string, error) {
	switch v := value.(type) {
	case nil:
		return "", nil
	case string:
		return v, nil
	case bool:
		return strconv.FormatBool(v), nil
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64), nil
	case int:
		return strconv.Itoa(v), nil
	}
	return "", fmt.Errorf("not text")
}
