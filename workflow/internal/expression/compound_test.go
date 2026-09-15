package expression

import (
	"reflect"
	"testing"
)

func compoundResolver() *Resolver {
	r := NewResolver()
	r.AddSource("trigger", map[string]any{"data": map[string]any{
		"userName": "wolfy",
		"amount":   float64(5),
		"single":   float64(1),
	}})
	r.AddSource("tasks", map[string]any{"step-1": map[string]any{"value": "done"}})
	return r
}

func TestResolveStringCompoundExpressions(t *testing.T) {
	r := compoundResolver()
	cases := []struct {
		in   string
		want any
	}{
		{"${trigger.data.amount > 1 ? 'subs' : 'sub'}", "subs"},
		{"${trigger.data.single > 1 ? 'subs' : 'sub'}", "sub"},
		{"gifted ${trigger.data.amount} ${trigger.data.amount > 1 ? 'subs' : 'sub'}", "gifted 5 subs"},
		{`${trigger.data.userName == "wolfy" ? 'the boss' : 'a viewer'}`, "the boss"},
		{"${trigger.data.userName !== 'wolfy'}", false},
		{"${trigger.data.amount >= 5 && trigger.data.single < 2}", true},
		{"${!(trigger.data.amount <= 1)}", true},
		{"${false || 'fallback'}", "fallback"},
		{"${true ? trigger.data.amount : 0}", float64(5)},
		{"${tasks.step-1.value == 'done'}", true},
		{"${-1 < 0}", true},
	}
	for _, tc := range cases {
		got, err := r.ResolveString(tc.in)
		if err != nil {
			t.Errorf("%s: unexpected error: %v", tc.in, err)
			continue
		}
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%s: got %#v, want %#v", tc.in, got, tc.want)
		}
	}
}

func TestResolveStringCompoundOnlyEvaluatesTheChosenBranch(t *testing.T) {
	got, err := compoundResolver().ResolveString("${trigger.data.amount > 1 ? 'many' : trigger.data.nope}")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "many" {
		t.Fatalf("got %#v", got)
	}
}

func TestResolveStringCompoundTreatsAMissingPathAsNull(t *testing.T) {
	r := compoundResolver()
	cases := []struct {
		in   string
		want any
	}{
		{"${trigger.data.nick || trigger.data.userName}", "wolfy"},
		{"${trigger.data.nope > 1 ? 'a' : 'b'}", "b"},
		{"${trigger.data.nope == null}", true},
	}
	for _, tc := range cases {
		got, err := r.ResolveString(tc.in)
		if err != nil {
			t.Errorf("%s: unexpected error: %v", tc.in, err)
			continue
		}
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%s: got %#v, want %#v", tc.in, got, tc.want)
		}
	}
}

func TestResolveStringCompoundErrors(t *testing.T) {
	r := compoundResolver()
	for _, in := range []string{
		"${trigger.data.amount > }",
		"${'unterminated}",
		"${trigger.data.amount ? 'a'}",
		"${(trigger.data.amount > 1}",
		"${trigerr.data.amount > 1 ? 'a' : 'b'}",
	} {
		if _, err := r.ResolveString(in); err == nil {
			t.Errorf("%s: expected an error", in)
		}
	}
}

// An embedded expression that fails is left in place, the same as an
// embedded reference that fails.
func TestResolveStringCompoundEmbeddedFailureLeavesTheToken(t *testing.T) {
	got, err := compoundResolver().ResolveString("x ${trigger.data.amount > } y")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "x ${trigger.data.amount > } y" {
		t.Fatalf("got %#v", got)
	}
}
