package repository

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// UserEventRepository wraps gorm.DB with the platform event log.
type UserEventRepository struct {
	db *gorm.DB
}

func NewUserEventRepository(db *gorm.DB) *UserEventRepository {
	return &UserEventRepository{db: db}
}

// Record inserts an event unless one with the same (source, event_id) is
// already stored, and returns the stored row either way. The bool reports
// whether this call wrote it.
//
// The conflict is resolved by the unique constraint rather than a lookup
// first, so two deliveries of one event racing each other still produce a
// single row.
func (r *UserEventRepository) Record(event *models.UserEvent) (*models.UserEvent, bool, error) {
	result := r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "source"}, {Name: "event_id"}},
		DoNothing: true,
	}).Create(event)
	if result.Error != nil {
		return nil, false, result.Error
	}
	if result.RowsAffected == 1 {
		return event, true, nil
	}

	var stored models.UserEvent
	if err := r.db.Where("source = ? AND event_id = ?", event.Source, event.EventID).
		First(&stored).Error; err != nil {
		return nil, false, err
	}
	return &stored, false, nil
}

// EventWindow is the span of occurred_at a read covers, [From, To). A nil To
// runs to the present, which is what an open session owns.
//
// Both bounds are bound in UTC. SQLite stores timestamps as text and compares
// them as text, which orders correctly only while every value has the same
// offset, and user_events and stream_sessions are written in UTC.
type EventWindow struct {
	From time.Time
	To   *time.Time
}

// SessionEventTotals is what a window of the log adds up to across every
// viewer, anonymous events included.
type SessionEventTotals struct {
	Bits       int64
	Cheers     int64
	Subs       int64
	GiftedSubs int64
	Follows    int64
	Raids      int64
	Raiders    int64
}

// ViewerEventTotals is what one viewer gave. UserName is the name on the
// viewer's most recent event that carried one.
type ViewerEventTotals struct {
	Bits       int64
	Cheers     int64
	GiftedSubs int64
	Gifts      int64
	UserName   *string
}

// LeaderboardEntry is one viewer's standing: Total is the summed amount of
// Events events of the ranked type.
type LeaderboardEntry struct {
	Platform       string
	PlatformUserID string
	UserName       *string
	Total          int64
	Events         int64
}

// Totals adds up the events that occurred in the window.
//
// Subs counts only subscriptions a viewer took out or renewed themselves.
// Twitch sends a gift as one SubscriptionGift for the gifter and one gifted
// Subscribe per recipient, and both are in the log; the gift side is
// GiftedSubs, so the recipients' rows are left out here.
func (r *UserEventRepository) Totals(window EventWindow) (*SessionEventTotals, error) {
	query := fmt.Sprintf(`SELECT
		CAST(COALESCE(SUM(CASE WHEN event_type = @cheer THEN amount END), 0) AS BIGINT) AS bits,
		COUNT(CASE WHEN event_type = @cheer THEN 1 END) AS cheers,
		COUNT(CASE WHEN event_type = @resub
			OR (event_type = @subscribe AND NOT COALESCE(%s, FALSE)) THEN 1 END) AS subs,
		CAST(COALESCE(SUM(CASE WHEN event_type = @gift THEN amount END), 0) AS BIGINT) AS gifted_subs,
		COUNT(CASE WHEN event_type = @follow THEN 1 END) AS follows,
		COUNT(CASE WHEN event_type = @raid THEN 1 END) AS raids,
		CAST(COALESCE(SUM(CASE WHEN event_type = @raid THEN amount END), 0) AS BIGINT) AS raiders
		FROM user_events
		WHERE event_type IN @types AND %s`, r.isGiftedSub(), windowClause(&window))

	args := eventTypeArgs()
	args["types"] = sessionEventTypes()
	addWindowArgs(args, &window)

	var totals SessionEventTotals
	if err := r.db.Raw(query, args).Scan(&totals).Error; err != nil {
		return nil, err
	}
	return &totals, nil
}

// RecentQuery selects a page of the log, newest first.
type RecentQuery struct {
	// Since bounds the span from below, inclusive. Nil spans the whole log.
	Since *time.Time
	// EventTypes keeps only these types. Empty keeps every type.
	EventTypes []string
	// Before keeps only events after it in newest-first order. Nil starts at
	// the newest event.
	Before *UserEventPosition
	Limit  int
	// SkipTotal leaves RecentPage.Total zero instead of counting the span.
	SkipTotal bool
}

// UserEventPosition is an event's place in the newest-first order: by
// occurred_at, then by id among events at the same instant.
type UserEventPosition struct {
	OccurredAt time.Time
	ID         uuid.UUID
}

// RecentPage is one page of Recent.
type RecentPage struct {
	Events []*models.UserEvent
	// Total counts every event in the span of the requested types, whatever
	// Before is. Zero when the query set SkipTotal.
	Total int64
	// More is true when older events of the span follow the last one returned.
	More bool
}

// Recent returns the latest `Limit` events of the span, newest first. Events
// at the same instant are ordered by id, so a read is stable across calls and
// a page that ends partway through an instant resumes where it left off.
func (r *UserEventRepository) Recent(query RecentQuery) (*RecentPage, error) {
	span := r.db.Model(&models.UserEvent{})
	if query.Since != nil {
		span = span.Where("occurred_at >= ?", query.Since.UTC())
	}
	if len(query.EventTypes) > 0 {
		span = span.Where("event_type IN ?", query.EventTypes)
	}

	var total int64
	if !query.SkipTotal {
		if err := span.Session(&gorm.Session{}).Count(&total).Error; err != nil {
			return nil, err
		}
	}
	page := span.Session(&gorm.Session{})
	if query.Before != nil {
		at := query.Before.OccurredAt.UTC()
		page = page.Where("occurred_at < ? OR (occurred_at = ? AND id < ?)", at, at, query.Before.ID)
	}
	// One more than asked for says whether another page follows without a
	// second query.
	events := []*models.UserEvent{}
	if err := page.
		Order("occurred_at DESC").
		Order("id DESC").
		Limit(query.Limit + 1).
		Find(&events).Error; err != nil {
		return nil, err
	}
	more := len(events) > query.Limit
	if more {
		events = events[:query.Limit]
	}
	return &RecentPage{Events: events, Total: total, More: more}, nil
}

// SessionEvents returns the first `limit` events of the window that Totals
// counts, oldest first, and how many there are in all. Gifted Subscribe rows
// are left out for the reason Totals leaves them out of subs: the gift is
// already the gifter's SubscriptionGift row. Events at the same instant are
// ordered by id, so a read is stable across calls.
func (r *UserEventRepository) SessionEvents(window EventWindow, limit int) ([]*models.UserEvent, int64, error) {
	where := fmt.Sprintf(`event_type IN @types
		AND NOT (event_type = @subscribe AND COALESCE(%s, FALSE))
		AND %s`, r.isGiftedSub(), windowClause(&window))

	args := eventTypeArgs()
	args["types"] = sessionEventTypes()
	addWindowArgs(args, &window)

	span := r.db.Model(&models.UserEvent{}).Where(where, args)

	var total int64
	if err := span.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	events := []*models.UserEvent{}
	if err := span.Session(&gorm.Session{}).
		Order("occurred_at ASC").
		Order("id ASC").
		Limit(limit).
		Find(&events).Error; err != nil {
		return nil, 0, err
	}
	return events, total, nil
}

// ViewerTotals adds up what one viewer cheered and gifted. A window covers
// the raw events in it and must not be a compacted session's (see
// CompactedViewerTotals); a nil window covers every event recorded, read from
// the compact rows where a compaction covers it and from the raw log
// elsewhere.
func (r *UserEventRepository) ViewerTotals(platform, platformUserID string, window *EventWindow) (*ViewerEventTotals, error) {
	raw := fmt.Sprintf(`SELECT
		COALESCE(SUM(CASE WHEN e.event_type = @cheer THEN e.amount END), 0) AS bits,
		COUNT(CASE WHEN e.event_type = @cheer THEN 1 END) AS cheers,
		COALESCE(SUM(CASE WHEN e.event_type = @gift THEN e.amount END), 0) AS gifted_subs,
		COUNT(CASE WHEN e.event_type = @gift THEN 1 END) AS gifts
		FROM user_events e
		WHERE e.platform = @platform AND e.platform_user_id = @user
			AND e.event_type IN @types AND %s`, windowClause(window))
	compacted := ""
	if window == nil {
		raw += " AND " + uncoveredByCompaction
		compacted = `UNION ALL
			SELECT bits, cheers, gifted_subs, gifts FROM viewer_session_totals
			WHERE platform = @platform AND platform_user_id = @user`
	}
	query := fmt.Sprintf(`SELECT
		CAST(COALESCE(SUM(bits), 0) AS BIGINT) AS bits,
		CAST(COALESCE(SUM(cheers), 0) AS BIGINT) AS cheers,
		CAST(COALESCE(SUM(gifted_subs), 0) AS BIGINT) AS gifted_subs,
		CAST(COALESCE(SUM(gifts), 0) AS BIGINT) AS gifts
		FROM (%s %s) t`, raw, compacted)

	args := eventTypeArgs()
	args["platform"] = platform
	args["user"] = platformUserID
	args["types"] = []string{models.UserEventTypeCheer, models.UserEventTypeSubscriptionGift}
	addWindowArgs(args, window)

	var totals ViewerEventTotals
	if err := r.db.Raw(query, args).Scan(&totals).Error; err != nil {
		return nil, err
	}
	if err := r.nameViewer(platform, platformUserID, &totals); err != nil {
		return nil, err
	}
	return &totals, nil
}

// Leaderboard ranks viewers by the summed amount of `eventType` events in the
// window, keeping those whose total is at least minTotal. Anonymous events
// have no platform_user_id and so rank nobody. A window covers the raw events
// in it and must not be a compacted session's (see CompactedLeaderboard); a
// nil window ranks every event recorded, read from the compact rows where a
// compaction covers it and from the raw log elsewhere.
func (r *UserEventRepository) Leaderboard(eventType string, window *EventWindow, minTotal int64, limit int) ([]*LeaderboardEntry, error) {
	columns, err := leaderboardColumnsFor(eventType)
	if err != nil {
		return nil, err
	}
	raw := fmt.Sprintf(`SELECT e.platform, e.platform_user_id,
		COALESCE(SUM(e.amount), 0) AS total,
		COUNT(*) AS events
		FROM user_events e
		WHERE e.event_type = @type AND e.platform_user_id IS NOT NULL AND %s`, windowClause(window))
	compacted := ""
	if window == nil {
		raw += " AND " + uncoveredByCompaction
		compacted = fmt.Sprintf(`UNION ALL
			SELECT platform, platform_user_id, %[1]s, %[2]s FROM viewer_session_totals WHERE %[2]s > 0`,
			columns.total, columns.events)
	}
	query := fmt.Sprintf(`SELECT platform, platform_user_id,
		CAST(SUM(total) AS BIGINT) AS total,
		CAST(SUM(events) AS BIGINT) AS events
		FROM (%s GROUP BY e.platform, e.platform_user_id %s) t
		GROUP BY platform, platform_user_id
		HAVING SUM(total) >= @min
		ORDER BY total DESC, platform ASC, platform_user_id ASC
		LIMIT @limit`, raw, compacted)

	args := map[string]interface{}{
		"type":  eventType,
		"min":   minTotal,
		"limit": limit,
	}
	addWindowArgs(args, window)

	entries := []*LeaderboardEntry{}
	if err := r.db.Raw(query, args).Scan(&entries).Error; err != nil {
		return nil, err
	}
	if err := r.nameEntries(entries); err != nil {
		return nil, err
	}
	return entries, nil
}

type viewerKey struct {
	Platform       string
	PlatformUserID string
}

func (r *UserEventRepository) nameViewer(platform, platformUserID string, totals *ViewerEventTotals) error {
	key := viewerKey{Platform: platform, PlatformUserID: platformUserID}
	names, err := r.latestUserNames([]viewerKey{key})
	if err != nil {
		return err
	}
	totals.UserName = names[key]
	return nil
}

func (r *UserEventRepository) nameEntries(entries []*LeaderboardEntry) error {
	keys := make([]viewerKey, 0, len(entries))
	for _, entry := range entries {
		keys = append(keys, viewerKey{Platform: entry.Platform, PlatformUserID: entry.PlatformUserID})
	}
	names, err := r.latestUserNames(keys)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		entry.UserName = names[viewerKey{Platform: entry.Platform, PlatformUserID: entry.PlatformUserID}]
	}
	return nil
}

// latestUserNames returns the name each viewer's most recent named event
// carried, whatever its type and whenever it happened. Names change, so the
// newest one is the one to show; viewers whose events carried no name are
// absent from the map. A compacted session contributes the latest name it
// saw, so the answer is the same whether its raw rows are pruned or not.
func (r *UserEventRepository) latestUserNames(viewers []viewerKey) (map[viewerKey]*string, error) {
	names := map[viewerKey]*string{}
	if len(viewers) == 0 {
		return names, nil
	}
	ids := make([]string, 0, len(viewers))
	for _, viewer := range viewers {
		ids = append(ids, viewer.PlatformUserID)
	}

	var rows []struct {
		Platform       string
		PlatformUserID string
		UserName       string
	}
	err := r.db.Raw(`WITH named AS (
			SELECT e.platform, e.platform_user_id, e.user_name, e.occurred_at AS named_at
			FROM user_events e
			WHERE e.platform_user_id IN @ids AND e.user_name IS NOT NULL AND `+uncoveredByCompaction+`
			UNION ALL
			SELECT platform, platform_user_id, user_name, last_named_at
			FROM viewer_session_totals
			WHERE platform_user_id IN @ids AND user_name IS NOT NULL
		)
		SELECT n.platform, n.platform_user_id, n.user_name
		FROM named n
		JOIN (
			SELECT platform, platform_user_id, MAX(named_at) AS latest
			FROM named
			GROUP BY platform, platform_user_id
		) l ON l.platform = n.platform
			AND l.platform_user_id = n.platform_user_id
			AND l.latest = n.named_at
		ORDER BY n.platform, n.platform_user_id, n.user_name`,
		map[string]interface{}{"ids": ids}).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	wanted := make(map[viewerKey]bool, len(viewers))
	for _, viewer := range viewers {
		wanted[viewer] = true
	}
	for _, row := range rows {
		key := viewerKey{Platform: row.Platform, PlatformUserID: row.PlatformUserID}
		// Two named events at the same instant tie on MAX; the ORDER BY makes
		// the pick the same on every read, and matches the pick Compact makes
		// within a session.
		if !wanted[key] || names[key] != nil {
			continue
		}
		name := row.UserName
		names[key] = &name
	}
	return names, nil
}

// isGiftedSub is the SQL that is true for a Subscribe row a gift paid for.
// Twitch marks it only in the event payload, so it is read out of the JSON,
// which each dialect spells differently. It is evaluated only for Subscribe
// rows inside the window, never across the log.
func (r *UserEventRepository) isGiftedSub() string {
	if database.Dialect(r.db.Dialector.Name()) == database.DialectPostgres {
		return `(event_value->>'isGift') = 'true'`
	}
	return `json_extract(event_value, '$.isGift') = 1`
}

// sessionEventTypes are the types the session totals and timeline count.
func sessionEventTypes() []string {
	return []string{
		models.UserEventTypeCheer,
		models.UserEventTypeResub,
		models.UserEventTypeSubscribe,
		models.UserEventTypeSubscriptionGift,
		models.UserEventTypeFollow,
		models.UserEventTypeRaid,
	}
}

func eventTypeArgs() map[string]interface{} {
	return map[string]interface{}{
		"cheer":     models.UserEventTypeCheer,
		"resub":     models.UserEventTypeResub,
		"subscribe": models.UserEventTypeSubscribe,
		"gift":      models.UserEventTypeSubscriptionGift,
		"follow":    models.UserEventTypeFollow,
		"raid":      models.UserEventTypeRaid,
	}
}

func windowClause(window *EventWindow) string {
	if window == nil {
		return "TRUE"
	}
	clauses := []string{"occurred_at >= @from"}
	if window.To != nil {
		clauses = append(clauses, "occurred_at < @to")
	}
	return strings.Join(clauses, " AND ")
}

func addWindowArgs(args map[string]interface{}, window *EventWindow) {
	if window == nil {
		return
	}
	args["from"] = window.From.UTC()
	if window.To != nil {
		args["to"] = window.To.UTC()
	}
}
