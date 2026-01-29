package main

// EventPatternRegistry manages NATS subscription patterns for workflow triggers
// This allows us to efficiently subscribe to event types without using a full wildcard
type EventPatternRegistry struct {
	patterns []string
}

// NewEventPatternRegistry creates a new registry with default event patterns
// Currently configured for Twitch events, but extensible for other event sources
func NewEventPatternRegistry() *EventPatternRegistry {
	return &EventPatternRegistry{
		patterns: []string{
			"*.user.twitch",    // Twitch user events (cheers, follows, subscribes, etc.)
			"*.channel.twitch", // Twitch channel events (hype trains, stream status, etc.)
			// Future: Add patterns for other event sources as needed:
			// "*.discord",        // Discord events
			// "*.obs",            // OBS events
			// "*.database",       // Database change events
		},
	}
}

// GetPatterns returns the list of NATS subscription patterns
func (r *EventPatternRegistry) GetPatterns() []string {
	return r.patterns
}

// AddPattern adds a new subscription pattern to the registry
func (r *EventPatternRegistry) AddPattern(pattern string) {
	r.patterns = append(r.patterns, pattern)
}