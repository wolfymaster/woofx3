package services

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/wolfymaster/woofx3/db/database/models"
)

// Atom operators of a segment condition.
const (
	segmentOpEq        = "eq"
	segmentOpNe        = "ne"
	segmentOpGt        = "gt"
	segmentOpGte       = "gte"
	segmentOpLt        = "lt"
	segmentOpLte       = "lte"
	segmentOpExists    = "exists"
	segmentOpNotExists = "not_exists"
	segmentOpWithin    = "within"
	segmentOpOlderThan = "older_than"
)

// segmentConditionJSON is the stored shape of a condition node. Exactly one
// of All, Any, Not or the atom fields is set.
type segmentConditionJSON struct {
	All   []segmentConditionJSON `json:"all,omitempty"`
	Any   []segmentConditionJSON `json:"any,omitempty"`
	Not   *segmentConditionJSON  `json:"not,omitempty"`
	Fact  string                 `json:"fact,omitempty"`
	Op    string                 `json:"op,omitempty"`
	Value json.RawMessage        `json:"value,omitempty"`
}

// segmentCondition is a parsed condition node: all/any/not over atoms, each
// atom reading one fact of one viewer. The evaluator lives in the db proxy
// rather than reusing the workflow service's, because it runs inside the
// transaction that changes the facts.
type segmentCondition struct {
	all []*segmentCondition
	any []*segmentCondition
	not *segmentCondition

	fact string
	op   string
	// The atom's operand: num for eq/ne against a number and the ordering
	// ops, str for eq/ne against a string, duration for within/older_than.
	isString bool
	num      float64
	str      string
	duration time.Duration
}

// factReading is a viewer's value of a fact as a condition reads it. A nil
// *factReading is a value the viewer does not have, or a fact that is not
// active.
type factReading struct {
	num *float64
	str *string
}

// parseSegmentCondition decodes a condition, refusing unknown keys on every
// node so a misspelt key fails the save rather than being dropped, and
// returns it with its canonical JSON.
func parseSegmentCondition(raw string) (*segmentCondition, string, error) {
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	var node segmentConditionJSON
	if err := decoder.Decode(&node); err != nil {
		return nil, "", fmt.Errorf("not a segment condition: %w", err)
	}
	if decoder.More() {
		return nil, "", errors.New("not a segment condition: trailing data after the object")
	}
	condition, err := compileSegmentCondition(&node)
	if err != nil {
		return nil, "", err
	}
	canonical, err := json.Marshal(&node)
	if err != nil {
		return nil, "", err
	}
	return condition, string(canonical), nil
}

func compileSegmentCondition(node *segmentConditionJSON) (*segmentCondition, error) {
	kinds := 0
	if node.All != nil {
		kinds++
	}
	if node.Any != nil {
		kinds++
	}
	if node.Not != nil {
		kinds++
	}
	if node.Fact != "" || node.Op != "" || len(node.Value) > 0 {
		kinds++
	}
	if kinds != 1 {
		return nil, fmt.Errorf("a condition node sets exactly one of all, any, not or {fact, op, value}; this one sets %d", kinds)
	}

	switch {
	case node.All != nil, node.Any != nil:
		children, name := node.All, "all"
		if node.Any != nil {
			children, name = node.Any, "any"
		}
		if len(children) == 0 {
			return nil, fmt.Errorf("%s has no conditions", name)
		}
		compiled := make([]*segmentCondition, len(children))
		for i := range children {
			child, err := compileSegmentCondition(&children[i])
			if err != nil {
				return nil, fmt.Errorf("%s[%d]: %w", name, i, err)
			}
			compiled[i] = child
		}
		if node.All != nil {
			return &segmentCondition{all: compiled}, nil
		}
		return &segmentCondition{any: compiled}, nil
	case node.Not != nil:
		child, err := compileSegmentCondition(node.Not)
		if err != nil {
			return nil, fmt.Errorf("not: %w", err)
		}
		return &segmentCondition{not: child}, nil
	default:
		return compileSegmentAtom(node)
	}
}

func compileSegmentAtom(node *segmentConditionJSON) (*segmentCondition, error) {
	if node.Fact == "" {
		return nil, errors.New("condition has no fact")
	}
	atom := &segmentCondition{fact: node.Fact, op: node.Op}
	// json.Unmarshal reads null into a number or a string as a no-op, so a
	// null operand is refused here rather than read as 0 or "".
	hasValue := len(node.Value) > 0 && string(bytes.TrimSpace(node.Value)) != "null"
	switch node.Op {
	case segmentOpExists, segmentOpNotExists:
		if len(node.Value) > 0 {
			return nil, fmt.Errorf("%s: %s takes no value", node.Fact, node.Op)
		}
	case segmentOpWithin, segmentOpOlderThan:
		var text string
		if !hasValue || json.Unmarshal(node.Value, &text) != nil {
			return nil, fmt.Errorf("%s: %s needs a duration such as \"720h\"", node.Fact, node.Op)
		}
		duration, err := time.ParseDuration(text)
		if err != nil {
			return nil, fmt.Errorf("%s: %s needs a duration such as \"720h\": %w", node.Fact, node.Op, err)
		}
		if duration <= 0 {
			return nil, fmt.Errorf("%s: %s needs a positive duration, got %q", node.Fact, node.Op, text)
		}
		atom.duration = duration
	case segmentOpGt, segmentOpGte, segmentOpLt, segmentOpLte:
		if !hasValue || json.Unmarshal(node.Value, &atom.num) != nil {
			return nil, fmt.Errorf("%s: %s needs a number", node.Fact, node.Op)
		}
	case segmentOpEq, segmentOpNe:
		if !hasValue {
			return nil, fmt.Errorf("%s: %s needs a value", node.Fact, node.Op)
		}
		if json.Unmarshal(node.Value, &atom.num) != nil {
			if json.Unmarshal(node.Value, &atom.str) != nil {
				return nil, fmt.Errorf("%s: %s needs a number or a string", node.Fact, node.Op)
			}
			atom.isString = true
		}
	case "":
		return nil, fmt.Errorf("%s: condition has no op", node.Fact)
	default:
		return nil, fmt.Errorf("%s: op %q is not one of eq, ne, gt, gte, lt, lte, exists, not_exists, within, older_than", node.Fact, node.Op)
	}
	return atom, nil
}

func (c *segmentCondition) isAtom() bool {
	return c.fact != ""
}

// facts returns the ids of the facts the condition reads, sorted and unique.
func (c *segmentCondition) facts() []string {
	var ids []string
	c.walk(func(atom *segmentCondition) {
		ids = append(ids, atom.fact)
	})
	slices.Sort(ids)
	return slices.Compact(ids)
}

// timeRelative reports whether the condition can turn true or false with
// time alone: it has a within or older_than atom.
func (c *segmentCondition) timeRelative() bool {
	relative := false
	c.walk(func(atom *segmentCondition) {
		if atom.op == segmentOpWithin || atom.op == segmentOpOlderThan {
			relative = true
		}
	})
	return relative
}

func (c *segmentCondition) walk(visit func(atom *segmentCondition)) {
	for _, child := range c.all {
		child.walk(visit)
	}
	for _, child := range c.any {
		child.walk(visit)
	}
	if c.not != nil {
		c.not.walk(visit)
	}
	if c.isAtom() {
		visit(c)
	}
}

// checkFacts reports why the condition does not fit the facts it reads, or
// nil: a fact that does not exist, or an operator or operand the fact's value
// kind does not support. Ordering ops need a number or a timestamp,
// within/older_than a timestamp, and eq/ne an operand of the fact's kind.
func (c *segmentCondition) checkFacts(facts map[string]segmentFact) error {
	var problems []string
	c.walk(func(atom *segmentCondition) {
		fact, ok := facts[atom.fact]
		if !ok {
			problems = append(problems, fmt.Sprintf("%s is not a fact", atom.fact))
			return
		}
		if err := atom.checkKind(fact.valueKind); err != nil {
			problems = append(problems, fmt.Sprintf("%s: %v", atom.fact, err))
		}
	})
	if len(problems) > 0 {
		return errors.New(strings.Join(problems, "; "))
	}
	return nil
}

func (c *segmentCondition) checkKind(kind string) error {
	numeric := kind == models.FactValueKindNumber || kind == models.FactValueKindTimestamp
	switch c.op {
	case segmentOpGt, segmentOpGte, segmentOpLt, segmentOpLte:
		if !numeric {
			return fmt.Errorf("%s compares numbers and timestamps, and the fact is a %s", c.op, kind)
		}
	case segmentOpWithin, segmentOpOlderThan:
		if kind != models.FactValueKindTimestamp {
			return fmt.Errorf("%s reads a timestamp, and the fact is a %s", c.op, kind)
		}
	case segmentOpEq, segmentOpNe:
		if c.isString == numeric {
			operand := "number"
			if c.isString {
				operand = "string"
			}
			return fmt.Errorf("%s compares a %s fact with a %s", c.op, kind, operand)
		}
	}
	return nil
}

// evaluate reports whether one viewer's values satisfy the condition at
// `now`. A fact missing from values is a value the viewer does not have: only
// not_exists and ne hold for it.
func (c *segmentCondition) evaluate(values map[string]*factReading, now time.Time) bool {
	switch {
	case c.all != nil:
		for _, child := range c.all {
			if !child.evaluate(values, now) {
				return false
			}
		}
		return true
	case c.any != nil:
		for _, child := range c.any {
			if child.evaluate(values, now) {
				return true
			}
		}
		return false
	case c.not != nil:
		return !c.not.evaluate(values, now)
	default:
		return c.evaluateAtom(values[c.fact], now)
	}
}

func (c *segmentCondition) evaluateAtom(value *factReading, now time.Time) bool {
	present := value != nil && (value.num != nil || value.str != nil)
	switch c.op {
	case segmentOpExists:
		return present
	case segmentOpNotExists:
		return !present
	case segmentOpEq:
		return present && c.equals(value)
	case segmentOpNe:
		return !present || !c.equals(value)
	}
	if !present || value.num == nil {
		return false
	}
	n := *value.num
	switch c.op {
	case segmentOpGt:
		return n > c.num
	case segmentOpGte:
		return n >= c.num
	case segmentOpLt:
		return n < c.num
	case segmentOpLte:
		return n <= c.num
	case segmentOpWithin:
		return float64(now.UnixMilli())-n <= float64(c.duration.Milliseconds())
	case segmentOpOlderThan:
		return float64(now.UnixMilli())-n > float64(c.duration.Milliseconds())
	default:
		return false
	}
}

func (c *segmentCondition) equals(value *factReading) bool {
	if c.isString {
		return value.str != nil && *value.str == c.str
	}
	return value.num != nil && *value.num == c.num
}
