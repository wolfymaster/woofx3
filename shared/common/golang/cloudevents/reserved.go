package cloudevents

import "strings"

//go:generate go run ./internal/genreserved ../../contracts/reserved-subjects.json reserved_data.go

// Subject prefixes nothing a user or module authors may publish on: a
// workflow's publish_event step, or an event a module declares. The event
// type is the NATS subject it goes out on, so publishing here would let that
// code drive the engine rather than ask it (docs/services/engine-integrity.md).
// An entry ending in "." reserves that namespace (everything that starts with
// it); any other entry reserves exactly that name, so "message.send" leaves
// "message.sent" and "message.send.later" open.
//
// The lists live in shared/common/contracts/reserved-subjects.json, which the
// api and barkloader read too; reserved_data.go is generated from it.

// reservedSubjectsContract is the shape of reserved-subjects.json.
type reservedSubjectsContract struct {
	// CommandSubjectPrefixes are the subjects the engine and its services
	// treat as commands: forge outbox events (`db.`), change OBS (`engine.`),
	// call the Twitch API, speak in chat, play or skip alerts, or run
	// workflows and actions. Barkloader refuses an uploaded module that
	// declares one as an event.
	CommandSubjectPrefixes []string `json:"commandSubjectPrefixes"`
	// EngineAssertedPrefixes are the events engine services assert about the
	// platform and about themselves: a follow or a cheer, a stream going
	// live, a session boundary, a module installed, a run finished, a viewer
	// entering a segment. A workflow publishing one would forge that fact for
	// every workflow and service that acts on it.
	EngineAssertedPrefixes []string `json:"engineAssertedPrefixes"`
	// PlatformEventEntries are the reservations that hold platform events,
	// which a creator testing a workflow can fire through the api's
	// simulateTwitchEvent instead of publishing them.
	PlatformEventEntries []string `json:"platformEventEntries"`
	// UploadReservedPrefixes are the engine-asserted events an uploaded
	// module may not declare either, on top of the command subjects. Platform
	// events a platform module brings (channel., user.message, stream.online)
	// are left out; barkloader enforces this list.
	UploadReservedPrefixes []string `json:"uploadReservedPrefixes"`
	// EngineModuleSegments are the second tokens of the module.<segment>
	// subjects the engine publishes, which barkloader keeps out of the
	// module.<moduleId>. namespace an upload may declare events in.
	EngineModuleSegments []string `json:"engineModuleSegments"`
}

// CommandSubjectPrefixes and EngineEventSubjectPrefixes are the two tiers a
// workflow may not publish on; see reservedSubjectsContract.
var (
	CommandSubjectPrefixes     = reservedSubjects.CommandSubjectPrefixes
	EngineEventSubjectPrefixes = reservedSubjects.EngineAssertedPrefixes
)

var platformEventEntries = setOf(reservedSubjects.PlatformEventEntries)

func setOf(entries []string) map[string]bool {
	set := make(map[string]bool, len(entries))
	for _, entry := range entries {
		set[entry] = true
	}
	return set
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
