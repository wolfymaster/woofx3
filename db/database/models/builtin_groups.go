package models

// Built-in group names. These are seeded for every application, so a command
// can be bound to "subscriber" or "moderator" without the operator first
// having to create the group by hand. The names describe roles a chat platform
// may report; nothing here is specific to one platform.
//
// GroupEveryone is special: it stands for "any user at all". It has no
// membership rows - materialising one row per chatter would be unbounded and
// would go stale the moment someone new shows up. Instead the command
// permission sync translates a grant to this group into the Casbin wildcard
// subject (see WildcardSubject), so the enforcer answers "allow" for every
// subject without the membership table ever being consulted.
const (
	GroupEveryone    = "everyone"
	GroupFollower    = "follower"
	GroupSubscriber  = "subscriber"
	GroupVIP         = "vip"
	GroupModerator   = "moderator"
	GroupBroadcaster = "broadcaster"
)

// Subscription tier groups. A tier N subscriber is written into both
// GroupSubscriber and the matching tier group, so a grant to plain
// "subscriber" keeps matching every subscriber regardless of tier while
// "tier 2 and above" is expressed by granting tier2 and tier3 together.
//
// Nothing in the enforcement path orders these or parses the names: ordering
// would require the engine to know each platform's tier hierarchy, and it does
// not. A platform with no tiers writes only GroupSubscriber, leaving these
// empty, so a grant to one correctly matches nobody.
const (
	GroupSubscriberTier1 = "subscriber_tier1"
	GroupSubscriberTier2 = "subscriber_tier2"
	GroupSubscriberTier3 = "subscriber_tier3"
)

// WildcardSubject is the Casbin subject that matches every user. The Casbin
// matcher (db/config/config.go) special-cases it; no "g" grouping rows are
// needed to make it resolve.
const WildcardSubject = "*"

// BuiltInGroup is one row of the seeded catalog.
type BuiltInGroup struct {
	Name        string
	Description string
	// PlatformDerived marks groups whose membership is owned by the chat
	// platform sync rather than by manual add/remove. Operators can still
	// read the roster, but writing it by hand would just be overwritten on
	// the chatter's next message.
	PlatformDerived bool
}

// BuiltInGroups is the canonical catalog, in display order. Seeding, the
// backfill migration, and the platform membership sync all read this one list
// so they can never disagree about which groups exist or what they mean.
var BuiltInGroups = []BuiltInGroup{
	{
		Name:            GroupEveryone,
		Description:     "Everyone. Every user belongs to this group implicitly.",
		PlatformDerived: false,
	},
	{
		Name:            GroupFollower,
		Description:     "Users who follow the channel.",
		PlatformDerived: true,
	},
	{
		Name:            GroupSubscriber,
		Description:     "Users with an active paid subscription to the channel.",
		PlatformDerived: true,
	},
	{
		Name:            GroupSubscriberTier1,
		Description:     "Subscribers on the channel's first subscription tier.",
		PlatformDerived: true,
	},
	{
		Name:            GroupSubscriberTier2,
		Description:     "Subscribers on the channel's second subscription tier.",
		PlatformDerived: true,
	},
	{
		Name:            GroupSubscriberTier3,
		Description:     "Subscribers on the channel's third subscription tier.",
		PlatformDerived: true,
	},
	{
		Name:            GroupVIP,
		Description:     "Users the channel has granted VIP status.",
		PlatformDerived: true,
	},
	{
		Name:            GroupModerator,
		Description:     "Users who moderate the channel.",
		PlatformDerived: true,
	},
	{
		Name:            GroupBroadcaster,
		Description:     "The channel broadcaster.",
		PlatformDerived: true,
	},
}

// PlatformDerivedGroupNames returns the built-in groups whose membership the
// platform membership sync owns.
func PlatformDerivedGroupNames() []string {
	names := make([]string, 0, len(BuiltInGroups))
	for _, g := range BuiltInGroups {
		if g.PlatformDerived {
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
