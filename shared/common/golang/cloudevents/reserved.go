package cloudevents

import "strings"

// Subject prefixes nothing a user or module authors may publish on: a
// workflow's publish_event step, or an event a module declares. The event
// type is the NATS subject it goes out on, so publishing here would let that
// code drive the engine rather than ask it (docs/services/engine-integrity.md).
// An entry ending in "." reserves that namespace (everything that starts with
// it); any other entry reserves exactly that name, so "reward" leaves
// "rewards.x" and "reward.granted" open.

// CommandSubjectPrefixes are the subjects the engine and its services treat as
// commands: forge outbox events (`db.`), change OBS (`engine.`, `slobs`), call
// the Twitch API, speak in chat, play or skip alerts, or run workflows and
// actions.
//
// Must match USER_RESERVED_EVENT_PREFIXES in
// barkloader/lib_module/src/manifest_validate.rs, which refuses uploaded
// modules that declare these events; reserved_test.go compares the two.
// Barkloader matches every entry as a prefix, so it is the stricter of the two
// on the exact-name entries.
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
	"workflow.cancel",
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
	"workflow.run.",
}

// platformEventEntries are the reservations that hold platform events, which a
// creator testing a workflow can fire through the api's simulateTwitchEvent
// instead of publishing them.
var platformEventEntries = map[string]bool{
	"channel.":       true,
	"channelpoints.": true,
	"chat.command.":  true,
	"stream.offline": true,
	"stream.online":  true,
	"user.message":   true,
}

// ReservedSubjectMatch reports whether a workflow may not publish subject and,
// if so, the reserved entry it falls under, for an error message that tells
// the author what to rename.
func ReservedSubjectMatch(subject string) (string, bool) {
	for _, entries := range [][]string{CommandSubjectPrefixes, EngineEventSubjectPrefixes} {
		for _, entry := range entries {
			if entryMatches(entry, subject) {
				return entry, true
			}
		}
	}
	return "", false
}

// IsPlatformEventReservation reports whether a reserved entry holds platform
// events, so an error can point the author at simulateTwitchEvent.
func IsPlatformEventReservation(entry string) bool {
	return platformEventEntries[entry]
}

func entryMatches(entry, subject string) bool {
	if strings.HasSuffix(entry, ".") {
		return strings.HasPrefix(subject, entry)
	}
	return subject == entry
}
