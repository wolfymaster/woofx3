package main

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// fakeDatabaseRecords answers like the db service would and records what it
// was asked. The methods no action calls fail the test's step loudly.
type fakeDatabaseRecords struct {
	creates  []*dbv1.CreateDatabaseRecordRequest
	updates  []*dbv1.UpdateDatabaseRecordRequest
	finds    []*dbv1.FindDatabaseRecordRequest
	outcome  dbv1.CreateDatabaseRecordOutcome
	updated  bool
	found    *dbv1.DatabaseRecord
	existing string
}

func (f *fakeDatabaseRecords) CreateDatabaseRecord(_ context.Context, req *dbv1.CreateDatabaseRecordRequest) (*dbv1.CreateDatabaseRecordResponse, error) {
	f.creates = append(f.creates, req)
	resp := &dbv1.CreateDatabaseRecordResponse{Outcome: f.outcome}
	if f.outcome != dbv1.CreateDatabaseRecordOutcome_CREATE_DATABASE_RECORD_OUTCOME_FULL {
		resp.Record = &dbv1.DatabaseRecord{Id: f.existing}
	}
	return resp, nil
}

func (f *fakeDatabaseRecords) UpdateDatabaseRecord(_ context.Context, req *dbv1.UpdateDatabaseRecordRequest) (*dbv1.UpdateDatabaseRecordResponse, error) {
	f.updates = append(f.updates, req)
	return &dbv1.UpdateDatabaseRecordResponse{Updated: f.updated}, nil
}

func (f *fakeDatabaseRecords) FindDatabaseRecord(_ context.Context, req *dbv1.FindDatabaseRecordRequest) (*dbv1.FindDatabaseRecordResponse, error) {
	f.finds = append(f.finds, req)
	return &dbv1.FindDatabaseRecordResponse{Found: f.found != nil, Record: f.found}, nil
}

var errNotCalledByActions = errors.New("not called by the database actions")

func (f *fakeDatabaseRecords) DeleteDatabaseRecord(context.Context, *dbv1.DeleteDatabaseRecordRequest) (*dbv1.DeleteDatabaseRecordResponse, error) {
	return nil, errNotCalledByActions
}

func (f *fakeDatabaseRecords) GetDatabaseRecord(context.Context, *dbv1.GetDatabaseRecordRequest) (*dbv1.GetDatabaseRecordResponse, error) {
	return nil, errNotCalledByActions
}

func (f *fakeDatabaseRecords) ListDatabaseRecords(context.Context, *dbv1.ListDatabaseRecordsRequest) (*dbv1.ListDatabaseRecordsResponse, error) {
	return nil, errNotCalledByActions
}

func (f *fakeDatabaseRecords) ListPublicDatabaseRecords(context.Context, *dbv1.ListPublicDatabaseRecordsRequest) (*dbv1.ListPublicDatabaseRecordsResponse, error) {
	return nil, errNotCalledByActions
}

var _ dbv1.DatabaseRecordService = (*fakeDatabaseRecords)(nil)

func runDatabaseAction(t *testing.T, records *fakeDatabaseRecords, action tasks.ActionFunc[AppServices], params map[string]any) map[string]any {
	t.Helper()
	result, err := action(tasks.ActionContext[AppServices]{Services: AppServices{records: records}, Context: context.Background()}, params)
	if err != nil {
		t.Fatalf("action: %v", err)
	}
	return result
}

const gamesDatabase = "woofx3:database:games"

func TestDatabaseInsertSendsTextValuesAndTheKey(t *testing.T) {
	records := &fakeDatabaseRecords{outcome: dbv1.CreateDatabaseRecordOutcome_CREATE_DATABASE_RECORD_OUTCOME_CREATED, existing: "row-1"}
	result := runDatabaseAction(t, records, NewDatabaseInsertAction(), map[string]any{
		"target": gamesDatabase,
		"values": map[string]any{"game": "Celeste", "score": 12.0, "won": true, "note": nil},
		"key":    "submission-1",
	})
	if result["inserted"] != true || result["recordId"] != "row-1" || result["reason"] != "" {
		t.Fatalf("result = %v", result)
	}
	sent := records.creates[0]
	if sent.DatabaseId != gamesDatabase || sent.GetInsertKey() != "submission-1" {
		t.Fatalf("request = %v", sent)
	}
	want := map[string]string{"game": "Celeste", "score": "12", "won": "true", "note": ""}
	for column, value := range want {
		if got := sent.GetTextValues().Values[column]; got != value {
			t.Fatalf("values[%s] = %q, want %q", column, got, value)
		}
	}
}

func TestDatabaseInsertReportsADuplicateAndAFullDatabase(t *testing.T) {
	cases := []struct {
		outcome  dbv1.CreateDatabaseRecordOutcome
		recordID string
		reason   string
	}{
		{dbv1.CreateDatabaseRecordOutcome_CREATE_DATABASE_RECORD_OUTCOME_DUPLICATE, "row-1", "duplicate"},
		{dbv1.CreateDatabaseRecordOutcome_CREATE_DATABASE_RECORD_OUTCOME_FULL, "", "full"},
	}
	for _, tc := range cases {
		t.Run(tc.reason, func(t *testing.T) {
			records := &fakeDatabaseRecords{outcome: tc.outcome, existing: "row-1"}
			result := runDatabaseAction(t, records, NewDatabaseInsertAction(), map[string]any{"target": gamesDatabase, "key": "k"})
			if result["inserted"] != false || result["reason"] != tc.reason || result["recordId"] != tc.recordID {
				t.Fatalf("result = %v", result)
			}
		})
	}
}

func TestDatabaseInsertRefusesAnUnknownOutcome(t *testing.T) {
	services := AppServices{records: &fakeDatabaseRecords{}}
	_, err := NewDatabaseInsertAction()(tasks.ActionContext[AppServices]{Services: services, Context: context.Background()}, map[string]any{"target": gamesDatabase})
	if err == nil || !strings.Contains(err.Error(), "outcome") {
		t.Fatalf("unspecified outcome error = %v", err)
	}
}

func TestDatabaseUpdateReportsAMissingRow(t *testing.T) {
	records := &fakeDatabaseRecords{updated: false}
	result := runDatabaseAction(t, records, NewDatabaseUpdateAction(), map[string]any{
		"target": gamesDatabase, "record": "row-9", "values": map[string]any{"vod": ""},
	})
	if result["updated"] != false || result["reason"] != "missing" || result["recordId"] != "row-9" {
		t.Fatalf("result = %v", result)
	}
	if got := records.updates[0].GetTextValues().Values["vod"]; got != "" {
		t.Fatalf("an empty value must reach the service as empty text, got %q", got)
	}
}

func TestDatabaseGetReturnsValuesByColumn(t *testing.T) {
	created := time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)
	records := &fakeDatabaseRecords{found: &dbv1.DatabaseRecord{Id: "row-1", CreatedAt: timestamppb.New(created), ValuesJson: `{"game":"Celeste","score":12}`}}
	result := runDatabaseAction(t, records, NewDatabaseGetAction(), map[string]any{
		"target": gamesDatabase, "matchColumn": "game", "match": "Celeste",
	})
	values, _ := result["values"].(map[string]any)
	if result["found"] != true || result["recordId"] != "row-1" || values["game"] != "Celeste" || values["score"] != 12.0 {
		t.Fatalf("result = %v", result)
	}
	if result["createdAt"] != "2026-11-04T12:00:00.000Z" {
		t.Fatalf("createdAt = %v", result["createdAt"])
	}
	if sent := records.finds[0]; sent.ColumnId != "game" || sent.Match != "Celeste" {
		t.Fatalf("request = %v", sent)
	}

	missing := runDatabaseAction(t, &fakeDatabaseRecords{}, NewDatabaseGetAction(), map[string]any{"target": gamesDatabase, "match": "row-2"})
	if missing["found"] != false {
		t.Fatalf("missing = %v", missing)
	}
}

func TestDatabaseActionsRefuseAStepTheyCannotCarryOut(t *testing.T) {
	insert := func(p map[string]any) error { _, err := parseDatabaseInsertParams(p); return err }
	update := func(p map[string]any) error { _, err := parseDatabaseUpdateParams(p); return err }
	get := func(p map[string]any) error { _, err := parseDatabaseGetParams(p); return err }
	cases := []struct {
		name    string
		parse   func(map[string]any) error
		params  map[string]any
		problem string
	}{
		{"insert without a database", insert, map[string]any{}, "target must be a database"},
		{"insert with values not an object", insert, map[string]any{"target": gamesDatabase, "values": "x"}, "values must be an object"},
		{"insert with a list value", insert, map[string]any{"target": gamesDatabase, "values": map[string]any{"a": []any{}}}, "values.a must be text"},
		{"update without a row", update, map[string]any{"target": gamesDatabase}, "record must be a row id"},
		{"get without a match", get, map[string]any{"target": gamesDatabase, "match": " "}, "match must be the text"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.parse(tc.params)
			if err == nil || !strings.Contains(err.Error(), tc.problem) {
				t.Fatalf("error = %v, want one mentioning %q", err, tc.problem)
			}
		})
	}
}

func TestDatabaseDryRunsWriteNothing(t *testing.T) {
	if !databaseInsertActionSpec.SideEffect || !databaseUpdateActionSpec.SideEffect || databaseGetActionSpec.SideEffect {
		t.Fatal("insert and update change rows; get only reads")
	}
	summary, err := databaseInsertActionSpec.DryRun(map[string]any{"target": gamesDatabase, "values": map[string]any{"game": "Celeste"}})
	if err != nil || !strings.Contains(summary, "would add a row") {
		t.Fatalf("insert dry run = %q, %v", summary, err)
	}
	if _, err := databaseUpdateActionSpec.DryRun(map[string]any{"target": gamesDatabase}); err == nil || !strings.Contains(err.Error(), "record must be a row id") {
		t.Fatalf("update dry run without a row = %v", err)
	}
}
