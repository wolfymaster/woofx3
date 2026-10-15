package services

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

// compactionFixture is aggregateFixture with its second session closed by a
// third, open one, so two sessions can be compacted and one cannot.
type compactionFixture struct {
	*aggregateFixture
	db     *gorm.DB
	repo   *repo.UserEventRepository
	third  string
	split2 time.Time
}

func newCompactionFixture(t *testing.T, db *gorm.DB) *compactionFixture {
	t.Helper()
	f := newAggregateFixture(t, db)
	split2 := f.split.Add(3*time.Hour + 250*time.Millisecond)
	_, third, err := repo.NewStreamSessionRepository(db).SplitSession(split2)
	if err != nil {
		t.Fatalf("SplitSession: %v", err)
	}
	return &compactionFixture{
		aggregateFixture: f,
		db:               db,
		repo:             repo.NewUserEventRepository(db),
		third:            third.ID.String(),
		split2:           split2,
	}
}

// seed is seedTwoSessions plus what exercises the compact rows: names that
// change across sessions and on events no total counts, a viewer whose only
// event is a follow, ties at one instant, and events in the open session.
func (f *compactionFixture) seed(t *testing.T) {
	t.Helper()
	f.seedTwoSessions(t)
	in := f.started.Add(2 * time.Hour)
	facts := []fact{
		// Two names at one instant, the viewer's last: the read shows the one
		// that sorts first.
		{eventType: models.UserEventTypeFollow, user: "4004", name: "Zed", at: in},
		{eventType: models.UserEventTypeFollow, user: "4004", name: "Amy", at: in},
		{eventType: models.UserEventTypeCheer, user: "4004", amount: 6, at: in.Add(-time.Hour)},
		{eventType: models.UserEventTypeFollow, user: "4001", name: "Zed", at: in},
		{eventType: models.UserEventTypeCheer, user: "4001", amount: 5, at: in.Add(-time.Minute)},
		// Bob renames himself on an event no total counts, after his last cheer.
		{eventType: "channelpoints.redeem", user: "1002", name: "Robert", amount: 10, at: in.Add(time.Minute)},
		// A cheer with no amount still counts as a cheer.
		{eventType: models.UserEventTypeCheer, user: "1002", at: in.Add(2 * time.Minute)},
		// A self-paid sub and a gifted one from a named viewer.
		{eventType: models.UserEventTypeSubscribe, user: "4002", name: "Sam", value: `{"isGift":false}`, at: in},
		{eventType: models.UserEventTypeSubscribe, user: "4003", name: "Gia", value: `{"isGift":true}`, at: in},
		// The second session's last instant before the next split.
		{eventType: models.UserEventTypeCheer, user: "4001", name: "Amy", amount: 2, at: f.split2.Add(-time.Microsecond)},
		// The open session: Alice renames again, and cheers more.
		{eventType: models.UserEventTypeCheer, user: "1001", name: "Alix", amount: 3, at: f.split2},
		{eventType: models.UserEventTypeSubscriptionGift, user: "4001", amount: 7, at: f.split2.Add(time.Hour)},
		{eventType: models.UserEventTypeRaid, user: "3001", name: "Raider", amount: 40, at: f.split2.Add(time.Hour)},
	}
	for _, e := range facts {
		f.record(t, e)
	}
}

// readEverything renders every analytics read the fixture's sessions and
// viewers have, one line per read, so two runs can be compared whole.
// Payloads are left out: a compacted timeline keeps everything but them.
func (f *compactionFixture) readEverything(t *testing.T) string {
	t.Helper()
	ctx := context.Background()
	var out []string
	add := func(label string, msg proto.Message, err error) {
		t.Helper()
		if err != nil {
			t.Fatalf("%s: %v", label, err)
		}
		out = append(out, label+" => "+msg.(fmt.Stringer).String())
	}
	sessions := []*string{nil, &f.first, &f.second, &f.third}
	viewers := []string{"1001", "1002", "2004", "2005", "3001", "4001", "4002", "4003", "4004", "9999"}
	limits := []int32{1, 2, 100}
	for _, session := range sessions {
		label := "lifetime"
		if session != nil {
			label = *session

			totals, err := f.svc.GetStreamSessionEventTotals(ctx, &client.GetStreamSessionEventTotalsRequest{StreamSessionId: *session})
			add("totals "+label, totals.GetTotals(), err)

			for _, limit := range limits {
				limit := limit
				events, err := f.svc.ListStreamSessionUserEvents(ctx, &client.ListStreamSessionUserEventsRequest{
					StreamSessionId: *session, Limit: &limit,
				})
				if err != nil {
					t.Fatalf("ListStreamSessionUserEvents: %v", err)
				}
				for _, event := range events.Events {
					event.EventValue = ""
				}
				events.Status = nil
				add(fmt.Sprintf("events %s limit %d", label, limit), events, nil)
			}
		}
		for _, viewer := range viewers {
			viewerTotals, err := f.svc.GetViewerEventTotals(ctx, &client.GetViewerEventTotalsRequest{
				Platform: "twitch", PlatformUserId: viewer, StreamSessionId: session,
			})
			add("viewer "+viewer+" "+label, viewerTotals.GetTotals(), err)
		}
		for _, metric := range []client.LeaderboardMetric{
			client.LeaderboardMetric_LEADERBOARD_METRIC_BITS,
			client.LeaderboardMetric_LEADERBOARD_METRIC_GIFTED_SUBS,
		} {
			for _, minTotal := range []int64{1, 5} {
				for _, limit := range limits {
					limit := limit
					board, err := f.svc.ListViewerLeaderboard(ctx, &client.ListViewerLeaderboardRequest{
						Metric: metric, StreamSessionId: session, MinTotal: int64Ptr(minTotal), Limit: &limit,
					})
					if err != nil {
						t.Fatalf("ListViewerLeaderboard: %v", err)
					}
					board.Status = nil
					add(fmt.Sprintf("board %s %s min %d limit %d", metric, label, minTotal, limit), board, nil)
				}
			}
		}
	}
	return strings.Join(out, "\n")
}

func (f *compactionFixture) compact(t *testing.T, session string) *client.CompactStreamSessionResponse {
	t.Helper()
	resp, err := f.svc.CompactStreamSession(context.Background(), &client.CompactStreamSessionRequest{StreamSessionId: session})
	if err != nil {
		t.Fatalf("CompactStreamSession %s: %v", session, err)
	}
	return resp
}

func (f *compactionFixture) rawEvents(t *testing.T) int64 {
	t.Helper()
	var n int64
	if err := f.db.Model(&models.UserEvent{}).Count(&n).Error; err != nil {
		t.Fatalf("count user_events: %v", err)
	}
	return n
}

func assertSameReads(t *testing.T, stage, got, want string) {
	t.Helper()
	if got == want {
		return
	}
	gotLines := strings.Split(got, "\n")
	wantLines := strings.Split(want, "\n")
	for i := range wantLines {
		if i >= len(gotLines) || gotLines[i] != wantLines[i] {
			g := "<missing>"
			if i < len(gotLines) {
				g = gotLines[i]
			}
			t.Fatalf("%s changed a read:\n got  %s\n want %s", stage, g, wantLines[i])
		}
	}
	t.Fatalf("%s added reads: %d lines, want %d", stage, len(gotLines), len(wantLines))
}

func TestCompactingAndPruningLeaveEveryReadUnchanged(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newCompactionFixture(t, db)
		f.seed(t)
		fromRaw := f.readEverything(t)

		first := f.compact(t, f.first)
		if first.Viewers == 0 || first.TimelineEvents != 17 {
			t.Fatalf("first session compacted %d viewers and %d events, want some viewers and 17 events",
				first.Viewers, first.TimelineEvents)
		}
		f.compact(t, f.second)
		assertSameReads(t, "compacting", f.readEverything(t), fromRaw)

		// Compacting again rebuilds the same rows.
		f.compact(t, f.first)
		assertSameReads(t, "compacting again", f.readEverything(t), fromRaw)

		before := f.rawEvents(t)
		pruned, err := f.repo.PruneCompactedEvents(time.Now().Add(24*time.Hour), 3, time.Now())
		if err != nil {
			t.Fatalf("PruneCompactedEvents: %v", err)
		}
		// Left: the cheer before any session began, and the open session's three.
		if after := f.rawEvents(t); after != 4 || pruned != before-4 {
			t.Fatalf("pruned %d of %d, leaving %d; want all but 4 pruned", pruned, before, after)
		}
		assertSameReads(t, "pruning", f.readEverything(t), fromRaw)
	})
}

func TestCompactRefusesTheOpenSessionAndUnknownOnes(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newCompactionFixture(t, db)
		ctx := context.Background()
		_, err := f.svc.CompactStreamSession(ctx, &client.CompactStreamSessionRequest{StreamSessionId: f.third})
		wantTwirpCode(t, err, twirp.FailedPrecondition)
		_, err = f.svc.CompactStreamSession(ctx, &client.CompactStreamSessionRequest{StreamSessionId: uuid.NewString()})
		wantTwirpCode(t, err, twirp.NotFound)
		_, err = f.svc.CompactStreamSession(ctx, &client.CompactStreamSessionRequest{StreamSessionId: "nope"})
		wantTwirpCode(t, err, twirp.InvalidArgument)
		_, err = f.svc.CompactStreamSession(ctx, &client.CompactStreamSessionRequest{})
		wantTwirpCode(t, err, twirp.InvalidArgument)
	})
}

func TestSessionsToCompactFindsMissingAndLateCompactions(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newCompactionFixture(t, db)
		f.seed(t)

		due, err := f.repo.SessionsToCompact(10)
		if err != nil {
			t.Fatalf("SessionsToCompact: %v", err)
		}
		if fmt.Sprint(due) != fmt.Sprintf("[%s %s]", f.first, f.second) {
			t.Fatalf("due = %v, want the two closed sessions oldest first", due)
		}

		f.compact(t, f.first)
		f.compact(t, f.second)
		due, err = f.repo.SessionsToCompact(10)
		if err != nil {
			t.Fatalf("SessionsToCompact: %v", err)
		}
		if len(due) != 0 {
			t.Fatalf("due = %v after compacting both, want none", due)
		}

		// A write retried across the session's end lands after its compaction.
		// The copy does not hold it, so the session is due again and the row
		// is not pruned until it is.
		late := f.started.Add(90 * time.Minute)
		f.record(t, fact{eventType: models.UserEventTypeCheer, user: "5001", name: "Late", amount: 9, at: late})
		due, err = f.repo.SessionsToCompact(10)
		if err != nil {
			t.Fatalf("SessionsToCompact: %v", err)
		}
		if fmt.Sprint(due) != fmt.Sprintf("[%s]", f.first) {
			t.Fatalf("due = %v, want the first session", due)
		}
		if _, err := f.repo.PruneCompactedEvents(time.Now().Add(24*time.Hour), 100, time.Now()); err != nil {
			t.Fatalf("PruneCompactedEvents: %v", err)
		}
		var kept int64
		if err := db.Model(&models.UserEvent{}).Where("platform_user_id = ?", "5001").Count(&kept).Error; err != nil {
			t.Fatalf("count: %v", err)
		}
		if kept != 1 {
			t.Fatalf("late row pruned before its session was compacted again")
		}
	})
}

func TestACompactionIsNotRebuiltOncePruned(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newCompactionFixture(t, db)
		f.seed(t)
		f.compact(t, f.first)
		if _, err := f.repo.PruneCompactedEvents(time.Now().Add(24*time.Hour), 100, time.Now()); err != nil {
			t.Fatalf("PruneCompactedEvents: %v", err)
		}
		compacted := f.readEverything(t)

		_, err := f.svc.CompactStreamSession(context.Background(), &client.CompactStreamSessionRequest{StreamSessionId: f.first})
		wantTwirpCode(t, err, twirp.FailedPrecondition)
		due, err := f.repo.SessionsToCompact(10)
		if err != nil {
			t.Fatalf("SessionsToCompact: %v", err)
		}
		if fmt.Sprint(due) != fmt.Sprintf("[%s]", f.second) {
			t.Fatalf("due = %v, want only the uncompacted second session", due)
		}
		assertSameReads(t, "refusing to compact again", f.readEverything(t), compacted)
	})
}

func TestPruningKeepsWhatNoCompactionCovers(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newCompactionFixture(t, db)
		f.seed(t)
		// Only the first session is compacted: the second is closed but not
		// compacted, and the third is open.
		f.compact(t, f.first)

		// A cutoff inside the first session keeps its later rows too.
		cutoff := f.started.Add(90 * time.Minute)
		if _, err := f.repo.PruneCompactedEvents(cutoff, 100, time.Now()); err != nil {
			t.Fatalf("PruneCompactedEvents: %v", err)
		}
		var rows []models.UserEvent
		if err := db.Order("occurred_at ASC").Find(&rows).Error; err != nil {
			t.Fatalf("list: %v", err)
		}
		var beforeSessions, firstLate, firstEarly, later int
		for _, row := range rows {
			switch {
			case row.OccurredAt.Before(f.started):
				beforeSessions++
			case row.OccurredAt.Before(cutoff):
				firstEarly++
			case row.OccurredAt.Before(f.split):
				firstLate++
			default:
				later++
			}
		}
		if beforeSessions != 1 || firstEarly != 0 || firstLate == 0 || later == 0 {
			t.Fatalf("kept %d before sessions, %d first-session rows before the cutoff, %d after, %d in later sessions; "+
				"want 1, 0, some, some", beforeSessions, firstEarly, firstLate, later)
		}
		var laterSessions int64
		if err := db.Model(&models.UserEvent{}).Where("occurred_at >= ?", f.split.UTC()).Count(&laterSessions).Error; err != nil {
			t.Fatalf("count: %v", err)
		}
		if int(laterSessions) != later {
			t.Fatalf("rows in the uncompacted and open sessions = %d, want all %d kept", laterSessions, later)
		}

		// With every row old enough, the uncompacted and open sessions still
		// keep theirs. Among them is the cheer at the split stamped with the
		// first session: a row belongs to the session owning its time, not
		// to its stamp.
		if _, err := f.repo.PruneCompactedEvents(time.Now().Add(24*time.Hour), 100, time.Now()); err != nil {
			t.Fatalf("PruneCompactedEvents: %v", err)
		}
		var left int64
		if err := db.Model(&models.UserEvent{}).Where("occurred_at >= ?", f.split.UTC()).Count(&left).Error; err != nil {
			t.Fatalf("count: %v", err)
		}
		if int(left) != later {
			t.Fatalf("rows in the uncompacted and open sessions = %d after a full prune, want %d", left, later)
		}
	})
}
