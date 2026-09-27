package repository

import (
	"fmt"
	"strings"
	"time"

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
	args["types"] = []string{
		models.UserEventTypeCheer,
		models.UserEventTypeResub,
		models.UserEventTypeSubscribe,
		models.UserEventTypeSubscriptionGift,
		models.UserEventTypeFollow,
		models.UserEventTypeRaid,
	}
	addWindowArgs(args, &window)

	var totals SessionEventTotals
	if err := r.db.Raw(query, args).Scan(&totals).Error; err != nil {
		return nil, err
	}
	return &totals, nil
}

// ViewerTotals adds up what one viewer cheered and gifted. A nil window covers
// every event recorded.
func (r *UserEventRepository) ViewerTotals(platform, platformUserID string, window *EventWindow) (*ViewerEventTotals, error) {
	query := fmt.Sprintf(`SELECT
		CAST(COALESCE(SUM(CASE WHEN event_type = @cheer THEN amount END), 0) AS BIGINT) AS bits,
		COUNT(CASE WHEN event_type = @cheer THEN 1 END) AS cheers,
		CAST(COALESCE(SUM(CASE WHEN event_type = @gift THEN amount END), 0) AS BIGINT) AS gifted_subs,
		COUNT(CASE WHEN event_type = @gift THEN 1 END) AS gifts
		FROM user_events
		WHERE platform = @platform AND platform_user_id = @user
			AND event_type IN @types AND %s`, windowClause(window))

	args := eventTypeArgs()
	args["platform"] = platform
	args["user"] = platformUserID
	args["types"] = []string{models.UserEventTypeCheer, models.UserEventTypeSubscriptionGift}
	addWindowArgs(args, window)

	var totals ViewerEventTotals
	if err := r.db.Raw(query, args).Scan(&totals).Error; err != nil {
		return nil, err
	}
	names, err := r.latestUserNames([]viewerKey{{Platform: platform, PlatformUserID: platformUserID}})
	if err != nil {
		return nil, err
	}
	totals.UserName = names[viewerKey{Platform: platform, PlatformUserID: platformUserID}]
	return &totals, nil
}

// Leaderboard ranks viewers by the summed amount of `eventType` events in the
// window (every event when nil), keeping those whose total is at least
// minTotal. Anonymous events have no platform_user_id and so rank nobody.
func (r *UserEventRepository) Leaderboard(eventType string, window *EventWindow, minTotal int64, limit int) ([]*LeaderboardEntry, error) {
	query := fmt.Sprintf(`SELECT platform, platform_user_id,
		CAST(COALESCE(SUM(amount), 0) AS BIGINT) AS total,
		COUNT(*) AS events
		FROM user_events
		WHERE event_type = @type AND platform_user_id IS NOT NULL AND %s
		GROUP BY platform, platform_user_id
		HAVING COALESCE(SUM(amount), 0) >= @min
		ORDER BY total DESC, platform ASC, platform_user_id ASC
		LIMIT @limit`, windowClause(window))

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
	keys := make([]viewerKey, 0, len(entries))
	for _, entry := range entries {
		keys = append(keys, viewerKey{Platform: entry.Platform, PlatformUserID: entry.PlatformUserID})
	}
	names, err := r.latestUserNames(keys)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		entry.UserName = names[viewerKey{Platform: entry.Platform, PlatformUserID: entry.PlatformUserID}]
	}
	return entries, nil
}

type viewerKey struct {
	Platform       string
	PlatformUserID string
}

// latestUserNames returns the name each viewer's most recent named event
// carried. Names change, so the newest one is the one to show; viewers whose
// events carried no name are absent from the map.
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
	err := r.db.Raw(`SELECT e.platform, e.platform_user_id, e.user_name
		FROM user_events e
		JOIN (
			SELECT platform, platform_user_id, MAX(occurred_at) AS latest
			FROM user_events
			WHERE platform_user_id IN @ids AND user_name IS NOT NULL
			GROUP BY platform, platform_user_id
		) l ON l.platform = e.platform
			AND l.platform_user_id = e.platform_user_id
			AND l.latest = e.occurred_at
		WHERE e.user_name IS NOT NULL
		ORDER BY e.platform, e.platform_user_id, e.user_name`,
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
		// the pick the same on every read.
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
