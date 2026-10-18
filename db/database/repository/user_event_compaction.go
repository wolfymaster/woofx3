package repository

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// ErrStreamSessionOpen is returned for a request that needs a closed session:
// the open one still owns the present, so its time is not yet settled.
var ErrStreamSessionOpen = errors.New("stream session is still open")

// ErrCompactionPruned is returned for a request to compact a session again
// once its raw rows have begun to be pruned: rebuilding the copy from what is
// left would lose what was pruned.
var ErrCompactionPruned = errors.New("stream session's raw events are already pruned")

// uncoveredByCompaction is true for a user_events row, aliased `e`, that no
// compaction covers. The lifetime reads take every covered row from the
// compact tables instead, so they give one answer whether the raw row has been
// pruned or not.
const uncoveredByCompaction = `NOT EXISTS (SELECT 1 FROM stream_session_compactions cov
	WHERE e.occurred_at >= cov.window_started_at AND e.occurred_at < cov.window_ended_at)`

// CompactionResult is what one compaction wrote.
type CompactionResult struct {
	Compaction     *models.StreamSessionCompaction
	Viewers        int64
	TimelineEvents int64
}

// Compaction returns the record of the session's compaction, or nil when it
// was never compacted.
func (r *UserEventRepository) Compaction(sessionID uuid.UUID) (*models.StreamSessionCompaction, error) {
	var found []models.StreamSessionCompaction
	if err := r.db.Where("session_id = ?", sessionID).Limit(1).Find(&found).Error; err != nil {
		return nil, err
	}
	if len(found) == 0 {
		return nil, nil
	}
	return &found[0], nil
}

// Compact rebuilds the closed session's compact rows from user_events as it
// stands: one viewer_session_totals row per viewer with any event in the
// session, and one session_timeline_events row per event SessionEvents lists.
// The previous copy is deleted and the new one written in one transaction, so
// a reader sees one or the other, and compacting again after the raw log
// changed (a late event, a session whose bounds moved) brings the copy up to
// date. Returns gorm.ErrRecordNotFound for an unknown session,
// ErrStreamSessionOpen for the open one, and ErrCompactionPruned once the
// pruner has started on the session's raw rows.
//
// The rows are selected through the compaction record's window rather than
// bound parameters, so they are exactly the rows the lifetime reads and the
// pruner treat as covered.
func (r *UserEventRepository) Compact(sessionID uuid.UUID, now time.Time) (*CompactionResult, error) {
	var result CompactionResult
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var session models.StreamSession
		if err := tx.Where("id = ?", sessionID).First(&session).Error; err != nil {
			return err
		}
		if session.Status != models.StreamSessionStatusClosed || session.EndedAt == nil {
			return ErrStreamSessionOpen
		}

		var previous []models.StreamSessionCompaction
		if err := tx.Where("session_id = ?", sessionID).Find(&previous).Error; err != nil {
			return err
		}
		if len(previous) > 0 && previous[0].PrunedAt != nil {
			return ErrCompactionPruned
		}
		for _, table := range []string{"session_timeline_events", "viewer_session_totals"} {
			if err := tx.Exec("DELETE FROM "+table+" WHERE session_id = ?", sessionID).Error; err != nil {
				return fmt.Errorf("clear %s: %w", table, err)
			}
		}
		// Conditional, so a prune that marked the record after it was read
		// above is not undone: the delete then misses, and the transaction
		// rolls back with the copy as it was.
		cleared := tx.Exec("DELETE FROM stream_session_compactions WHERE session_id = ? AND pruned_at IS NULL", sessionID)
		if cleared.Error != nil {
			return fmt.Errorf("clear stream_session_compactions: %w", cleared.Error)
		}
		if int(cleared.RowsAffected) != len(previous) {
			return ErrCompactionPruned
		}

		compaction := &models.StreamSessionCompaction{
			SessionID:       session.ID,
			WindowStartedAt: session.StartedAt.UTC(),
			WindowEndedAt:   session.EndedAt.UTC(),
			CompactedAt:     now.UTC(),
		}
		if err := tx.Create(compaction).Error; err != nil {
			return fmt.Errorf("record compaction: %w", err)
		}

		args := eventTypeArgs()
		args["session"] = session.ID
		args["types"] = sessionEventTypes()

		timeline := tx.Exec(fmt.Sprintf(`INSERT INTO session_timeline_events (session_id, user_event_id,
			event_id, source, event_type, platform, platform_user_id, user_name, stamped_session_id,
			amount, occurred_at, recorded_at)
			SELECT c.session_id, e.id, e.event_id, e.source, e.event_type, e.platform, e.platform_user_id,
				e.user_name, e.session_id, e.amount, e.occurred_at, e.created_at
			FROM user_events e
			JOIN stream_session_compactions c
				ON e.occurred_at >= c.window_started_at AND e.occurred_at < c.window_ended_at
			WHERE c.session_id = @session AND e.event_type IN @types
				AND NOT (e.event_type = @subscribe AND COALESCE(%s, FALSE))`, r.isGiftedSub()), args)
		if timeline.Error != nil {
			return fmt.Errorf("copy timeline: %w", timeline.Error)
		}

		// A viewer's name is the one on their latest named event; the
		// subquery breaks a tie at that instant the way latestUserNames does.
		viewers := tx.Exec(fmt.Sprintf(`INSERT INTO viewer_session_totals (session_id, platform,
			platform_user_id, user_name, last_named_at, bits, cheers, gifted_subs, gifts, subs)
			SELECT t.session_id, t.platform, t.platform_user_id,
				(SELECT MIN(n.user_name) FROM user_events n
					WHERE n.platform = t.platform AND n.platform_user_id = t.platform_user_id
						AND n.occurred_at = t.last_named_at AND n.user_name IS NOT NULL),
				t.last_named_at, t.bits, t.cheers, t.gifted_subs, t.gifts, t.subs
			FROM (
				SELECT c.session_id, e.platform, e.platform_user_id,
					MAX(CASE WHEN e.user_name IS NOT NULL THEN e.occurred_at END) AS last_named_at,
					CAST(COALESCE(SUM(CASE WHEN e.event_type = @cheer THEN e.amount END), 0) AS BIGINT) AS bits,
					COUNT(CASE WHEN e.event_type = @cheer THEN 1 END) AS cheers,
					CAST(COALESCE(SUM(CASE WHEN e.event_type = @gift THEN e.amount END), 0) AS BIGINT) AS gifted_subs,
					COUNT(CASE WHEN e.event_type = @gift THEN 1 END) AS gifts,
					COUNT(CASE WHEN e.event_type = @resub
						OR (e.event_type = @subscribe AND NOT COALESCE(%s, FALSE)) THEN 1 END) AS subs
				FROM user_events e
				JOIN stream_session_compactions c
					ON e.occurred_at >= c.window_started_at AND e.occurred_at < c.window_ended_at
				WHERE c.session_id = @session AND e.platform_user_id IS NOT NULL
				GROUP BY c.session_id, e.platform, e.platform_user_id
			) t`, r.isGiftedSub()), args)
		if viewers.Error != nil {
			return fmt.Errorf("copy viewer totals: %w", viewers.Error)
		}

		result = CompactionResult{
			Compaction:     compaction,
			Viewers:        viewers.RowsAffected,
			TimelineEvents: timeline.RowsAffected,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// SessionsToCompact returns closed sessions whose compact rows are missing or
// out of date, oldest first, at most `limit`: never compacted, compacted with
// bounds the session no longer has, or holding a raw event recorded after the
// compaction (a write retried across the session's end). A session whose raw
// rows have begun to be pruned is never returned: its copy cannot be rebuilt.
func (r *UserEventRepository) SessionsToCompact(limit int) ([]uuid.UUID, error) {
	ids := []uuid.UUID{}
	err := r.db.Raw(`SELECT s.id FROM stream_sessions s
		LEFT JOIN stream_session_compactions c ON c.session_id = s.id
		WHERE s.status = @closed AND s.ended_at IS NOT NULL AND (
			c.session_id IS NULL
			OR (c.pruned_at IS NULL AND (
				c.window_started_at <> s.started_at
				OR c.window_ended_at <> s.ended_at
				OR EXISTS (SELECT 1 FROM user_events e
					WHERE e.occurred_at >= c.window_started_at AND e.occurred_at < c.window_ended_at
						AND e.created_at > c.compacted_at)
			))
		)
		ORDER BY s.started_at ASC
		LIMIT @limit`,
		map[string]interface{}{"closed": models.StreamSessionStatusClosed, "limit": limit}).
		Scan(&ids).Error
	return ids, err
}

// PruneCompactedEvents deletes user_events rows that occurred before `before`
// and are covered by a compaction made after they were recorded,
// `batchSize` rows per statement, and returns how many it deleted.
//
// A row is attributed to a session by the time it occurred in, never by its
// stamp, so a row in the open session's time, in a closed session not yet
// compacted, or before the first session began is not covered and stays. A
// row recorded after its session was compacted is not in the copy, so it
// stays too.
//
// Each batch first marks the compactions it may delete from as pruned, in the
// same transaction, so a compaction is never rebuilt from a window that has
// lost rows (see Compact).
func (r *UserEventRepository) PruneCompactedEvents(before time.Time, batchSize int, now time.Time) (int64, error) {
	if batchSize < 1 {
		return 0, fmt.Errorf("prune batch size must be at least 1, got %d", batchSize)
	}
	args := map[string]interface{}{"before": before.UTC(), "limit": batchSize, "now": now.UTC()}
	var total int64
	for {
		var deleted int64
		err := r.db.Transaction(func(tx *gorm.DB) error {
			marked := tx.Exec(`UPDATE stream_session_compactions SET pruned_at = @now
				WHERE pruned_at IS NULL AND window_started_at < @before
					AND EXISTS (SELECT 1 FROM user_events e
						WHERE e.occurred_at >= stream_session_compactions.window_started_at
							AND e.occurred_at < stream_session_compactions.window_ended_at
							AND e.occurred_at < @before
							AND e.created_at <= stream_session_compactions.compacted_at)`, args)
			if marked.Error != nil {
				return marked.Error
			}
			result := tx.Exec(`DELETE FROM user_events WHERE id IN (
				SELECT e.id FROM user_events e
				JOIN stream_session_compactions c
					ON e.occurred_at >= c.window_started_at AND e.occurred_at < c.window_ended_at
				WHERE e.occurred_at < @before AND e.created_at <= c.compacted_at
					AND c.pruned_at IS NOT NULL
				LIMIT @limit)`, args)
			if result.Error != nil {
				return result.Error
			}
			deleted = result.RowsAffected
			return nil
		})
		if err != nil {
			return total, err
		}
		total += deleted
		if deleted < int64(batchSize) {
			return total, nil
		}
	}
}

// CompactedTotals is Totals for a compacted session, from its timeline. The
// timeline holds every event Totals counts and nothing else, anonymous ones
// included, so the two agree.
func (r *UserEventRepository) CompactedTotals(sessionID uuid.UUID) (*SessionEventTotals, error) {
	args := eventTypeArgs()
	args["session"] = sessionID
	var totals SessionEventTotals
	err := r.db.Raw(`SELECT
		CAST(COALESCE(SUM(CASE WHEN event_type = @cheer THEN amount END), 0) AS BIGINT) AS bits,
		COUNT(CASE WHEN event_type = @cheer THEN 1 END) AS cheers,
		COUNT(CASE WHEN event_type = @resub OR event_type = @subscribe THEN 1 END) AS subs,
		CAST(COALESCE(SUM(CASE WHEN event_type = @gift THEN amount END), 0) AS BIGINT) AS gifted_subs,
		COUNT(CASE WHEN event_type = @follow THEN 1 END) AS follows,
		COUNT(CASE WHEN event_type = @raid THEN 1 END) AS raids,
		CAST(COALESCE(SUM(CASE WHEN event_type = @raid THEN amount END), 0) AS BIGINT) AS raiders
		FROM session_timeline_events
		WHERE session_id = @session`, args).Scan(&totals).Error
	if err != nil {
		return nil, err
	}
	return &totals, nil
}

// CompactedSessionEvents is SessionEvents for a compacted session, in the same
// order, with each event's payload left empty.
func (r *UserEventRepository) CompactedSessionEvents(sessionID uuid.UUID, limit int) ([]*models.UserEvent, int64, error) {
	span := r.db.Model(&models.SessionTimelineEvent{}).Where("session_id = ?", sessionID)
	var total int64
	if err := span.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	rows := []*models.SessionTimelineEvent{}
	if err := span.Session(&gorm.Session{}).
		Order("occurred_at ASC").
		Order("user_event_id ASC").
		Limit(limit).
		Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	events := make([]*models.UserEvent, 0, len(rows))
	for _, row := range rows {
		events = append(events, row.AsUserEvent())
	}
	return events, total, nil
}

// CompactedViewerTotals is ViewerTotals for one compacted session. A viewer
// with no row in it gave nothing in it.
func (r *UserEventRepository) CompactedViewerTotals(sessionID uuid.UUID, platform, platformUserID string) (*ViewerEventTotals, error) {
	var totals ViewerEventTotals
	err := r.db.Raw(`SELECT
		CAST(COALESCE(SUM(bits), 0) AS BIGINT) AS bits,
		CAST(COALESCE(SUM(cheers), 0) AS BIGINT) AS cheers,
		CAST(COALESCE(SUM(gifted_subs), 0) AS BIGINT) AS gifted_subs,
		CAST(COALESCE(SUM(gifts), 0) AS BIGINT) AS gifts
		FROM viewer_session_totals
		WHERE session_id = @session AND platform = @platform AND platform_user_id = @user`,
		map[string]interface{}{"session": sessionID, "platform": platform, "user": platformUserID}).
		Scan(&totals).Error
	if err != nil {
		return nil, err
	}
	if err := r.nameViewer(platform, platformUserID, &totals); err != nil {
		return nil, err
	}
	return &totals, nil
}

// CompactedLeaderboard is Leaderboard for one compacted session.
func (r *UserEventRepository) CompactedLeaderboard(sessionID uuid.UUID, eventType string, minTotal int64, limit int) ([]*LeaderboardEntry, error) {
	columns, err := leaderboardColumnsFor(eventType)
	if err != nil {
		return nil, err
	}
	entries := []*LeaderboardEntry{}
	err = r.db.Raw(fmt.Sprintf(`SELECT platform, platform_user_id, %[1]s AS total, %[2]s AS events
		FROM viewer_session_totals
		WHERE session_id = @session AND %[2]s > 0 AND %[1]s >= @min
		ORDER BY total DESC, platform ASC, platform_user_id ASC
		LIMIT @limit`, columns.total, columns.events),
		map[string]interface{}{"session": sessionID, "min": minTotal, "limit": limit}).
		Scan(&entries).Error
	if err != nil {
		return nil, err
	}
	if err := r.nameEntries(entries); err != nil {
		return nil, err
	}
	return entries, nil
}

// leaderboardColumns are the viewer_session_totals columns a leaderboard of
// one event type ranks by: the summed amount, and the events summed.
type leaderboardColumns struct {
	total  string
	events string
}

func leaderboardColumnsFor(eventType string) (leaderboardColumns, error) {
	switch eventType {
	case models.UserEventTypeCheer:
		return leaderboardColumns{total: "bits", events: "cheers"}, nil
	case models.UserEventTypeSubscriptionGift:
		return leaderboardColumns{total: "gifted_subs", events: "gifts"}, nil
	default:
		return leaderboardColumns{}, fmt.Errorf("no leaderboard for event type %q", eventType)
	}
}
