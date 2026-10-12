package expression

import (
	"errors"
	"fmt"
	"regexp"
)

// ConditionTree is a condition over one data map, held as data rather than
// as an expression string so that a builder can edit it and a validator can
// check every path it reads. Exactly one of All, Any, Not, or an atom (Path,
// Op, Value) is set.
//
// Values are literal: a "${...}" in Value is compared as text, never
// resolved, because the tree is authored once and evaluated against data
// that has no other sources.
type ConditionTree struct {
	All   []ConditionTree `json:"all,omitempty"`
	Any   []ConditionTree `json:"any,omitempty"`
	Not   *ConditionTree  `json:"not,omitempty"`
	Path  string          `json:"path,omitempty"`
	Op    string          `json:"op,omitempty"`
	Value any             `json:"value,omitempty"`
}

// AtomEvaluator decides one atom of a tree. It lets a caller that evaluates
// many trees over the same data decide each distinct atom once.
type AtomEvaluator func(atom *ConditionTree) (bool, error)

type treeKind int

const (
	allNode treeKind = iota
	anyNode
	notNode
	atomNode
)

func (t *ConditionTree) kind() (treeKind, error) {
	kinds := 0
	var k treeKind
	if t.All != nil {
		kinds++
		k = allNode
	}
	if t.Any != nil {
		kinds++
		k = anyNode
	}
	if t.Not != nil {
		kinds++
		k = notNode
	}
	if t.Path != "" || t.Op != "" || t.Value != nil {
		kinds++
		k = atomNode
	}
	if kinds != 1 {
		return 0, fmt.Errorf("a condition node sets exactly one of all, any, not or {path, op, value}; this one sets %d", kinds)
	}
	return k, nil
}

// Validate reports the first structural or operator error in the tree: a node
// that is not exactly one kind, an empty all or any, an atom without a path,
// an unknown operator, or an expected value its operator cannot use.
func (t *ConditionTree) Validate() error {
	k, err := t.kind()
	if err != nil {
		return err
	}
	switch k {
	case allNode, anyNode:
		children, name := t.All, "all"
		if k == anyNode {
			children, name = t.Any, "any"
		}
		// An empty group is always true or always false, which is never what
		// an author means; matching every event is said by having no tree.
		if len(children) == 0 {
			return fmt.Errorf("%s has no conditions", name)
		}
		for i := range children {
			if err := children[i].Validate(); err != nil {
				return fmt.Errorf("%s[%d]: %w", name, i, err)
			}
		}
		return nil
	case notNode:
		if err := t.Not.Validate(); err != nil {
			return fmt.Errorf("not: %w", err)
		}
		return nil
	default:
		return t.validateAtom()
	}
}

func (t *ConditionTree) validateAtom() error {
	if t.Path == "" {
		return fmt.Errorf("condition has no path")
	}
	canonical, ok := CanonicalOperator(t.Op)
	if !ok {
		return fmt.Errorf("%s: unknown operator %q", t.Path, t.Op)
	}
	switch canonical {
	case "regex":
		pattern, ok := t.Value.(string)
		if !ok {
			return fmt.Errorf("%s: regex needs a string pattern, got %T", t.Path, t.Value)
		}
		if _, err := regexp.Compile(pattern); err != nil {
			return fmt.Errorf("%s: invalid regex pattern: %w", t.Path, err)
		}
	case "in", "not_in":
		if _, ok := t.Value.([]any); !ok {
			return fmt.Errorf("%s: %s needs a list value, got %T", t.Path, canonical, t.Value)
		}
	case "between":
		bounds, ok := t.Value.([]any)
		if !ok || len(bounds) != 2 {
			return fmt.Errorf("%s: between needs a [min, max] value", t.Path)
		}
	}
	return nil
}

// Evaluate decides the tree against data, reading each atom's path with
// ResolvePath. A path that is not in data reads as null; see EvaluateAtomValue.
func (t *ConditionTree) Evaluate(data map[string]any) (bool, error) {
	return t.EvaluateAtoms(func(atom *ConditionTree) (bool, error) {
		actual, err := ResolvePath(data, atom.Path)
		if err != nil {
			if !errors.Is(err, ErrPathNotFound) {
				return false, err
			}
			actual = nil
		}
		return EvaluateAtomValue(atom.Op, actual, atom.Value)
	})
}

// EvaluateAtoms decides the tree's structure, handing each atom it reaches to
// evaluate. all and any stop at the first atom that settles them.
func (t *ConditionTree) EvaluateAtoms(evaluate AtomEvaluator) (bool, error) {
	k, err := t.kind()
	if err != nil {
		return false, err
	}
	switch k {
	case allNode:
		for i := range t.All {
			ok, err := t.All[i].EvaluateAtoms(evaluate)
			if err != nil || !ok {
				return false, err
			}
		}
		return true, nil
	case anyNode:
		for i := range t.Any {
			ok, err := t.Any[i].EvaluateAtoms(evaluate)
			if err != nil || ok {
				return ok, err
			}
		}
		return false, nil
	case notNode:
		ok, err := t.Not.EvaluateAtoms(evaluate)
		if err != nil {
			return false, err
		}
		return !ok, nil
	default:
		return evaluate(t)
	}
}

// EvaluateAtomValue applies an atom's operator to the value read at its path,
// nil when the path is absent or null. An absent value only satisfies an
// operator that is about presence or difference (not_exists, ne, not_in, or
// eq/in against null); it is never above, below, inside or matching anything,
// so `contains "nil"` cannot match the text of a missing value. A malformed
// expected value is an error whatever the field holds, so a broken condition
// does not pass unnoticed while its field happens to be absent.
func EvaluateAtomValue(op string, actual, expected any) (bool, error) {
	if actual == nil {
		canonical, ok := CanonicalOperator(op)
		if !ok {
			return false, fmt.Errorf("unknown operator: %s", op)
		}
		if err := checkExpected(canonical, expected); err != nil {
			return false, err
		}
		switch canonical {
		case "eq", "ne", "in", "not_in", "exists", "not_exists":
		default:
			return false, nil
		}
	}
	return EvaluateOperator(op, actual, expected)
}
