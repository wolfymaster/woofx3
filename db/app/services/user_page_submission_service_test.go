package services

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/dbtest"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

const formSubmittedSubject = "userpage.form.submitted"

func newSubmissionSvc(db *gorm.DB) client.UserPageSubmissionService {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return NewUserPageSubmissionService(
		repo.NewUserPageSubmissionRepository(db),
		workers.NewEventPublisher(repo.NewDbEventRepository(db), logger),
	)
}

func textField(id, value string) *client.UserPageSubmissionField {
	return &client.UserPageSubmissionField{
		Id: id, Label: "Label", Type: "text",
		Value: &client.UserPageSubmissionField_TextValue{TextValue: value},
	}
}

func submissionRequest(id string) *client.RecordUserPageSubmissionRequest {
	return &client.RecordUserPageSubmissionRequest{
		SubmissionId: id,
		PageId:       "page-1",
		FormId:       "form-1",
		SubmittedAt:  timestamppb.New(time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)),
		Viewer: &client.UserPageViewer{
			Platform: "twitch", PlatformUserId: "42", DisplayName: "Wolfy", Roles: []string{"moderator"},
		},
		Fields: []*client.UserPageSubmissionField{
			textField("song", "Never gonna"),
			{
				Id: "agree", Label: "Agree", Type: "checkbox",
				Value: &client.UserPageSubmissionField_CheckedValue{CheckedValue: false},
			},
		},
	}
}

func submittedEvents(t *testing.T, db *gorm.DB) []models.WorkerEvent {
	t.Helper()
	var events []models.WorkerEvent
	if err := db.Where("nats_subject = ?", formSubmittedSubject).Find(&events).Error; err != nil {
		t.Fatalf("read outbox: %v", err)
	}
	return events
}

func countSubmissions(t *testing.T, db *gorm.DB) int64 {
	t.Helper()
	var count int64
	if err := db.Model(&models.UserPageSubmission{}).Count(&count).Error; err != nil {
		t.Fatalf("count submissions: %v", err)
	}
	return count
}

func TestRecordUserPageSubmission_WritesRowAndEvent(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		resp, err := newSubmissionSvc(db).RecordUserPageSubmission(context.Background(), submissionRequest("sub-1"))
		if err != nil {
			t.Fatalf("record: %v", err)
		}
		if !resp.Created {
			t.Fatalf("Created = false, want true")
		}
		if got := countSubmissions(t, db); got != 1 {
			t.Fatalf("%d submissions, want 1", got)
		}

		events := submittedEvents(t, db)
		if len(events) != 1 {
			t.Fatalf("%d events, want 1", len(events))
		}
		event := events[0]
		if event.EventType != formSubmittedSubject || event.EntityID != "sub-1" {
			t.Fatalf("event type %q, entity %q", event.EventType, event.EntityID)
		}
		if event.Extensions == nil || !strings.Contains(*event.Extensions, `"twitch"`) {
			t.Fatalf("extensions = %v, want the viewer's platform", event.Extensions)
		}

		var data map[string]any
		if err := json.Unmarshal([]byte(event.Payload), &data); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if data["formId"] != "form-1" || data["submittedAt"] != "2026-10-31T12:00:00Z" {
			t.Fatalf("data = %v", data)
		}
		answers := data["answers"].(map[string]any)
		if answers["song"] != "Never gonna" || answers["agree"] != false {
			t.Fatalf("answers = %v", answers)
		}
		fields := data["fields"].([]any)
		if len(fields) != 2 || fields[1].(map[string]any)["value"] != false {
			t.Fatalf("fields = %v", fields)
		}
		if data["viewer"].(map[string]any)["platformUserId"] != "42" {
			t.Fatalf("viewer = %v", data["viewer"])
		}
	})
}

func TestRecordUserPageSubmission_AnonymousEmptyFormHasNullViewerAndEmptyCollections(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		req := submissionRequest("sub-anon")
		req.Viewer = nil
		req.Fields = nil
		if _, err := newSubmissionSvc(db).RecordUserPageSubmission(context.Background(), req); err != nil {
			t.Fatalf("record: %v", err)
		}
		event := submittedEvents(t, db)[0]
		if event.Extensions != nil {
			t.Fatalf("extensions = %v, want none without a viewer", *event.Extensions)
		}
		var data map[string]any
		if err := json.Unmarshal([]byte(event.Payload), &data); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		viewer, present := data["viewer"]
		if !present || viewer != nil {
			t.Fatalf("viewer = %v (present %v), want null", viewer, present)
		}
		if fields, ok := data["fields"].([]any); !ok || len(fields) != 0 {
			t.Fatalf("fields = %v, want []", data["fields"])
		}
		if answers, ok := data["answers"].(map[string]any); !ok || len(answers) != 0 {
			t.Fatalf("answers = %v, want {}", data["answers"])
		}
	})
}

func TestRecordUserPageSubmission_RepeatEmitsNoSecondEvent(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		svc := newSubmissionSvc(db)
		if _, err := svc.RecordUserPageSubmission(context.Background(), submissionRequest("sub-1")); err != nil {
			t.Fatalf("first record: %v", err)
		}
		repeat := submissionRequest("sub-1")
		repeat.Fields = []*client.UserPageSubmissionField{textField("song", "Something else")}
		resp, err := svc.RecordUserPageSubmission(context.Background(), repeat)
		if err != nil {
			t.Fatalf("repeat: %v", err)
		}
		if resp.Created {
			t.Fatalf("Created = true on a repeat")
		}
		if got := countSubmissions(t, db); got != 1 {
			t.Fatalf("%d submissions, want 1", got)
		}
		events := submittedEvents(t, db)
		if len(events) != 1 {
			t.Fatalf("%d events, want 1", len(events))
		}
		if !strings.Contains(events[0].Payload, "Never gonna") {
			t.Fatalf("the repeat replaced the first submission's payload")
		}
	})
}

// A failed event write must take the submission row with it, or the resend
// would be answered `duplicate` and its workflows would never run.
func TestRecordUserPageSubmission_FailedEventWriteRecordsNothing(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		svc := newSubmissionSvc(db)
		if err := db.Exec(`ALTER TABLE worker_events RENAME TO worker_events_away`).Error; err != nil {
			t.Fatalf("hide outbox: %v", err)
		}
		_, err := svc.RecordUserPageSubmission(context.Background(), submissionRequest("sub-1"))
		var twerr twirp.Error
		if !errors.As(err, &twerr) || twerr.Code() != twirp.Internal {
			t.Fatalf("err = %v, want an internal twirp error", err)
		}
		if got := countSubmissions(t, db); got != 0 {
			t.Fatalf("%d submissions after the failure, want 0", got)
		}

		if err := db.Exec(`ALTER TABLE worker_events_away RENAME TO worker_events`).Error; err != nil {
			t.Fatalf("restore outbox: %v", err)
		}
		resp, err := svc.RecordUserPageSubmission(context.Background(), submissionRequest("sub-1"))
		if err != nil {
			t.Fatalf("resend: %v", err)
		}
		if !resp.Created || len(submittedEvents(t, db)) != 1 {
			t.Fatalf("resend: created %v, %d events", resp.Created, len(submittedEvents(t, db)))
		}
	})
}

func TestRecordUserPageSubmission_RefusesMalformed(t *testing.T) {
	cases := []struct {
		name   string
		change func(req *client.RecordUserPageSubmissionRequest)
	}{
		{"no submission id", func(r *client.RecordUserPageSubmissionRequest) { r.SubmissionId = "" }},
		{"no page id", func(r *client.RecordUserPageSubmissionRequest) { r.PageId = "" }},
		{"no form id", func(r *client.RecordUserPageSubmissionRequest) { r.FormId = "" }},
		{"no time", func(r *client.RecordUserPageSubmissionRequest) { r.SubmittedAt = nil }},
		{"viewer without an id", func(r *client.RecordUserPageSubmissionRequest) { r.Viewer.PlatformUserId = "" }},
		{"NUL in a viewer name", func(r *client.RecordUserPageSubmissionRequest) { r.Viewer.DisplayName = "a\x00" }},
		{"NUL in a value", func(r *client.RecordUserPageSubmissionRequest) { r.Fields[0] = textField("song", "a\x00b") }},
		{"long value", func(r *client.RecordUserPageSubmissionRequest) {
			r.Fields[0] = textField("song", strings.Repeat("x", maxSubmissionValueLength+1))
		}},
		{"field id with a dot", func(r *client.RecordUserPageSubmissionRequest) { r.Fields[0] = textField("a.b", "x") }},
		{"repeated field id", func(r *client.RecordUserPageSubmissionRequest) { r.Fields[1] = textField("song", "x") }},
		{"no value", func(r *client.RecordUserPageSubmissionRequest) { r.Fields[0].Value = nil }},
		{"unknown type", func(r *client.RecordUserPageSubmissionRequest) { r.Fields[0].Type = "file" }},
		{"text value on a checkbox", func(r *client.RecordUserPageSubmissionRequest) { r.Fields[0].Type = "checkbox" }},
		{"boolean value on a text field", func(r *client.RecordUserPageSubmissionRequest) { r.Fields[1].Type = "text" }},
		{"too many fields", func(r *client.RecordUserPageSubmissionRequest) {
			r.Fields = nil
			for i := 0; i <= maxSubmissionFields; i++ {
				r.Fields = append(r.Fields, textField("f"+strings.Repeat("x", i), ""))
			}
		}},
	}
	db := dbtest.OpenSQLite(t)
	svc := newSubmissionSvc(db)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := submissionRequest("sub-1")
			tc.change(req)
			_, err := svc.RecordUserPageSubmission(context.Background(), req)
			var twerr twirp.Error
			if !errors.As(err, &twerr) {
				t.Fatalf("err = %v, want a twirp error", err)
			}
			if twerr.Code() != twirp.InvalidArgument {
				t.Fatalf("code = %s, want invalid_argument", twerr.Code())
			}
			if got := countSubmissions(t, db); got != 0 {
				t.Fatalf("%d submissions, want 0", got)
			}
		})
	}
}
