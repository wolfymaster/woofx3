package services

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/common/cloudevents"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

// Limits of one submission. Must match SUBMISSION_LIMITS in
// api/src/routes/user-pages.ts. A length counts code points, so a value within
// the api's limit, which counts UTF-16 units, is always within this one.
const (
	maxSubmissionIDLength      = 255
	maxSubmissionTextLength    = 255
	maxSubmissionFields        = 20
	maxSubmissionValueLength   = 5000
	maxSubmissionPlatform      = 50
	maxSubmissionPlatformUser  = 100
	maxSubmissionRoles         = 50
	submissionFieldTypeChecked = "checkbox"
)

// anonymousViewerName is the display name published for a viewer who was not
// signed in, so a workflow can show `viewer.displayName` without a fallback.
// It says nothing about identity: a signed-in viewer can have this name too.
const anonymousViewerName = "anonymous"

// Field ids become keys of the event's `answers`, so they are limited to what
// a `${trigger.data.answers.<id>}` path can name.
var submissionFieldIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

var submissionTextFieldTypes = map[string]bool{"text": true, "textarea": true, "select": true}

// userPageSubmissionService implements `client.UserPageSubmissionService`.
//
// Nothing here logs a submission's content: answers are viewer-written text
// and the viewer's identity is personal data, so only ids may reach a log.
type userPageSubmissionService struct {
	repo      *repo.UserPageSubmissionRepository
	publisher *workers.EventPublisher
	now       func() time.Time
}

func NewUserPageSubmissionService(
	submissions *repo.UserPageSubmissionRepository,
	publisher *workers.EventPublisher,
) client.UserPageSubmissionService {
	return &userPageSubmissionService{
		repo:      submissions,
		publisher: publisher,
		now:       func() time.Time { return time.Now().UTC() },
	}
}

// userPageFormSubmittedEvent is the data of userpage.form.submitted.
// Must match the emits of the `userpage_form_submitted` trigger in
// modules/woofx3/manifest.json.
type userPageFormSubmittedEvent struct {
	SubmissionID string               `json:"submissionId"`
	PageID       string               `json:"pageId"`
	FormID       string               `json:"formId"`
	FormTitle    string               `json:"formTitle"`
	SubmittedAt  string               `json:"submittedAt"`
	Viewer       *userPageEventViewer `json:"viewer"`
	Fields       []userPageEventField `json:"fields"`
	// Answers holds each field's value under its id, since a workflow path can
	// index `fields` by position but cannot find an entry by id.
	Answers map[string]any `json:"answers"`
}

type userPageEventViewer struct {
	// Platform and PlatformUserID are null for an anonymous viewer, which is
	// what keeps the event from naming a viewer to `${viewer.*}` and viewer facts.
	Platform       *string  `json:"platform"`
	PlatformUserID *string  `json:"platformUserId"`
	DisplayName    string   `json:"displayName"`
	Roles          []string `json:"roles"`
}

type userPageEventField struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Type  string `json:"type"`
	Value any    `json:"value"`
}

func (s *userPageSubmissionService) RecordUserPageSubmission(ctx context.Context, req *client.RecordUserPageSubmissionRequest) (*client.RecordUserPageSubmissionResponse, error) {
	if err := validateUserPageSubmission(req); err != nil {
		return nil, err
	}

	event := userPageFormSubmittedEventOf(req)
	payload, err := json.Marshal(event)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("encode submission %s: %w", req.SubmissionId, err))
	}

	// The workflow service reads an event's platform only from this extension.
	var extensions map[string]string
	if req.Viewer != nil {
		extensions = map[string]string{"platform": req.Viewer.Platform}
	}

	created, err := s.repo.Record(&models.UserPageSubmission{
		SubmissionID: req.SubmissionId,
		PageID:       req.PageId,
		FormID:       req.FormId,
		Payload:      string(payload),
		SubmittedAt:  req.SubmittedAt.AsTime().UTC(),
		RecordedAt:   s.now(),
	}, func(tx *gorm.DB) error {
		return s.publisher.PublishEventIn(tx, string(cloudevents.SubjectUserPageFormSubmitted), req.SubmissionId, extensions, event)
	})
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("record submission %s: %w", req.SubmissionId, err))
	}

	message := "Submission recorded"
	if !created {
		message = "Submission already recorded"
	}
	return &client.RecordUserPageSubmissionResponse{
		Status:  &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: message},
		Created: created,
	}, nil
}

func userPageFormSubmittedEventOf(req *client.RecordUserPageSubmissionRequest) userPageFormSubmittedEvent {
	event := userPageFormSubmittedEvent{
		SubmissionID: req.SubmissionId,
		PageID:       req.PageId,
		FormID:       req.FormId,
		FormTitle:    req.GetFormTitle(),
		SubmittedAt:  req.SubmittedAt.AsTime().UTC().Format(time.RFC3339Nano),
		Fields:       make([]userPageEventField, 0, len(req.Fields)),
		Answers:      make(map[string]any, len(req.Fields)),
		Viewer:       &userPageEventViewer{DisplayName: anonymousViewerName, Roles: []string{}},
	}
	if viewer := req.Viewer; viewer != nil {
		roles := viewer.Roles
		if roles == nil {
			roles = []string{}
		}
		event.Viewer = &userPageEventViewer{
			Platform:       &viewer.Platform,
			PlatformUserID: &viewer.PlatformUserId,
			DisplayName:    viewer.DisplayName,
			Roles:          roles,
		}
	}
	for _, field := range req.Fields {
		var value any
		if field.Type == submissionFieldTypeChecked {
			value = field.GetCheckedValue()
		} else {
			value = field.GetTextValue()
		}
		event.Fields = append(event.Fields, userPageEventField{ID: field.Id, Label: field.Label, Type: field.Type, Value: value})
		event.Answers[field.Id] = value
	}
	return event
}

// validateUserPageSubmission refuses what a retry cannot fix. A value is named
// by its field and never quoted: the error crosses into the api's logs. NUL is
// refused everywhere since neither a Postgres text column nor JSONB can hold it,
// and storing it would otherwise fail like a transient error, forever.
func validateUserPageSubmission(req *client.RecordUserPageSubmissionRequest) error {
	for _, id := range []struct {
		name  string
		value string
	}{{"submission_id", req.SubmissionId}, {"page_id", req.PageId}, {"form_id", req.FormId}} {
		if id.value == "" {
			return twirp.RequiredArgumentError(id.name)
		}
		if err := checkSubmissionText(id.name, id.value, maxSubmissionIDLength); err != nil {
			return err
		}
	}
	if err := checkSubmissionText("form_title", req.GetFormTitle(), maxSubmissionTextLength); err != nil {
		return err
	}
	if req.SubmittedAt == nil {
		return twirp.RequiredArgumentError("submitted_at")
	}
	if err := req.SubmittedAt.CheckValid(); err != nil {
		return twirp.InvalidArgumentError("submitted_at", "is not a valid time")
	}
	if err := validateUserPageViewer(req.Viewer); err != nil {
		return err
	}
	if len(req.Fields) > maxSubmissionFields {
		return twirp.InvalidArgumentError("fields", fmt.Sprintf("must hold at most %d fields", maxSubmissionFields))
	}
	seen := make(map[string]bool, len(req.Fields))
	for i, field := range req.Fields {
		if err := validateUserPageField(i, field); err != nil {
			return err
		}
		if seen[field.Id] {
			return twirp.InvalidArgumentError(fmt.Sprintf("fields[%d].id", i), "repeats another field's id")
		}
		seen[field.Id] = true
	}
	return nil
}

func validateUserPageViewer(viewer *client.UserPageViewer) error {
	if viewer == nil {
		return nil
	}
	if viewer.Platform == "" {
		return twirp.RequiredArgumentError("viewer.platform")
	}
	if viewer.PlatformUserId == "" {
		return twirp.RequiredArgumentError("viewer.platform_user_id")
	}
	if len(viewer.Roles) > maxSubmissionRoles {
		return twirp.InvalidArgumentError("viewer.roles", fmt.Sprintf("must hold at most %d roles", maxSubmissionRoles))
	}
	texts := []struct {
		name  string
		value string
		limit int
	}{
		{"viewer.platform", viewer.Platform, maxSubmissionPlatform},
		{"viewer.platform_user_id", viewer.PlatformUserId, maxSubmissionPlatformUser},
		{"viewer.display_name", viewer.DisplayName, maxSubmissionTextLength},
	}
	for _, text := range texts {
		if err := checkSubmissionText(text.name, text.value, text.limit); err != nil {
			return err
		}
	}
	for i, role := range viewer.Roles {
		if err := checkSubmissionText(fmt.Sprintf("viewer.roles[%d]", i), role, maxSubmissionTextLength); err != nil {
			return err
		}
	}
	return nil
}

func validateUserPageField(i int, field *client.UserPageSubmissionField) error {
	at := func(name string) string { return fmt.Sprintf("fields[%d].%s", i, name) }
	if field == nil {
		return twirp.RequiredArgumentError(fmt.Sprintf("fields[%d]", i))
	}
	if !submissionFieldIDPattern.MatchString(field.Id) || len(field.Id) > maxSubmissionIDLength {
		return twirp.InvalidArgumentError(at("id"), fmt.Sprintf("must be 1 to %d letters, digits, \"-\" or \"_\"", maxSubmissionIDLength))
	}
	if err := checkSubmissionText(at("label"), field.Label, maxSubmissionTextLength); err != nil {
		return err
	}
	switch value := field.Value.(type) {
	case *client.UserPageSubmissionField_CheckedValue:
		if field.Type != submissionFieldTypeChecked {
			return twirp.InvalidArgumentError(at("value"), "must be text for this field type")
		}
	case *client.UserPageSubmissionField_TextValue:
		if !submissionTextFieldTypes[field.Type] {
			return twirp.InvalidArgumentError(at("type"), "must be text, textarea or select for a text value")
		}
		return checkSubmissionText(at("value"), value.TextValue, maxSubmissionValueLength)
	default:
		return twirp.RequiredArgumentError(at("value"))
	}
	return nil
}

func checkSubmissionText(name, value string, limit int) error {
	if strings.ContainsRune(value, 0) {
		return twirp.InvalidArgumentError(name, "must not contain a NUL character")
	}
	if utf8.RuneCountInString(value) > limit {
		return twirp.InvalidArgumentError(name, fmt.Sprintf("must be at most %d characters", limit))
	}
	return nil
}
