// Package facts projects bus events onto per-viewer fact deltas.
//
// The db proxy owns fact definitions and fact values. This package holds the
// resolved definitions it lists, decides for each event which definitions and
// viewers the event touches, and sends the db one batch of deltas per event.
// The db does the arithmetic and the deduplication; nothing here reads or
// keeps a fact value.
package facts

import (
	"context"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/expression"
)

// Definition statuses as the db reports them. Only an active definition
// produces deltas; the others are listed so that a reader can say why a fact
// is not counting.
const (
	StatusActive     = "active"
	StatusUnresolved = "unresolved"
	StatusInvalid    = "invalid"
)

// Aggregate functions. The function is also the op of every delta a
// definition produces, and it decides which value a delta carries.
const (
	AggregateCount         = "count"
	AggregateSum           = "sum"
	AggregateMin           = "min"
	AggregateMax           = "max"
	AggregateLast          = "last"
	AggregateFirstAt       = "first_at"
	AggregateLastAt        = "last_at"
	AggregateSessions      = "sessions"
	AggregateSessionStreak = "session_streak"
)

// FactDefinition is one fact definition as ListFactDefinitions resolves it:
// each source's trigger is already resolved to the event pattern it fires on
// and to the paths its emits schema annotates.
type FactDefinition struct {
	ID string
	// Revision changes whenever the definition does; the db drops a delta
	// carrying an older revision.
	Revision     int64
	Aggregate    Aggregate
	Sources      []FactSource
	Status       string
	StatusReason string
}

// Aggregate is how a definition folds matching events into one value.
type Aggregate struct {
	Fn string
	// Path is the value path for every source that does not name its own.
	Path string
}

// FactSource is one trigger feeding a definition.
type FactSource struct {
	Trigger string
	// EventPattern is the trigger's event, a subject or a NATS-style pattern
	// matched against the event type.
	EventPattern string
	// IdentityPath reads the viewer id, or a list of viewer ids to fan out to.
	IdentityPath string
	// AnonymousWhenPath, when set, reads a boolean that is true for an event
	// with no real viewer behind it.
	AnonymousWhenPath string
	// DisplayNamePath, when set, reads the viewer's display name. Only a
	// single-viewer identity has one; ids read from a list carry no name.
	DisplayNamePath string
	// Where filters the trigger's events; nil matches every event.
	Where *expression.ConditionTree
	// Value is the path of the aggregated value; empty means Aggregate.Path.
	Value string
}

// ApplyFactDeltasRequest is every delta one event causes, applied by the db
// in one transaction and at most once per (Source, EventID).
type ApplyFactDeltasRequest struct {
	Source     string
	EventID    string
	OccurredAt time.Time
	// SessionStamp is the stream session the publisher stamped on the event,
	// the fallback for a session window when the db finds no session owning
	// OccurredAt.
	SessionStamp string
	// Silent applies the deltas without announcing any change they cause.
	Silent bool
	Deltas []FactDelta
}

// FactDelta is one event's contribution to one viewer's fact. Op is the
// definition's aggregate function; exactly one of Num and Str is set.
type FactDelta struct {
	FactID      string
	Revision    int64
	Platform    string
	SubjectID   string
	SubjectName string
	Op          string
	Num         *float64
	Str         *string
}

// Client is the part of the db proxy's fact service the projector uses.
type Client interface {
	ListFactDefinitions(ctx context.Context) ([]FactDefinition, error)
	ApplyFactDeltas(ctx context.Context, req *ApplyFactDeltasRequest) error
}
