package cloudevents

import "strings"

// Subject prefixes nothing a user or module authors may publish on: a
// workflow's publish_event step, or an event a module declares. The event
// type is the NATS subject it goes out on, so publishing here would let that
// code drive the engine rather than ask it (docs/services/engine-integrity.md).
// Entries are raw prefixes, matched with strings.HasPrefix: one ending in "."
// reserves a namespace, one without reserves that name and anything that
// starts with it.

// CommandSubjectPrefixes are the subjects the engine and its services treat as
// commands: forge outbox events (`db.`), change OBS (`engine.`, `slobs`), call
// the Twitch API, speak in chat, play or skip alerts, or run workflows and
// actions.
//
// Must match USER_RESERVED_EVENT_PREFIXES in
// barkloader/lib_module/src/manifest_validate.rs, which refuses uploaded
// modules that declare these events; reserved_test.go compares the two.
var CommandSubjectPrefixes = []string{
	"webhook.",
	"db.",
	"engine.",
	"slobs",
	"twitchapi",
	"message.send",
	"ui.notify.",
	"ui.alert.",
	"widget.queue.",
	"workflow.execute",
	"workflow.replay",
	"action.execute",
}

// EngineEventSubjectPrefixes are the events engine services assert about the
// platform and about themselves: a follow or a cheer, a stream going live, a
// session boundary, a module installed, a run finished. A workflow publishing
// one would forge that fact for every workflow and service that acts on it.
// Modules are not held to this tier: a platform module declares the platform
// events it brings, which is what CommandSubjectPrefixes leaves room for.
var EngineEventSubjectPrefixes = []string{
	"HEARTBEAT",
	"MESSAGEBUS_INIT",
	"barkloader.",
	"channel.",
	"channelpoints.",
	"chat.command.",
	"module.",
	"reward",
	"session.",
	"setting.",
	"stream.offline",
	"stream.online",
	"user.message",
	"widget.event",
	"woofwoofwoof",
	"workflow.run.",
}

// ReservedSubjectMatch reports whether a workflow may not publish subject and,
// if so, the reserved prefix it falls under, for an error message that tells
// the author what to rename.
func ReservedSubjectMatch(subject string) (string, bool) {
	for _, prefixes := range [][]string{CommandSubjectPrefixes, EngineEventSubjectPrefixes} {
		for _, prefix := range prefixes {
			if strings.HasPrefix(subject, prefix) {
				return prefix, true
			}
		}
	}
	return "", false
}
