package models

// Built-in group names. These mirror Twitch's badge model and are seeded for
// every application, so a command can be bound to "subscriber" or "moderator"
// without the operator first having to create the group by hand.
//
// GroupEveryone is special: it stands for "any user at all". It has no
// membership rows - materialising one row per chatter would be unbounded and
// would go stale the moment someone new shows up. Instead the command
// permission sync translates a grant to this group into the Casbin wildcard
// subject (see WildcardSubject), so the enforcer answers "allow" for every
// subject without the membership table ever being consulted.
const (
	GroupEveryone    = "everyone"
	GroupSubscriber  = "subscriber"
	GroupVIP         = "vip"
	GroupModerator   = "moderator"
	GroupBroadcaster = "broadcaster"
)

// WildcardSubject is the Casbin subject that matches every user. The Casbin
// matcher (db/config/config.go) special-cases it; no "g" grouping rows are
// needed to make it resolve.
const WildcardSubject = "*"

// BuiltInGroup is one row of the seeded catalog.
type BuiltInGroup struct {
	Name        string
	Description string
	// TwitchDerived marks groups whose membership is owned by the Twitch
	// state sync rather than by manual add/remove. Operators can still read
	// the roster, but writing it by hand would just be overwritten on the
	// chatter's next message.
	TwitchDerived bool
}

// BuiltInGroups is the canonical catalog, in display order. Seeding, the
// backfill migration, and the Twitch sync all read this one list so they can
// never disagree about which groups exist or what they mean.
var BuiltInGroups = []BuiltInGroup{
	{
		Name:          GroupEveryone,
		Description:   "Everyone. Every user belongs to this group implicitly.",
		TwitchDerived: false,
	},
	{
		Name:          GroupSubscriber,
		Description:   "Users with an active Twitch subscription to the channel.",
		TwitchDerived: true,
	},
	{
		Name:          GroupVIP,
		Description:   "Users with the Twitch VIP badge in the channel.",
		TwitchDerived: true,
	},
	{
		Name:          GroupModerator,
		Description:   "Users with the Twitch moderator badge in the channel.",
		TwitchDerived: true,
	},
	{
		Name:          GroupBroadcaster,
		Description:   "The channel broadcaster.",
		TwitchDerived: true,
	},
}

// TwitchDerivedGroupNames returns the built-in groups whose membership the
// Twitch state sync owns.
func TwitchDerivedGroupNames() []string {
	names := make([]string, 0, len(BuiltInGroups))
	for _, g := range BuiltInGroups {
		if g.TwitchDerived {
			names = append(names, g.Name)
		}
	}
	return names
}

// IsBuiltInGroupName reports whether name is one of the seeded groups.
func IsBuiltInGroupName(name string) bool {
	for _, g := range BuiltInGroups {
		if g.Name == name {
			return true
		}
	}
	return false
}
