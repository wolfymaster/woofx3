package services

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/dbtest"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

var coercionColumns = []DatabaseColumn{
	{ID: "game", Label: "Game", Type: DatabaseColumnText},
	{ID: "score", Label: "Score", Type: DatabaseColumnNumber},
	{ID: "won", Label: "Won", Type: DatabaseColumnBoolean},
	{ID: "on", Label: "Played on", Type: DatabaseColumnDate},
	{ID: "vod", Label: "VOD", Type: DatabaseColumnURL},
	{ID: "mood", Label: "Mood", Type: DatabaseColumnSelect, Options: []DatabaseColumnOption{{Value: "chill", Label: "Chill"}}},
}

func TestCoerceValues(t *testing.T) {
	tests := []struct {
		name    string
		mode    databaseValueMode
		column  string
		value   any
		want    any
		problem string
	}{
		{"typed text", databaseValuesTyped, "game", "Celeste", "Celeste", ""},
		{"typed null clears", databaseValuesTyped, "game", nil, nil, ""},
		{"typed text too long", databaseValuesTyped, "game", strings.Repeat("a", 5001), nil, "Game must be at most 5000"},
		{"typed text with NUL", databaseValuesTyped, "game", "a\x00", nil, "Game must not contain a NUL"},
		{"typed number", databaseValuesTyped, "score", 12.5, 12.5, ""},
		{"typed number as text", databaseValuesTyped, "score", "12", nil, "Score must be a number"},
		{"typed boolean", databaseValuesTyped, "won", true, true, ""},
		{"typed boolean as text", databaseValuesTyped, "won", "true", nil, "Won must be true or false"},
		{"typed date", databaseValuesTyped, "on", "2026-11-04", "2026-11-04", ""},
		{"typed bad date", databaseValuesTyped, "on", "2026-13-01", nil, "Played on must be a date"},
		{"typed url", databaseValuesTyped, "vod", "https://example.com/v/1", "https://example.com/v/1", ""},
		{"typed url without http", databaseValuesTyped, "vod", "ftp://example.com", nil, "VOD must be an http"},
		{"typed url too long", databaseValuesTyped, "vod", "https://example.com/" + strings.Repeat("a", 2048), nil, "VOD must be an http"},
		{"typed select", databaseValuesTyped, "mood", "chill", "chill", ""},
		{"typed unknown option", databaseValuesTyped, "mood", "hype", nil, "Mood must be one of its options"},
		{"typed number for text", databaseValuesTyped, "game", 3.0, nil, "Game must be text"},
		{"text empty clears", databaseValuesText, "score", "", nil, ""},
		{"text number", databaseValuesText, "score", " 12 ", 12.0, ""},
		{"text not a number", databaseValuesText, "score", "twelve", nil, "Score must be a number"},
		{"text infinity", databaseValuesText, "score", "Inf", nil, "Score must be a number"},
		{"text true", databaseValuesText, "won", "True", true, ""},
		{"text false", databaseValuesText, "won", "false", false, ""},
		{"text yes", databaseValuesText, "won", "yes", nil, "Won must be true or false"},
		{"text date", databaseValuesText, "on", "2026-11-04", "2026-11-04", ""},
		{"text RFC 3339 date in UTC", databaseValuesText, "on", "2026-11-04T23:30:00-05:00", "2026-11-05", ""},
		{"text bad date", databaseValuesText, "on", "yesterday", nil, "Played on must be a date"},
		{"text url", databaseValuesText, "vod", "http://example.com", "http://example.com", ""},
		{"text select", databaseValuesText, "mood", "chill", "chill", ""},
		{"text keeps spaces in text", databaseValuesText, "game", " Celeste ", " Celeste ", ""},
		{"text mode refuses non-text", databaseValuesText, "game", 3.0, nil, "Game must be text"},
		{"unknown column", databaseValuesTyped, "nope", "x", nil, `no column "nope"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			values, err := coerceValues(coercionColumns, map[string]any{tt.column: tt.value}, tt.mode)
			if tt.problem != "" {
				terr, ok := err.(twirp.Error)
				if !ok || terr.Code() != twirp.InvalidArgument || !strings.Contains(terr.Msg(), tt.problem) {
					t.Fatalf("error = %v, want invalid_argument mentioning %q", err, tt.problem)
				}
				if text, isText := tt.value.(string); isText && len(text) > 8 && strings.Contains(terr.Msg(), text) {
					t.Fatalf("error %q quotes the value", terr.Msg())
				}
				return
			}
			if err != nil {
				t.Fatalf("coerceValues: %v", err)
			}
			if got := values[tt.column]; got != tt.want {
				t.Fatalf("value = %#v, want %#v", got, tt.want)
			}
		})
	}
}

type recordFixture struct {
	svc     *DatabaseRecordService
	db      *gorm.DB
	columns *databaseFixture
}

func newRecordFixture(t *testing.T, db *gorm.DB, columns string, limits DatabaseLimits) *recordFixture {
	t.Helper()
	columnsFixture := newDatabaseFixture(t, db, columns)
	now := func() time.Time { return time.Now().UTC() }
	svc, err := NewDatabaseRecordService(
		repo.NewModuleRepository(db, database.RandomIDs{}, now),
		repo.NewModuleResourceInstanceRepository(db),
		columnsFixture.records,
		workers.NewEventPublisher(repo.NewDbEventRepository(db), slog.New(slog.DiscardHandler)),
		limits,
	)
	if err != nil {
		t.Fatalf("NewDatabaseRecordService: %v", err)
	}
	return &recordFixture{svc: svc, db: db, columns: columnsFixture}
}

func (f *recordFixture) create(t *testing.T, values map[string]string, key *string) *client.CreateDatabaseRecordResponse {
	t.Helper()
	resp, err := f.svc.CreateDatabaseRecord(context.Background(), &client.CreateDatabaseRecordRequest{
		DatabaseId: fixtureDatabaseID,
		Values:     &client.CreateDatabaseRecordRequest_TextValues{TextValues: &client.DatabaseTextValues{Values: values}},
		InsertKey:  key,
	})
	if err != nil {
		t.Fatalf("CreateDatabaseRecord: %v", err)
	}
	return resp
}

// changeEvents decodes the queued database.record.changed events by op.
func (f *recordFixture) changeEvents(t *testing.T) map[string][]map[string]any {
	t.Helper()
	var rows []models.WorkerEvent
	if err := f.db.Where("event_type = ?", "database.record.changed").Find(&rows).Error; err != nil {
		t.Fatalf("read events: %v", err)
	}
	byOp := map[string][]map[string]any{}
	for _, row := range rows {
		var data map[string]any
		if err := json.Unmarshal([]byte(row.Payload), &data); err != nil {
			t.Fatalf("decode event: %v", err)
		}
		op, _ := data["op"].(string)
		byOp[op] = append(byOp[op], data)
	}
	return byOp
}

const recordColumns = `[{"id":"game","label":"Game","type":"text","public":true},{"id":"viewer","label":"Viewer","type":"text"},{"id":"score","label":"Score","type":"number","public":true}]`

func decodeRecordValues(t *testing.T, record *client.DatabaseRecord) map[string]any {
	t.Helper()
	values := map[string]any{}
	if err := json.Unmarshal([]byte(record.ValuesJson), &values); err != nil {
		t.Fatalf("decode values: %v", err)
	}
	return values
}

func TestDatabaseRecordCreateUpdateDeleteOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newRecordFixture(t, db, recordColumns, DefaultDatabaseLimits())
		ctx := context.Background()
		key := "submission-1"

		created := f.create(t, map[string]string{"game": "Celeste", "viewer": "wolfy", "score": "12"}, &key)
		if created.Outcome != client.CreateDatabaseRecordOutcome_CREATE_DATABASE_RECORD_OUTCOME_CREATED {
			t.Fatalf("outcome = %s, want CREATED", created.Outcome)
		}
		if values := decodeRecordValues(t, created.Record); values["score"] != 12.0 || values["viewer"] != "wolfy" {
			t.Fatalf("stored values = %v", values)
		}
		repeat := f.create(t, map[string]string{"game": "Hades"}, &key)
		if repeat.Outcome != client.CreateDatabaseRecordOutcome_CREATE_DATABASE_RECORD_OUTCOME_DUPLICATE || repeat.Record.Id != created.Record.Id {
			t.Fatalf("repeat = %s %s, want DUPLICATE of %s", repeat.Outcome, repeat.Record.GetId(), created.Record.Id)
		}

		updated, err := f.svc.UpdateDatabaseRecord(ctx, &client.UpdateDatabaseRecordRequest{
			DatabaseId: fixtureDatabaseID, RecordId: created.Record.Id,
			Values: &client.UpdateDatabaseRecordRequest_TypedValuesJson{TypedValuesJson: `{"score":null,"game":"Celeste B-Sides"}`},
		})
		if err != nil || !updated.Updated || updated.Record.Revision != 2 {
			t.Fatalf("UpdateDatabaseRecord = %v, %v", updated, err)
		}
		stale := int64(1)
		_, err = f.svc.UpdateDatabaseRecord(ctx, &client.UpdateDatabaseRecordRequest{
			DatabaseId: fixtureDatabaseID, RecordId: created.Record.Id, ExpectedRevision: &stale,
			Values: &client.UpdateDatabaseRecordRequest_TypedValuesJson{TypedValuesJson: `{"game":"x"}`},
		})
		if terr, ok := err.(twirp.Error); !ok || terr.Code() != twirp.Aborted {
			t.Fatalf("stale update error = %v, want aborted", err)
		}
		missing, err := f.svc.UpdateDatabaseRecord(ctx, &client.UpdateDatabaseRecordRequest{
			DatabaseId: fixtureDatabaseID, RecordId: "00000000-0000-4000-8000-000000000000",
			Values: &client.UpdateDatabaseRecordRequest_TypedValuesJson{TypedValuesJson: `{}`},
		})
		if err != nil || missing.Updated {
			t.Fatalf("update of a missing record = %v, %v; want updated false", missing, err)
		}

		deleted, err := f.svc.DeleteDatabaseRecord(ctx, &client.DeleteDatabaseRecordRequest{DatabaseId: fixtureDatabaseID, RecordId: created.Record.Id})
		if err != nil || !deleted.Deleted {
			t.Fatalf("DeleteDatabaseRecord = %v, %v", deleted, err)
		}

		events := f.changeEvents(t)
		if len(events["created"]) != 1 || len(events["updated"]) != 1 || len(events["deleted"]) != 1 {
			t.Fatalf("events = %v, want one per change and none for the duplicate", events)
		}
		createdEvent := events["created"][0]
		public, _ := createdEvent["publicValues"].(map[string]any)
		if public["game"] != "Celeste" || public["score"] != 12.0 {
			t.Fatalf("created event public values = %v", public)
		}
		if _, leaked := public["viewer"]; leaked {
			t.Fatal("the change event carries a private column")
		}
		if createdEvent["databaseId"] != fixtureDatabaseID || createdEvent["recordId"] != created.Record.Id || createdEvent["revision"] != 1.0 {
			t.Fatalf("created event = %v", createdEvent)
		}
		if deletedEvent := events["deleted"][0]; deletedEvent["publicValues"] != nil || deletedEvent["revision"] != 3.0 {
			t.Fatalf("deleted event = %v, want null values at revision 3", deletedEvent)
		}
	})
}

func TestDatabaseRecordCreateStopsAtTheLimitOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		limits := DefaultDatabaseLimits()
		limits.MaxRecords = 2
		f := newRecordFixture(t, db, recordColumns, limits)
		first := "a"
		f.create(t, map[string]string{"game": "A"}, &first)
		f.create(t, map[string]string{"game": "B"}, nil)
		full := f.create(t, map[string]string{"game": "C"}, nil)
		if full.Outcome != client.CreateDatabaseRecordOutcome_CREATE_DATABASE_RECORD_OUTCOME_FULL || full.Record != nil {
			t.Fatalf("outcome = %s, want FULL with no record", full.Outcome)
		}
		repeat := f.create(t, map[string]string{"game": "A"}, &first)
		if repeat.Outcome != client.CreateDatabaseRecordOutcome_CREATE_DATABASE_RECORD_OUTCOME_DUPLICATE {
			t.Fatalf("repeat into a full database = %s, want DUPLICATE", repeat.Outcome)
		}
	})
}

func TestDatabaseRecordReadsOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newRecordFixture(t, db, recordColumns, DefaultDatabaseLimits())
		ctx := context.Background()
		low := f.create(t, map[string]string{"game": "Celeste", "viewer": "a", "score": "3"}, nil)
		high := f.create(t, map[string]string{"game": "Celeste", "viewer": "b", "score": "30"}, nil)

		list, err := f.svc.ListDatabaseRecords(ctx, &client.ListDatabaseRecordsRequest{DatabaseId: fixtureDatabaseID, SortBy: "score", Descending: true, Limit: 10})
		if err != nil || list.Total != 2 || list.Records[0].Id != high.Record.Id {
			t.Fatalf("ListDatabaseRecords = %v, %v", list, err)
		}
		_, err = f.svc.ListDatabaseRecords(ctx, &client.ListDatabaseRecordsRequest{DatabaseId: fixtureDatabaseID, SortBy: "nope", Limit: 10})
		wantInvalidArgument(t, err, `no column "nope"`)
		_, err = f.svc.ListDatabaseRecords(ctx, &client.ListDatabaseRecordsRequest{DatabaseId: fixtureDatabaseID, Limit: 101})
		wantInvalidArgument(t, err, "1 to 100")

		found, err := f.svc.FindDatabaseRecord(ctx, &client.FindDatabaseRecordRequest{DatabaseId: fixtureDatabaseID, ColumnId: "game", Match: "Celeste"})
		if err != nil || !found.Found || found.Record.Id != low.Record.Id {
			t.Fatalf("FindDatabaseRecord by column = %v, %v; want the earliest", found, err)
		}
		found, err = f.svc.FindDatabaseRecord(ctx, &client.FindDatabaseRecordRequest{DatabaseId: fixtureDatabaseID, ColumnId: "score", Match: "30"})
		if err != nil || !found.Found || found.Record.Id != high.Record.Id {
			t.Fatalf("FindDatabaseRecord by number = %v, %v", found, err)
		}
		found, err = f.svc.FindDatabaseRecord(ctx, &client.FindDatabaseRecordRequest{DatabaseId: fixtureDatabaseID, Match: high.Record.Id})
		if err != nil || !found.Found {
			t.Fatalf("FindDatabaseRecord by id = %v, %v", found, err)
		}
		found, err = f.svc.FindDatabaseRecord(ctx, &client.FindDatabaseRecordRequest{DatabaseId: fixtureDatabaseID, Match: "not-an-id"})
		if err != nil || found.Found {
			t.Fatalf("FindDatabaseRecord by a bad id = %v, %v; want not found", found, err)
		}

		public, err := f.svc.ListPublicDatabaseRecords(ctx, &client.ListPublicDatabaseRecordsRequest{DatabaseId: fixtureDatabaseID, Limit: 10})
		if err != nil || public.Total != 2 || public.Records[0].Id != high.Record.Id {
			t.Fatalf("ListPublicDatabaseRecords = %v, %v; want newest first", public, err)
		}
		for _, record := range public.Records {
			if _, leaked := decodeRecordValues(t, record)["viewer"]; leaked {
				t.Fatal("the public listing carries a private column")
			}
		}
	})
}

func TestDatabaseRecordServiceRefusesAnotherKindOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newRecordFixture(t, db, recordColumns, DefaultDatabaseLimits())
		if _, err := f.columns.svc.CreateResourceInstance(context.Background(), &client.CreateResourceInstanceRequest{
			ModuleName: "woofx3", Kind: "queue", InstanceId: "songs", DisplayName: "Songs",
		}); err != nil {
			t.Fatalf("CreateResourceInstance: %v", err)
		}
		_, err := f.svc.ListDatabaseRecords(context.Background(), &client.ListDatabaseRecordsRequest{DatabaseId: "woofx3:queue:songs", Limit: 10})
		wantInvalidArgument(t, err, "is not a database")
	})
}
