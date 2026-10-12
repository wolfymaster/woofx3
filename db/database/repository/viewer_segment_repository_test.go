package repository

import (
	"errors"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

func chattySegment(condition string) *models.SegmentDefinition {
	return &models.SegmentDefinition{
		ID:            "user:segment:chatty",
		Name:          "Chatty",
		Condition:     condition,
		WindowKind:    models.FactWindowLifetime,
		CreatedByType: "USER",
	}
}

// recordedWrites collects what a definition write reported to its hook.
type recordedWrites struct {
	writes []SegmentDefinitionWrite
}

func (r *recordedWrites) record(_ *gorm.DB, _ *models.SegmentDefinition, write SegmentDefinitionWrite) error {
	r.writes = append(r.writes, write)
	return nil
}

func TestSegmentDefinitionRevisesOnlyWhenTheConditionChanges(t *testing.T) {
	db := openFactDb(t)
	defineFact(t, db, "user:fact:messages", models.FactAggregateCount, models.FactWindowLifetime)
	defineFact(t, db, "user:fact:bits", models.FactAggregateCount, models.FactWindowLifetime)
	segments := NewViewerSegmentRepository(db)
	hook := &recordedWrites{}

	condition := `{"fact": "user:fact:messages", "op": "gte", "value": 10}`
	stored, write, err := segments.UpsertDefinition(chattySegment(condition), []string{"user:fact:messages"}, hook.record)
	if err != nil || write != SegmentDefinitionCreated || stored.Revision != 1 {
		t.Fatalf("create = %+v, %v, %v", stored, write, err)
	}

	// The same condition spelled differently is the same condition.
	_, write, err = segments.UpsertDefinition(chattySegment(`{"op":"gte","value":10,"fact":"user:fact:messages"}`), []string{"user:fact:messages"}, hook.record)
	if err != nil || write != SegmentDefinitionUnchanged {
		t.Fatalf("identical save = %v, %v", write, err)
	}

	renamed := chattySegment(condition)
	renamed.Name = "Very chatty"
	stored, write, err = segments.UpsertDefinition(renamed, []string{"user:fact:messages"}, hook.record)
	if err != nil || write != SegmentDefinitionRenamed || stored.Revision != 1 {
		t.Fatalf("rename = %+v, %v, %v", stored, write, err)
	}

	revised := chattySegment(`{"all": [{"fact": "user:fact:messages", "op": "gte", "value": 10}, {"fact": "user:fact:bits", "op": "gt", "value": 0}]}`)
	stored, write, err = segments.UpsertDefinition(revised, []string{"user:fact:messages", "user:fact:bits", "user:fact:bits"}, hook.record)
	if err != nil || write != SegmentDefinitionRevised || stored.Revision != 2 {
		t.Fatalf("revise = %+v, %v, %v", stored, write, err)
	}
	read, err := segments.FactsRead([]string{"user:segment:chatty"})
	if err != nil {
		t.Fatalf("FactsRead: %v", err)
	}
	if want := []string{"user:fact:bits", "user:fact:messages"}; !slices.Equal(read["user:segment:chatty"], want) {
		t.Fatalf("facts read = %v, want %v", read["user:segment:chatty"], want)
	}
	if want := []SegmentDefinitionWrite{SegmentDefinitionCreated, SegmentDefinitionRenamed, SegmentDefinitionRevised}; !slices.Equal(hook.writes, want) {
		t.Fatalf("recorded writes = %v, want %v", hook.writes, want)
	}

	module := chattySegment(condition)
	module.CreatedByType = "MODULE"
	module.CreatedByRef = "twitch"
	if _, _, err := segments.UpsertDefinition(module, []string{"user:fact:messages"}, hook.record); !errors.Is(err, ErrSegmentDefinitionOwned) {
		t.Fatalf("save over another creator's id: %v, want ErrSegmentDefinitionOwned", err)
	}
}

func TestSegmentDefinitionWriteRollsBackWithItsHook(t *testing.T) {
	db := openFactDb(t)
	defineFact(t, db, "user:fact:messages", models.FactAggregateCount, models.FactWindowLifetime)
	segments := NewViewerSegmentRepository(db)
	failing := func(*gorm.DB, *models.SegmentDefinition, SegmentDefinitionWrite) error {
		return errors.New("outbox down")
	}
	if _, _, err := segments.UpsertDefinition(chattySegment(`{"fact": "user:fact:messages", "op": "exists"}`), []string{"user:fact:messages"}, failing); err == nil {
		t.Fatal("a failing hook did not fail the save")
	}
	if _, err := segments.GetDefinition("user:segment:chatty"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("definition after a failed save: %v, want not found", err)
	}
}

func TestDependentSegmentsAreThoseReadingAChangedFact(t *testing.T) {
	db := openFactDb(t)
	defineFact(t, db, "user:fact:messages", models.FactAggregateCount, models.FactWindowLifetime)
	defineFact(t, db, "user:fact:bits", models.FactAggregateCount, models.FactWindowLifetime)
	defineFact(t, db, "user:fact:raids", models.FactAggregateCount, models.FactWindowLifetime)
	segments := NewViewerSegmentRepository(db)
	hook := &recordedWrites{}
	for id, facts := range map[string][]string{
		"user:segment:chatty":  {"user:fact:messages"},
		"user:segment:cheerer": {"user:fact:bits", "user:fact:messages"},
		"user:segment:raider":  {"user:fact:raids"},
	} {
		definition := chattySegment(`{"fact": "` + facts[0] + `", "op": "exists"}`)
		definition.ID = id
		if _, _, err := segments.UpsertDefinition(definition, facts, hook.record); err != nil {
			t.Fatalf("define %s: %v", id, err)
		}
	}

	found, err := segments.DependentSegments([]string{"user:fact:messages", "user:fact:bits"})
	if err != nil {
		t.Fatalf("DependentSegments: %v", err)
	}
	ids := make([]string, len(found))
	for i, segment := range found {
		ids[i] = segment.ID
	}
	if want := []string{"user:segment:chatty", "user:segment:cheerer"}; !slices.Equal(ids, want) {
		t.Fatalf("dependents = %v, want %v", ids, want)
	}
	locked, err := segments.DependentSegmentsForUpdate([]string{"user:fact:bits"})
	if err != nil || len(locked) != 1 || locked[0].ID != "user:segment:cheerer" {
		t.Fatalf("DependentSegmentsForUpdate = %v, %v", locked, err)
	}
	reading, err := segments.SegmentIDsReading("user:fact:raids")
	if err != nil || !slices.Equal(reading, []string{"user:segment:raider"}) {
		t.Fatalf("SegmentIDsReading = %v, %v", reading, err)
	}

	if err := segments.DeleteDefinition("user:segment:raider", hook.record); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if err := segments.DeleteDefinition("user:segment:raider", hook.record); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("delete again: %v, want not found", err)
	}
	if hook.writes[len(hook.writes)-1] != SegmentDefinitionDeleted {
		t.Fatalf("last recorded write = %v, want deleted", hook.writes[len(hook.writes)-1])
	}
}

func TestSegmentMembershipMovesBetweenWindows(t *testing.T) {
	db := openFactDb(t)
	defineFact(t, db, "user:fact:messages", models.FactAggregateCount, models.FactWindowSession)
	segments := NewViewerSegmentRepository(db)
	definition := chattySegment(`{"fact": "user:fact:messages", "op": "gte", "value": 3}`)
	definition.WindowKind = models.FactWindowSession
	if _, _, err := segments.UpsertDefinition(definition, []string{"user:fact:messages"}, (&recordedWrites{}).record); err != nil {
		t.Fatalf("define: %v", err)
	}
	viewer := ViewerKey{Platform: "twitch", SubjectID: "v1"}
	member := func(window string, at time.Time) models.SegmentMember {
		return models.SegmentMember{SegmentID: definition.ID, Platform: viewer.Platform, SubjectID: viewer.SubjectID, WindowKey: window, EnteredAt: at}
	}

	if wrote, err := segments.Enter(member("s1", factEpoch)); err != nil || !wrote {
		t.Fatalf("first enter = %v, %v", wrote, err)
	}
	if wrote, err := segments.Enter(member("s1", factEpoch.Add(time.Minute))); err != nil || wrote {
		t.Fatalf("enter again in the same window = %v, %v; want no write", wrote, err)
	}
	if wrote, err := segments.Enter(member("s2", factEpoch.Add(time.Hour))); err != nil || !wrote {
		t.Fatalf("enter in the next window = %v, %v", wrote, err)
	}
	rows, err := segments.ViewerMemberships(viewer)
	if err != nil {
		t.Fatalf("ViewerMemberships: %v", err)
	}
	if len(rows) != 1 || rows[0].WindowKey != "s2" || !rows[0].EnteredAt.Equal(factEpoch.Add(time.Hour)) || rows[0].WindowKind != models.FactWindowSession {
		t.Fatalf("memberships = %+v, want one in s2 entered an hour in", rows)
	}

	if left, err := segments.Leave(definition.ID, viewer); err != nil || !left {
		t.Fatalf("leave = %v, %v", left, err)
	}
	if left, err := segments.Leave(definition.ID, viewer); err != nil || left {
		t.Fatalf("leave again = %v, %v; want nothing to delete", left, err)
	}

	many := make([]models.SegmentMember, 1200)
	keys := make([]ViewerKey, len(many))
	for i := range many {
		keys[i] = ViewerKey{Platform: "twitch", SubjectID: fmt.Sprintf("bulk-%d", i)}
		many[i] = models.SegmentMember{SegmentID: definition.ID, Platform: "twitch", SubjectID: keys[i].SubjectID, WindowKey: "s2", EnteredAt: factEpoch}
	}
	if err := segments.EnterAll(many); err != nil {
		t.Fatalf("EnterAll: %v", err)
	}
	if err := segments.EnterAll(many); err != nil {
		t.Fatalf("EnterAll again: %v", err)
	}
	members, err := segments.Members(definition.ID)
	if err != nil || len(members) != len(many) {
		t.Fatalf("members = %d, %v; want %d", len(members), err, len(many))
	}
	if err := segments.LeaveAll(definition.ID, keys[:1100]); err != nil {
		t.Fatalf("LeaveAll: %v", err)
	}
	if members, _ := segments.Members(definition.ID); len(members) != 100 {
		t.Fatalf("members after LeaveAll = %d, want 100", len(members))
	}
	if err := segments.LockViewer(viewer); err != nil {
		t.Fatalf("LockViewer: %v", err)
	}
}

func TestSegmentFactValuesReadTheLifetimeAndCurrentSessionWindows(t *testing.T) {
	db := openFactDb(t)
	defineFact(t, db, "user:fact:messages", models.FactAggregateCount, models.FactWindowLifetime)
	defineFact(t, db, "user:fact:session_messages", models.FactAggregateCount, models.FactWindowSession)
	facts := NewViewerFactRepository(db)
	mustApply(t, facts, FactBatch{Source: "twitch", EventID: "e1", OccurredAt: factEpoch, SessionStamp: "s1", Deltas: []FactDelta{
		countDelta("user:fact:messages", "v1"), countDelta("user:fact:session_messages", "v1"), countDelta("user:fact:messages", "v2"),
	}})
	mustApply(t, facts, FactBatch{Source: "twitch", EventID: "e2", OccurredAt: factEpoch, SessionStamp: "s2", Deltas: []FactDelta{
		countDelta("user:fact:session_messages", "v1"),
	}})

	segments := NewViewerSegmentRepository(db)
	ids := []string{"user:fact:messages", "user:fact:session_messages"}
	one, err := segments.FactValues(ids, "s1", &ViewerKey{Platform: "twitch", SubjectID: "v1"})
	if err != nil {
		t.Fatalf("FactValues(v1): %v", err)
	}
	if len(one) != 2 || one[0].FactID != "user:fact:messages" || one[1].WindowKey != "s1" {
		t.Fatalf("v1's values in s1 = %+v", one)
	}
	all, err := segments.FactValues(ids, "", nil)
	if err != nil {
		t.Fatalf("FactValues(all): %v", err)
	}
	if len(all) != 2 || all[0].SubjectID != "v1" || all[1].SubjectID != "v2" {
		t.Fatalf("lifetime values = %+v, want one each for v1 and v2", all)
	}

	kinds, err := segments.FactDefinitions(ids)
	if err != nil || kinds["user:fact:session_messages"].WindowKind != models.FactWindowSession {
		t.Fatalf("FactDefinitions = %+v, %v", kinds, err)
	}
}

func TestViewerLockKeyIsStablePerViewer(t *testing.T) {
	a := ViewerLockKey(ViewerKey{Platform: "twitch", SubjectID: "v1"})
	if a != ViewerLockKey(ViewerKey{Platform: "twitch", SubjectID: "v1"}) {
		t.Fatal("one viewer got two lock keys")
	}
	if a == ViewerLockKey(ViewerKey{Platform: "twitch", SubjectID: "v2"}) ||
		a == ViewerLockKey(ViewerKey{Platform: "youtube", SubjectID: "v1"}) {
		t.Fatal("two viewers share a lock key")
	}
}
