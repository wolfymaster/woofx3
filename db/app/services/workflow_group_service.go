package services

import (
	"errors"
)

// groupChange is what happens to one workflow when a group that is on takes
// it (switched on, or the workflow added) or lets it go (switched off, the
// workflow removed, or the group deleted).
type groupChange int

const (
	groupHolds groupChange = iota + 1
	groupReleases
)

// errHeldStateBroken reports a workflow whose saved state disagrees with
// whether a group that is on contains it. The start-up invariant check
// repairs such rows; a group switch refuses to build on one.
var errHeldStateBroken = errors.New("saved pre-group state disagrees with the groups holding the workflow")

// nextState carries the whole alert group rule for one workflow. enabled and
// saved are its enabled and pre_group_enabled columns; heldElsewhere is
// whether a group other than the changing one contains it while on.
//
// A hold saves the workflow's own state only when no other group already
// holds it, so a later group never saves a state an earlier one forced, and
// then switches it on. A release puts the saved state back only when no
// other group still holds it; otherwise "on always wins" and nothing moves.
func nextState(change groupChange, enabled bool, saved *bool, heldElsewhere bool) (bool, *bool, error) {
	switch change {
	case groupHolds:
		if heldElsewhere != (saved != nil) {
			return enabled, saved, errHeldStateBroken
		}
		if !heldElsewhere {
			own := enabled
			saved = &own
		}
		return true, saved, nil
	case groupReleases:
		// The releasing group held the workflow until now.
		if saved == nil {
			return enabled, saved, errHeldStateBroken
		}
		if heldElsewhere {
			return enabled, saved, nil
		}
		return *saved, nil, nil
	}
	return enabled, saved, errors.New("unknown group change")
}

// manualState is a streamer switching a workflow on or off themselves. While
// a group holds it the switch also becomes the state restored later, so the
// manual choice wins once the groups let go.
func manualState(value bool, saved *bool) (bool, *bool) {
	if saved == nil {
		return value, nil
	}
	restored := value
	return value, &restored
}
