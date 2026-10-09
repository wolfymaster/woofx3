package database

// SQLiteTimestampLayout is how the engine writes a SQLite timestamp column:
// UTC with six fractional digits and an explicit offset, a layout the driver
// decodes into time.Time. Fixed width and one zone, so stored values sort as
// text in time order.
//
// The alert repository stamps its rows in it, and migration
// 0055_alert_timestamps_utc rewrites older alert rows into it. Changing it
// needs a migration that rewrites the rows already stored.
const SQLiteTimestampLayout = "2006-01-02 15:04:05.000000-07:00"
