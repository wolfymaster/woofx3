package services

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
	pgdriver "gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// aggregatePostgresURLEnv names an empty, throwaway Postgres database the
// aggregate tests also run against. The aggregates spell JSON access per
// dialect, so SQLite passing says nothing about Postgres. Without it only
// SQLite runs.
const aggregatePostgresURLEnv = "WOOFX3_MIGRATION_TEST_POSTGRES_URL"

// forEachDialect runs `test` against a fully migrated SQLite database and,
// when aggregatePostgresURLEnv is set, a fully migrated Postgres one.
func forEachDialect(t *testing.T, test func(t *testing.T, db *gorm.DB)) {
	t.Helper()
	t.Run("sqlite", func(t *testing.T) {
		db := openEmptySQLite(t)
		sqlDB, err := db.DB()
		if err != nil {
			t.Fatalf("sql db: %v", err)
		}
		// Every connection to :memory: is a separate database.
		sqlDB.SetMaxOpenConns(1)
		if err := gormigrate.New(db, gormigrate.DefaultOptions, sqliteChain(t)).Migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		test(t, db)
	})
	t.Run("postgres", func(t *testing.T) {
		url := os.Getenv(aggregatePostgresURLEnv)
		if url == "" {
			t.Skipf("%s not set", aggregatePostgresURLEnv)
		}
		db, err := gorm.Open(pgdriver.Open(url), &gorm.Config{})
		if err != nil {
			t.Fatalf("open postgres: %v", err)
		}
		var tables int64
		if err := db.Raw(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'`).
			Scan(&tables).Error; err != nil {
			t.Fatalf("count tables: %v", err)
		}
		if tables > 0 {
			t.Fatalf("%s points at a database with %d tables; use an empty, throwaway one", aggregatePostgresURLEnv, tables)
		}
		t.Cleanup(func() {
			db.Exec(`DROP SCHEMA public CASCADE`)
			db.Exec(`CREATE SCHEMA public`)
		})
		if err := db.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).Error; err != nil {
			t.Fatalf("enable uuid-ossp: %v", err)
		}
		chain, err := migrations.For(database.DialectPostgres)
		if err != nil {
			t.Fatalf("migrations.For: %v", err)
		}
		if err := gormigrate.New(db, gormigrate.DefaultOptions, chain).Migrate(); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		test(t, db)
	})
}

// aggregateFixture is two sessions split at `split`, with the service over
// both. `split` has a fractional second so the window edges are compared at
// sub-second precision, which is where text-stored timestamps go wrong.
type aggregateFixture struct {
	svc     client.UserEventService
	first   string
	second  string
	split   time.Time
	started time.Time
	seq     int
}

func newAggregateFixture(t *testing.T, db *gorm.DB) *aggregateFixture {
	t.Helper()
	sessions := repo.NewStreamSessionRepository(db)
	started := time.Date(2026, 9, 27, 18, 0, 0, 0, time.UTC)
	split := time.Date(2026, 9, 27, 22, 0, 0, 500_000_000, time.UTC)
	first, _, err := sessions.EnsureOpenSession(started)
	if err != nil {
		t.Fatalf("EnsureOpenSession: %v", err)
	}
	_, second, err := sessions.SplitSession(split)
	if err != nil {
		t.Fatalf("SplitSession: %v", err)
	}
	return &aggregateFixture{
		svc:     NewUserEventService(repo.NewUserEventRepository(db), sessions),
		first:   first.ID.String(),
		second:  second.ID.String(),
		split:   split,
		started: started,
	}
}

type fact struct {
	eventType string
	user      string
	name      string
	amount    int64
	value     string
	at        time.Time
	stamp     string
}

func (f *aggregateFixture) record(t *testing.T, e fact) {
	t.Helper()
	f.seq++
	value := e.value
	if value == "" {
		value = "{}"
	}
	req := &client.RecordUserEventRequest{
		EventId:    fmt.Sprintf("ce-%d", f.seq),
		Source:     "twitch",
		EventType:  e.eventType,
		Platform:   "twitch",
		EventValue: value,
		OccurredAt: timestamppb.New(e.at),
	}
	if e.user != "" {
		req.PlatformUserId = strPtr(e.user)
	}
	if e.name != "" {
		req.UserName = strPtr(e.name)
	}
	if e.amount != 0 {
		req.Amount = int64Ptr(e.amount)
	}
	if e.stamp != "" {
		req.SessionId = strPtr(e.stamp)
	}
	if _, err := f.svc.RecordUserEvent(context.Background(), req); err != nil {
		t.Fatalf("RecordUserEvent %s: %v", e.eventType, err)
	}
}

// seedTwoSessions records a first session with every kind of fact the totals
// count, and a second session with a little more from the same viewers.
func (f *aggregateFixture) seedTwoSessions(t *testing.T) {
	t.Helper()
	in := f.started.Add(time.Hour)
	facts := []fact{
		{eventType: models.UserEventTypeCheer, user: "1001", name: "Alice", amount: 100, at: in, stamp: f.first},
		{eventType: models.UserEventTypeCheer, amount: 50, at: in, stamp: f.first},
		{eventType: models.UserEventTypeSubscriptionGift, user: "1002", name: "Bob", amount: 3, at: in, stamp: f.first},
		{eventType: models.UserEventTypeSubscribe, user: "2001", value: `{"isGift":true}`, at: in, stamp: f.first},
		{eventType: models.UserEventTypeSubscribe, user: "2002", value: `{"isGift":true}`, at: in, stamp: f.first},
		{eventType: models.UserEventTypeSubscribe, user: "2003", value: `{"isGift":true}`, at: in, stamp: f.first},
		{eventType: models.UserEventTypeSubscribe, user: "2004", value: `{"isGift":false}`, at: in, stamp: f.first},
		{eventType: models.UserEventTypeResub, user: "2005", at: in, stamp: f.first},
		{eventType: models.UserEventTypeFollow, user: "2006", at: in, stamp: f.first},
		{eventType: models.UserEventTypeRaid, user: "3001", amount: 25, at: in, stamp: f.first},
		// An anonymous gift counts for the channel and for nobody.
		{eventType: models.UserEventTypeSubscriptionGift, amount: 5, at: in, stamp: f.first},
		// A redemption is not one of the totals.
		{eventType: "channelpoints.redeem", user: "1001", amount: 1000, at: in, stamp: f.first},
		// Unstamped, but inside the first session's time: it belongs there.
		{eventType: models.UserEventTypeCheer, user: "1001", amount: 10, at: in},
		// A millisecond before the split, stamped with the successor.
		{eventType: models.UserEventTypeCheer, user: "1002", name: "Bob", amount: 7, at: f.split.Add(-time.Millisecond), stamp: f.second},
		// At the split instant, stamped with the session it replaced: the time
		// belongs to the successor.
		{eventType: models.UserEventTypeCheer, user: "1001", name: "Alicia", amount: 1000, at: f.split, stamp: f.first},
		{eventType: models.UserEventTypeSubscriptionGift, user: "1001", name: "Alicia", amount: 10, at: f.split.Add(time.Hour), stamp: f.second},
		// Before the first session began: in no session, but in lifetime.
		{eventType: models.UserEventTypeCheer, user: "1002", amount: 1, at: f.started.Add(-time.Hour)},
	}
	for _, e := range facts {
		f.record(t, e)
	}
}

func TestSessionTotalsCountWhatHappenedInTheSessionsTime(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newAggregateFixture(t, db)
		f.seedTwoSessions(t)
		ctx := context.Background()

		resp, err := f.svc.GetStreamSessionEventTotals(ctx, &client.GetStreamSessionEventTotalsRequest{StreamSessionId: f.first})
		if err != nil {
			t.Fatalf("GetStreamSessionEventTotals: %v", err)
		}
		want := &client.StreamSessionEventTotals{
			Bits: 167, Cheers: 4, Subs: 2, GiftedSubs: 8, Follows: 1, Raids: 1, Raiders: 25,
		}
		assertSessionTotals(t, resp.Totals, want)

		resp, err = f.svc.GetStreamSessionEventTotals(ctx, &client.GetStreamSessionEventTotalsRequest{StreamSessionId: f.second})
		if err != nil {
			t.Fatalf("GetStreamSessionEventTotals: %v", err)
		}
		assertSessionTotals(t, resp.Totals, &client.StreamSessionEventTotals{Bits: 1000, Cheers: 1, GiftedSubs: 10})
	})
}

func assertSessionTotals(t *testing.T, got, want *client.StreamSessionEventTotals) {
	t.Helper()
	if got.Bits != want.Bits || got.Cheers != want.Cheers || got.Subs != want.Subs ||
		got.GiftedSubs != want.GiftedSubs || got.Follows != want.Follows ||
		got.Raids != want.Raids || got.Raiders != want.Raiders {
		t.Fatalf("totals = %+v, want %+v", got, want)
	}
}

func TestSessionReadsRejectUnknownSessions(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newAggregateFixture(t, db)
		ctx := context.Background()
		unknown := "7f0c5a1e-0000-4000-8000-00000000dead"

		_, err := f.svc.GetStreamSessionEventTotals(ctx, &client.GetStreamSessionEventTotalsRequest{StreamSessionId: unknown})
		wantTwirpCode(t, err, twirp.NotFound)
		_, err = f.svc.GetStreamSessionEventTotals(ctx, &client.GetStreamSessionEventTotalsRequest{StreamSessionId: "nope"})
		wantTwirpCode(t, err, twirp.InvalidArgument)
		_, err = f.svc.GetStreamSessionEventTotals(ctx, &client.GetStreamSessionEventTotalsRequest{})
		wantTwirpCode(t, err, twirp.InvalidArgument)
		_, err = f.svc.GetViewerEventTotals(ctx, &client.GetViewerEventTotalsRequest{
			Platform: "twitch", PlatformUserId: "1001", StreamSessionId: strPtr(unknown),
		})
		wantTwirpCode(t, err, twirp.NotFound)
		_, err = f.svc.ListViewerLeaderboard(ctx, &client.ListViewerLeaderboardRequest{
			Metric: client.LeaderboardMetric_LEADERBOARD_METRIC_BITS, StreamSessionId: strPtr(unknown),
		})
		wantTwirpCode(t, err, twirp.NotFound)
	})
}

func TestViewerTotalsForASessionAndForLifetime(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newAggregateFixture(t, db)
		f.seedTwoSessions(t)
		ctx := context.Background()

		session, err := f.svc.GetViewerEventTotals(ctx, &client.GetViewerEventTotalsRequest{
			Platform: "twitch", PlatformUserId: "1001", StreamSessionId: strPtr(f.first),
		})
		if err != nil {
			t.Fatalf("GetViewerEventTotals: %v", err)
		}
		got := session.Totals
		if got.Bits != 110 || got.Cheers != 2 || got.GiftedSubs != 0 || got.Gifts != 0 {
			t.Fatalf("session totals = %+v, want 110 bits over 2 cheers, no gifts", got)
		}
		// The name is the viewer's newest, even when it is outside the window.
		if got.UserName == nil || *got.UserName != "Alicia" {
			t.Fatalf("user_name = %v, want Alicia", got.UserName)
		}

		lifetime, err := f.svc.GetViewerEventTotals(ctx, &client.GetViewerEventTotalsRequest{
			Platform: "twitch", PlatformUserId: "1001",
		})
		if err != nil {
			t.Fatalf("GetViewerEventTotals: %v", err)
		}
		got = lifetime.Totals
		if got.Bits != 1110 || got.Cheers != 3 || got.GiftedSubs != 10 || got.Gifts != 1 {
			t.Fatalf("lifetime totals = %+v, want 1110 bits over 3 cheers, 10 subs in 1 gift", got)
		}

		bob, err := f.svc.GetViewerEventTotals(ctx, &client.GetViewerEventTotalsRequest{
			Platform: "twitch", PlatformUserId: "1002",
		})
		if err != nil {
			t.Fatalf("GetViewerEventTotals: %v", err)
		}
		// Bob's lifetime includes the cheer from before any session existed,
		// and none of the anonymous gift.
		if bob.Totals.Bits != 8 || bob.Totals.GiftedSubs != 3 || bob.Totals.Gifts != 1 {
			t.Fatalf("bob = %+v, want 8 bits and 3 subs in 1 gift", bob.Totals)
		}

		nobody, err := f.svc.GetViewerEventTotals(ctx, &client.GetViewerEventTotalsRequest{
			Platform: "twitch", PlatformUserId: "9999",
		})
		if err != nil {
			t.Fatalf("GetViewerEventTotals: %v", err)
		}
		if nobody.Totals.Bits != 0 || nobody.Totals.Gifts != 0 || nobody.Totals.UserName != nil {
			t.Fatalf("unknown viewer = %+v, want zeroes and no name", nobody.Totals)
		}

		_, err = f.svc.GetViewerEventTotals(ctx, &client.GetViewerEventTotalsRequest{Platform: "twitch"})
		wantTwirpCode(t, err, twirp.InvalidArgument)
	})
}

func TestLeaderboardsRankNamedViewersAboveTheThreshold(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newAggregateFixture(t, db)
		f.seedTwoSessions(t)
		ctx := context.Background()
		bits := client.LeaderboardMetric_LEADERBOARD_METRIC_BITS
		gifted := client.LeaderboardMetric_LEADERBOARD_METRIC_GIFTED_SUBS

		lifetime, err := f.svc.ListViewerLeaderboard(ctx, &client.ListViewerLeaderboardRequest{Metric: bits})
		if err != nil {
			t.Fatalf("ListViewerLeaderboard: %v", err)
		}
		assertBoard(t, lifetime.Entries, []string{"1001:Alicia:1110:3", "1002:Bob:8:2"})

		session, err := f.svc.ListViewerLeaderboard(ctx, &client.ListViewerLeaderboardRequest{
			Metric: bits, StreamSessionId: strPtr(f.first),
		})
		if err != nil {
			t.Fatalf("ListViewerLeaderboard: %v", err)
		}
		assertBoard(t, session.Entries, []string{"1001:Alicia:110:2", "1002:Bob:7:1"})

		// "Users who gifted at least 5": Bob's 3 drops out, and the anonymous
		// gift of 5 in the same session ranks nobody.
		gifters, err := f.svc.ListViewerLeaderboard(ctx, &client.ListViewerLeaderboardRequest{
			Metric: gifted, MinTotal: int64Ptr(5),
		})
		if err != nil {
			t.Fatalf("ListViewerLeaderboard: %v", err)
		}
		assertBoard(t, gifters.Entries, []string{"1001:Alicia:10:1"})

		one := int32(1)
		top, err := f.svc.ListViewerLeaderboard(ctx, &client.ListViewerLeaderboardRequest{Metric: gifted, Limit: &one})
		if err != nil {
			t.Fatalf("ListViewerLeaderboard: %v", err)
		}
		assertBoard(t, top.Entries, []string{"1001:Alicia:10:1"})

		zero := int32(0)
		_, err = f.svc.ListViewerLeaderboard(ctx, &client.ListViewerLeaderboardRequest{Metric: bits, Limit: &zero})
		wantTwirpCode(t, err, twirp.InvalidArgument)
		_, err = f.svc.ListViewerLeaderboard(ctx, &client.ListViewerLeaderboardRequest{Metric: bits, MinTotal: int64Ptr(0)})
		wantTwirpCode(t, err, twirp.InvalidArgument)
		_, err = f.svc.ListViewerLeaderboard(ctx, &client.ListViewerLeaderboardRequest{})
		wantTwirpCode(t, err, twirp.InvalidArgument)
	})
}

func TestLeaderboardTiesAreOrderedByViewer(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newAggregateFixture(t, db)
		at := f.started.Add(time.Minute)
		for _, user := range []string{"30", "10", "20"} {
			f.record(t, fact{eventType: models.UserEventTypeCheer, user: user, amount: 100, at: at})
		}
		resp, err := f.svc.ListViewerLeaderboard(context.Background(), &client.ListViewerLeaderboardRequest{
			Metric: client.LeaderboardMetric_LEADERBOARD_METRIC_BITS,
		})
		if err != nil {
			t.Fatalf("ListViewerLeaderboard: %v", err)
		}
		assertBoard(t, resp.Entries, []string{"10::100:1", "20::100:1", "30::100:1"})
	})
}

func TestRecentEventsAreTheNewestInTheSpan(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newAggregateFixture(t, db)
		f.seedTwoSessions(t)
		ctx := context.Background()

		limit := int32(2)
		resp, err := f.svc.ListRecentUserEvents(ctx, &client.ListRecentUserEventsRequest{
			Since: timestamppb.New(f.split),
			Limit: &limit,
		})
		if err != nil {
			t.Fatalf("ListRecentUserEvents: %v", err)
		}
		// At the split and an hour after it; the cheer a millisecond before
		// the split is outside the span.
		if resp.Total != 2 {
			t.Fatalf("total = %d, want 2", resp.Total)
		}
		got := make([]string, 0, len(resp.Events))
		for _, event := range resp.Events {
			got = append(got, fmt.Sprintf("%s:%d", event.EventType, *event.Amount))
		}
		want := []string{models.UserEventTypeSubscriptionGift + ":10", models.UserEventTypeCheer + ":1000"}
		if fmt.Sprint(got) != fmt.Sprint(want) {
			t.Fatalf("events = %v, want %v", got, want)
		}

		limit = 1
		resp, err = f.svc.ListRecentUserEvents(ctx, &client.ListRecentUserEventsRequest{
			Since: timestamppb.New(f.started.Add(-2 * time.Hour)),
			Limit: &limit,
		})
		if err != nil {
			t.Fatalf("ListRecentUserEvents: %v", err)
		}
		if resp.Total != 17 || len(resp.Events) != 1 {
			t.Fatalf("total = %d with %d events, want 17 with 1", resp.Total, len(resp.Events))
		}
	})
}

func TestRecentEventsRejectBadRequests(t *testing.T) {
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		f := newAggregateFixture(t, db)
		ctx := context.Background()
		zero := int32(0)
		requests := map[string]*client.ListRecentUserEventsRequest{
			"no since":   {},
			"zero limit": {Since: timestamppb.New(f.started), Limit: &zero},
		}
		for name, req := range requests {
			t.Run(name, func(t *testing.T) {
				_, err := f.svc.ListRecentUserEvents(ctx, req)
				wantTwirpCode(t, err, twirp.InvalidArgument)
			})
		}
	})
}

// assertBoard compares entries as "id:name:total:events".
func assertBoard(t *testing.T, entries []*client.LeaderboardEntry, want []string) {
	t.Helper()
	got := make([]string, 0, len(entries))
	for _, entry := range entries {
		name := ""
		if entry.UserName != nil {
			name = *entry.UserName
		}
		got = append(got, fmt.Sprintf("%s:%s:%d:%d", entry.PlatformUserId, name, entry.Total, entry.Events))
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("leaderboard = %v, want %v", got, want)
	}
}
