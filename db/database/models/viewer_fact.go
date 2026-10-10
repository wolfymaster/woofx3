package models

import (
	"encoding/json"
	"fmt"
	"time"
)

// FactDefinition is a running per-viewer aggregate defined as data: which
// trigger events feed it, which emitted field names the viewer, and how the
// matching events fold into one value. Defining a fact never needs a
// migration, because every fact's values share fact_values.
//
// Definition holds the FactDefinitionBody as JSON. ValueKind and WindowKind
// are derived from it and kept as columns so readers can select on them
// without decoding the body.
type FactDefinition struct {
	// ID is the canonical fact id, e.g. `woofx3:fact:messages` or
	// `user:fact:<slug>`.
	ID          string `gorm:"column:id;type:varchar(255);primaryKey"`
	Name        string `gorm:"column:name;type:text;not null"`
	Description string `gorm:"column:description;type:text;not null;default:''"`
	Definition  string `gorm:"column:definition;type:jsonb;not null"`
	// AggregateFn repeats Definition's aggregate.fn, so the apply path reads
	// it without decoding the body.
	AggregateFn string `gorm:"column:aggregate_fn;type:varchar(20);not null"`
	ValueKind   string `gorm:"column:value_kind;type:varchar(20);not null"`
	WindowKind  string `gorm:"column:window_kind;type:varchar(20);not null"`
	// Revision increments on every change to the definition. Values are
	// wiped in the same transaction, and a delta carrying an older revision
	// is dropped, so a value is only ever folded under one definition.
	Revision      int64  `gorm:"column:revision;not null;default:1"`
	CreatedByType string `gorm:"column:created_by_type;type:text;not null;default:'USER'"`
	CreatedByRef  string `gorm:"column:created_by_ref;type:text;not null;default:''"`
	// CountingSince is when the fact started counting live events. Chat is
	// not logged, so a chat fact cannot be backfilled and counts from here.
	CountingSince time.Time `gorm:"column:counting_since;not null"`
	// BackfilledThrough is how far a backfill from user_events has reached.
	// Nil means no backfill ran.
	BackfilledThrough *time.Time `gorm:"column:backfilled_through"`
	CreatedAt         time.Time  `gorm:"column:created_at;not null"`
	UpdatedAt         time.Time  `gorm:"column:updated_at;not null"`
}

func (FactDefinition) TableName() string {
	return "fact_definitions"
}

// FactValue is one viewer's value of one fact in one window.
//
// WindowKey is "" for a lifetime value and the stream session id for a
// session value. NumValue holds numbers and timestamps (epoch milliseconds);
// StrValue holds strings, and for the session aggregates the id of the last
// session counted.
type FactValue struct {
	FactID    string   `gorm:"column:fact_id;type:varchar(255);primaryKey"`
	Platform  string   `gorm:"column:platform;type:varchar(50);primaryKey"`
	SubjectID string   `gorm:"column:subject_id;type:varchar(100);primaryKey"`
	WindowKey string   `gorm:"column:window_key;type:varchar(100);primaryKey"`
	NumValue  *float64 `gorm:"column:num_value"`
	StrValue  *string  `gorm:"column:str_value"`
	// ValueAtMs is when the value was last folded, in epoch milliseconds:
	// the event time, or for the session aggregates the start of the session
	// counted. An event older than it does not replace a `last` value or a
	// counted session.
	ValueAtMs   *int64    `gorm:"column:value_at_ms"`
	SubjectName *string   `gorm:"column:subject_name;type:varchar(100)"`
	UpdatedAt   time.Time `gorm:"column:updated_at;not null"`
}

func (FactValue) TableName() string {
	return "fact_values"
}

// FactAppliedEvent records that an event's fact deltas were applied, so a
// redelivered event changes nothing.
type FactAppliedEvent struct {
	Source    string    `gorm:"column:source;type:varchar(255);primaryKey"`
	EventID   string    `gorm:"column:event_id;type:varchar(255);primaryKey"`
	AppliedAt time.Time `gorm:"column:applied_at;not null"`
}

func (FactAppliedEvent) TableName() string {
	return "fact_applied_events"
}

// Aggregate functions a fact can fold its events with.
const (
	FactAggregateCount         = "count"
	FactAggregateSum           = "sum"
	FactAggregateMin           = "min"
	FactAggregateMax           = "max"
	FactAggregateLast          = "last"
	FactAggregateFirstAt       = "first_at"
	FactAggregateLastAt        = "last_at"
	FactAggregateSessions      = "sessions"
	FactAggregateSessionStreak = "session_streak"
)

// Value kinds a fact's values are read as.
const (
	FactValueKindNumber    = "number"
	FactValueKindString    = "string"
	FactValueKindTimestamp = "timestamp"
)

// Windows a fact's values are kept per.
const (
	FactWindowLifetime = "lifetime"
	FactWindowSession  = "session"
)

// ValidFactAggregate reports whether fn is an aggregate function the engine
// can fold.
func ValidFactAggregate(fn string) bool {
	switch fn {
	case FactAggregateCount, FactAggregateSum, FactAggregateMin, FactAggregateMax,
		FactAggregateLast, FactAggregateFirstAt, FactAggregateLastAt,
		FactAggregateSessions, FactAggregateSessionStreak:
		return true
	default:
		return false
	}
}

// FactDefinitionBody is the JSON stored in FactDefinition.Definition.
type FactDefinitionBody struct {
	Sources   []FactSource  `json:"sources"`
	Aggregate FactAggregate `json:"aggregate"`
}

// FactSource is one trigger feeding a fact. Subject is the emits path naming
// the viewer; an array field fans one event out to every viewer in it. Value
// is the emits path the aggregate reads, empty for aggregates that read
// nothing (count, first_at, last_at, sessions, session_streak). Where is the
// condition tree an event must satisfy, kept as raw JSON because the workflow
// service evaluates it.
type FactSource struct {
	Trigger string          `json:"trigger"`
	Subject string          `json:"subject"`
	Where   json.RawMessage `json:"where,omitempty"`
	Value   string          `json:"value,omitempty"`
}

// FactAggregate names how a fact folds the events its sources match.
type FactAggregate struct {
	Fn string `json:"fn"`
}

// Body decodes Definition.
func (d *FactDefinition) Body() (*FactDefinitionBody, error) {
	var body FactDefinitionBody
	if err := json.Unmarshal([]byte(d.Definition), &body); err != nil {
		return nil, fmt.Errorf("fact definition %s: decode body: %w", d.ID, err)
	}
	return &body, nil
}
