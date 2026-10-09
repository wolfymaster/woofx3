package facts

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/wolfymaster/woofx3/workflow/internal/eventmatch"
	"github.com/wolfymaster/woofx3/workflow/internal/expression"
)

// index is the compiled form of every active definition, built once per
// definition change and read concurrently by every event.
//
// Sources are grouped by event pattern: a literal pattern is a map lookup and
// only wildcard patterns are matched one by one. Every where-atom across all
// sources is pooled by (path, operator, value), so an atom that many
// definitions share is decided once per event however many read it.
type index struct {
	exact    map[string][]*compiledSource
	wildcard []wildcardSources
	atoms    []*compiledAtom
	patterns []string
}

type wildcardSources struct {
	pattern string
	tokens  []string
	sources []*compiledSource
}

type compiledSource struct {
	factID   string
	revision int64
	fn       string
	// order ranks sources by definition and then by source, so that when
	// several sources of one definition match an event the first one
	// declared is the one that counts.
	order     int
	source    FactSource
	valuePath string
	// atomIDs maps each atom node of source.Where to its slot in index.atoms.
	atomIDs map[*expression.ConditionTree]int
}

type compiledAtom struct {
	path     string
	op       string
	expected any
	// re is set for a regex atom, compiled once here rather than on every
	// event.
	re *regexp.Regexp
}

// buildIndex compiles the active definitions. A definition that does not
// compile is left out and reported in the returned error, so one bad
// definition never stops every other fact from counting.
func buildIndex(defs []FactDefinition) (*index, error) {
	idx := &index{exact: make(map[string][]*compiledSource)}
	atomSlots := make(map[string]int)
	wildcards := make(map[string]int)
	var errs []error
	order := 0

	for d := range defs {
		def := &defs[d]
		if def.Status != StatusActive {
			continue
		}
		sources, err := compileDefinition(def, &order)
		if err != nil {
			errs = append(errs, fmt.Errorf("fact %s: %w", def.ID, err))
			continue
		}
		for _, cs := range sources {
			if cs.source.Where != nil {
				cs.atomIDs = make(map[*expression.ConditionTree]int)
				idx.poolAtoms(cs.source.Where, cs.atomIDs, atomSlots)
			}
			pattern := cs.source.EventPattern
			if !isWildcard(pattern) {
				if _, seen := idx.exact[pattern]; !seen {
					idx.patterns = append(idx.patterns, pattern)
				}
				idx.exact[pattern] = append(idx.exact[pattern], cs)
				continue
			}
			slot, seen := wildcards[pattern]
			if !seen {
				slot = len(idx.wildcard)
				wildcards[pattern] = slot
				idx.wildcard = append(idx.wildcard, wildcardSources{
					pattern: pattern,
					tokens:  strings.Split(pattern, "."),
				})
				idx.patterns = append(idx.patterns, pattern)
			}
			idx.wildcard[slot].sources = append(idx.wildcard[slot].sources, cs)
		}
	}
	return idx, errors.Join(errs...)
}

func compileDefinition(def *FactDefinition, order *int) ([]*compiledSource, error) {
	if def.ID == "" {
		return nil, fmt.Errorf("definition has no id")
	}
	if !knownAggregate(def.Aggregate.Fn) {
		return nil, fmt.Errorf("unknown aggregate %q", def.Aggregate.Fn)
	}
	if len(def.Sources) == 0 {
		return nil, fmt.Errorf("definition has no sources")
	}
	sources := make([]*compiledSource, 0, len(def.Sources))
	for i, src := range def.Sources {
		if src.EventPattern == "" {
			return nil, fmt.Errorf("source %d (%s): no event pattern", i, src.Trigger)
		}
		if src.IdentityPath == "" {
			return nil, fmt.Errorf("source %d (%s): no identity path", i, src.Trigger)
		}
		if src.Where != nil {
			where, err := cloneTree(src.Where)
			if err != nil {
				return nil, fmt.Errorf("source %d (%s): where: %w", i, src.Trigger, err)
			}
			if err := where.Validate(); err != nil {
				return nil, fmt.Errorf("source %d (%s): where: %w", i, src.Trigger, err)
			}
			src.Where = where
		}
		valuePath := src.Value
		if valuePath == "" {
			valuePath = def.Aggregate.Path
		}
		if aggregateReadsValue(def.Aggregate.Fn) && valuePath == "" {
			return nil, fmt.Errorf("source %d (%s): %s needs a value path", i, src.Trigger, def.Aggregate.Fn)
		}
		sources = append(sources, &compiledSource{
			factID:    def.ID,
			revision:  def.Revision,
			fn:        def.Aggregate.Fn,
			order:     *order,
			source:    src,
			valuePath: valuePath,
		})
		*order++
	}
	return sources, nil
}

// poolAtoms gives every atom of a validated tree a slot, reusing the slot of
// an identical atom already pooled.
func (idx *index) poolAtoms(tree *expression.ConditionTree, ids map[*expression.ConditionTree]int, slots map[string]int) {
	switch {
	case tree.All != nil:
		for i := range tree.All {
			idx.poolAtoms(&tree.All[i], ids, slots)
		}
	case tree.Any != nil:
		for i := range tree.Any {
			idx.poolAtoms(&tree.Any[i], ids, slots)
		}
	case tree.Not != nil:
		idx.poolAtoms(tree.Not, ids, slots)
	default:
		op, ok := expression.CanonicalOperator(tree.Op)
		if !ok {
			panic(fmt.Sprintf("facts: validated atom %s has unknown operator %q", tree.Path, tree.Op))
		}
		key := atomKey(tree.Path, op, tree.Value)
		slot, seen := slots[key]
		if !seen {
			atom := &compiledAtom{path: tree.Path, op: op, expected: tree.Value}
			if op == "regex" {
				atom.re = regexp.MustCompile(tree.Value.(string))
			}
			slot = len(idx.atoms)
			slots[key] = slot
			idx.atoms = append(idx.atoms, atom)
		}
		ids[tree] = slot
	}
}

// cloneTree copies a where-tree through its JSON form. The index keys atoms
// by node address, so it must own its trees; the round trip also reduces
// every value to the JSON types that atomKey compares.
func cloneTree(tree *expression.ConditionTree) (*expression.ConditionTree, error) {
	encoded, err := json.Marshal(tree)
	if err != nil {
		return nil, err
	}
	var clone expression.ConditionTree
	if err := json.Unmarshal(encoded, &clone); err != nil {
		return nil, err
	}
	return &clone, nil
}

func atomKey(path, op string, value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(fmt.Sprintf("facts: atom value of %s survived cloneTree but does not encode: %v", path, err))
	}
	return path + "\x00" + op + "\x00" + string(encoded)
}

// sourcesFor returns every source listening for an event type, in
// declaration order. The result may be the index's own slice and must not be
// modified.
func (idx *index) sourcesFor(eventType string) []*compiledSource {
	exact := idx.exact[eventType]
	if len(idx.wildcard) == 0 {
		return exact
	}
	subject := strings.Split(eventType, ".")
	var groups [][]*compiledSource
	if len(exact) > 0 {
		groups = append(groups, exact)
	}
	for i := range idx.wildcard {
		if eventmatch.MatchesTokens(idx.wildcard[i].tokens, subject) {
			groups = append(groups, idx.wildcard[i].sources)
		}
	}
	// Each group is already in declaration order; only sources drawn from
	// several groups need merging.
	switch len(groups) {
	case 0:
		return nil
	case 1:
		return groups[0]
	}
	var matched []*compiledSource
	for _, group := range groups {
		matched = append(matched, group...)
	}
	sort.Slice(matched, func(i, j int) bool {
		return matched[i].order < matched[j].order
	})
	return matched
}

func isWildcard(pattern string) bool {
	for _, token := range strings.Split(pattern, ".") {
		if token == "*" || token == ">" {
			return true
		}
	}
	return false
}

func knownAggregate(fn string) bool {
	switch fn {
	case AggregateCount, AggregateSum, AggregateMin, AggregateMax, AggregateLast,
		AggregateFirstAt, AggregateLastAt, AggregateSessions, AggregateSessionStreak:
		return true
	default:
		return false
	}
}

func aggregateReadsValue(fn string) bool {
	switch fn {
	case AggregateSum, AggregateMin, AggregateMax, AggregateLast:
		return true
	default:
		return false
	}
}
