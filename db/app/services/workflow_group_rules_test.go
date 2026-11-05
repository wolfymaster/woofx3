package services

import (
	"errors"
	"testing"
)

// groupSim plays the alert group rule for one workflow X against any number
// of groups, through nextState and manualState only, so the edge-case table
// is checked without a database.
type groupSim struct {
	t       *testing.T
	enabled bool
	saved   *bool
	on      map[string]bool
	hasX    map[string]bool
}

func newGroupSim(t *testing.T, enabled bool, groups ...string) *groupSim {
	sim := &groupSim{t: t, enabled: enabled, on: map[string]bool{}, hasX: map[string]bool{}}
	for _, g := range groups {
		sim.hasX[g] = true
	}
	return sim
}

func (s *groupSim) heldExcept(group string) bool {
	for g, on := range s.on {
		if on && g != group && s.hasX[g] {
			return true
		}
	}
	return false
}

func (s *groupSim) apply(change groupChange, group string) {
	s.t.Helper()
	enabled, saved, err := nextState(change, s.enabled, s.saved, s.heldExcept(group))
	if err != nil {
		s.t.Fatalf("nextState: %v", err)
	}
	s.enabled, s.saved = enabled, saved
}

func (s *groupSim) switchOn(group string) {
	s.t.Helper()
	if s.on[group] {
		return
	}
	if s.hasX[group] {
		s.apply(groupHolds, group)
	}
	s.on[group] = true
}

func (s *groupSim) switchOff(group string) {
	s.t.Helper()
	if !s.on[group] {
		return
	}
	if s.hasX[group] {
		s.apply(groupReleases, group)
	}
	s.on[group] = false
}

func (s *groupSim) add(group string) {
	s.t.Helper()
	if s.hasX[group] {
		return
	}
	if s.on[group] {
		s.apply(groupHolds, group)
	}
	s.hasX[group] = true
}

func (s *groupSim) remove(group string) {
	s.t.Helper()
	if !s.hasX[group] {
		return
	}
	if s.on[group] {
		s.apply(groupReleases, group)
	}
	s.hasX[group] = false
}

func (s *groupSim) deleteGroup(group string) {
	s.t.Helper()
	s.remove(group)
	delete(s.on, group)
	delete(s.hasX, group)
}

func (s *groupSim) manual(value bool) {
	s.enabled, s.saved = manualState(value, s.saved)
}

func (s *groupSim) expect(step string, enabled bool, saved *bool) {
	s.t.Helper()
	if s.enabled != enabled {
		s.t.Errorf("%s: enabled = %v, want %v", step, s.enabled, enabled)
	}
	switch {
	case saved == nil && s.saved != nil:
		s.t.Errorf("%s: saved = %v, want none", step, *s.saved)
	case saved != nil && s.saved == nil:
		s.t.Errorf("%s: saved = none, want %v", step, *saved)
	case saved != nil && *saved != *s.saved:
		s.t.Errorf("%s: saved = %v, want %v", step, *s.saved, *saved)
	}
	// The invariant: a saved state exists exactly while a group that is on holds X.
	if (s.saved != nil) != s.heldExcept("") {
		s.t.Errorf("%s: saved state present = %v, but held = %v", step, s.saved != nil, s.heldExcept(""))
	}
}

var (
	savedOff = boolPtr(false)
	savedOn  = boolPtr(true)
)

func boolPtr(v bool) *bool {
	return &v
}

// The rows are the alert group edge-case table. Rows 17 (delete the trigger),
// 18 (engine restart) and 19 (merge) need a database and are covered by the
// service tests.
func TestWorkflowGroupRules(t *testing.T) {
	tests := []struct {
		row  string
		play func(s *groupSim)
	}{
		{"1 basic", func(s *groupSim) {
			s.enabled = false
			s.add("A")
			s.switchOn("A")
			s.expect("A on", true, savedOff)
			s.switchOff("A")
			s.expect("A off", false, nil)
		}},
		{"2 already on", func(s *groupSim) {
			s.enabled = true
			s.add("A")
			s.switchOn("A")
			s.expect("A on", true, savedOn)
			s.switchOff("A")
			s.expect("A off", true, nil)
		}},
		{"3 overlap", func(s *groupSim) {
			s.add("A")
			s.add("B")
			s.switchOn("A")
			s.switchOn("B")
			s.expect("B on", true, savedOff)
			s.switchOff("A")
			s.expect("A off", true, savedOff)
			s.switchOff("B")
			s.expect("B off", false, nil)
		}},
		{"4 overlap, other order", func(s *groupSim) {
			s.add("A")
			s.add("B")
			s.switchOn("A")
			s.switchOn("B")
			s.switchOff("B")
			s.expect("B off", true, savedOff)
			s.switchOff("A")
			s.expect("A off", false, nil)
		}},
		{"5 overlap, X originally on", func(s *groupSim) {
			s.enabled = true
			s.add("A")
			s.add("B")
			s.switchOn("A")
			s.expect("A on", true, savedOn)
			s.switchOn("B")
			s.expect("B on", true, savedOn)
			s.switchOff("A")
			s.expect("A off", true, savedOn)
			s.switchOff("B")
			s.expect("B off", true, nil)
		}},
		{"6 later group never captures forced state", func(s *groupSim) {
			s.add("A")
			s.add("B")
			s.switchOn("A")
			s.switchOn("B")
			s.expect("B on", true, savedOff)
		}},
		{"7 manual on while held", func(s *groupSim) {
			s.add("A")
			s.switchOn("A")
			s.manual(true)
			s.expect("manual on", true, savedOn)
			s.switchOff("A")
			s.expect("A off", true, nil)
		}},
		{"8 manual off while held", func(s *groupSim) {
			s.enabled = true
			s.add("A")
			s.switchOn("A")
			s.manual(false)
			s.expect("manual off", false, savedOff)
			s.switchOff("A")
			s.expect("A off", false, nil)
		}},
		{"9 manual toggle, not held", func(s *groupSim) {
			s.add("A")
			s.manual(true)
			s.expect("manual on", true, nil)
			s.manual(false)
			s.expect("manual off", false, nil)
		}},
		{"10 manual off, then another group", func(s *groupSim) {
			s.add("A")
			s.add("B")
			s.switchOn("A")
			s.manual(false)
			s.expect("manual off", false, savedOff)
			s.switchOn("B")
			s.expect("B on", true, savedOff)
			s.switchOff("B")
			s.expect("B off", true, savedOff)
			s.switchOff("A")
			s.expect("A off", false, nil)
		}},
		{"11 add to an on group", func(s *groupSim) {
			s.switchOn("A")
			s.add("A")
			s.expect("added", true, savedOff)
		}},
		{"11 add to an on group, already held", func(s *groupSim) {
			s.enabled = true
			s.add("B")
			s.switchOn("B")
			s.manual(false)
			s.switchOn("A")
			s.add("A")
			s.expect("added", true, savedOff)
		}},
		{"12 add to an off group", func(s *groupSim) {
			s.add("A")
			s.expect("added", false, nil)
		}},
		{"13 remove from an on group", func(s *groupSim) {
			s.add("A")
			s.switchOn("A")
			s.remove("A")
			s.expect("removed", false, nil)
		}},
		{"13 remove from an on group, still held", func(s *groupSim) {
			s.add("A")
			s.add("B")
			s.switchOn("A")
			s.switchOn("B")
			s.remove("A")
			s.expect("removed", true, savedOff)
		}},
		{"14 remove from an off group", func(s *groupSim) {
			s.enabled = true
			s.add("A")
			s.remove("A")
			s.expect("removed", true, nil)
		}},
		{"15 delete an on group", func(s *groupSim) {
			s.add("A")
			s.switchOn("A")
			s.deleteGroup("A")
			s.expect("deleted", false, nil)
		}},
		{"16 delete an off group", func(s *groupSim) {
			s.enabled = true
			s.add("A")
			s.deleteGroup("A")
			s.expect("deleted", true, nil)
		}},
		{"20 group has no members", func(s *groupSim) {
			s.enabled = true
			s.switchOn("A")
			s.expect("A on", true, nil)
			s.switchOff("A")
			s.expect("A off", true, nil)
		}},
		{"idempotent switch", func(s *groupSim) {
			s.add("A")
			s.switchOn("A")
			s.switchOn("A")
			s.expect("on twice", true, savedOff)
			s.switchOff("A")
			s.switchOff("A")
			s.expect("off twice", false, nil)
		}},
	}
	for _, tc := range tests {
		t.Run(tc.row, func(t *testing.T) {
			tc.play(newGroupSim(t, false))
		})
	}
}

func TestNextStateRefusesABrokenSavedState(t *testing.T) {
	tests := []struct {
		name          string
		change        groupChange
		saved         *bool
		heldElsewhere bool
	}{
		{"hold, held elsewhere with no saved state", groupHolds, nil, true},
		{"hold, a saved state while held nowhere", groupHolds, savedOff, false},
		{"release with no saved state", groupReleases, nil, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := nextState(tc.change, true, tc.saved, tc.heldElsewhere); !errors.Is(err, errHeldStateBroken) {
				t.Errorf("err = %v, want errHeldStateBroken", err)
			}
		})
	}
}
