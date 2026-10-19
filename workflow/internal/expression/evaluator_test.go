package expression

import "testing"

// A null field is never compared as text: the string "<nil>" sorts after
// every digit, which would make `null gt 10` true.
func TestEvaluateNullFieldIsNeverAboveTen(t *testing.T) {
	r := NewResolver()
	r.AddSource("trigger", map[string]any{"data": map[string]any{"amount": nil}})
	ok, err := Evaluate(&Condition{Field: "${trigger.data.amount}", Operator: "gt", Value: 10}, r)
	if err != nil || ok {
		t.Fatalf("null gt 10 = %v, %v; want false", ok, err)
	}
}

func TestEvaluateNullFieldOnlyMeetsPresenceAndDifference(t *testing.T) {
	r := NewResolver()
	r.AddSource("trigger", map[string]any{"data": map[string]any{"amount": nil, "name": nil}})
	for _, tc := range []struct {
		op    string
		value any
		want  bool
	}{
		{"gt", 10, false},
		{">", 10, false},
		{"gte", 0, false},
		{"lt", 10, false},
		{"lte", 10, false},
		{"between", []any{0, 100}, false},
		{"contains", "nil", false},
		{"starts_with", "<", false},
		{"ends_with", ">", false},
		{"regex", "nil", false},
		{"eq", 10, false},
		{"eq", nil, true},
		{"ne", 10, true},
		{"in", []any{1, 2}, false},
		{"not_in", []any{1, 2}, true},
		{"exists", nil, false},
		{"not_exists", nil, true},
	} {
		got, err := Evaluate(&Condition{Field: "${trigger.data.amount}", Operator: tc.op, Value: tc.value}, r)
		if err != nil || got != tc.want {
			t.Errorf("null %s %v = %v, %v; want %v", tc.op, tc.value, got, err, tc.want)
		}
	}
}

func TestEvaluateNullFieldStillRejectsAnUnknownOperator(t *testing.T) {
	r := NewResolver()
	r.AddSource("trigger", map[string]any{"data": map[string]any{"amount": nil}})
	if _, err := Evaluate(&Condition{Field: "${trigger.data.amount}", Operator: "bigger", Value: 10}, r); err == nil {
		t.Fatal("an unknown operator on a null field was accepted")
	}
}

func TestEvaluatePresentFieldIsUnchanged(t *testing.T) {
	r := NewResolver()
	r.AddSource("trigger", map[string]any{"data": map[string]any{"amount": 500}})
	ok, err := Evaluate(&Condition{Field: "${trigger.data.amount}", Operator: "gt", Value: 10}, r)
	if err != nil || !ok {
		t.Fatalf("500 gt 10 = %v, %v; want true", ok, err)
	}
}

func TestEvaluateNullFieldStillRejectsAMalformedExpectedValue(t *testing.T) {
	r := NewResolver()
	r.AddSource("trigger", map[string]any{"data": map[string]any{"amount": nil}})
	for _, tc := range []struct {
		op    string
		value any
	}{
		{"regex", "("},
		{"between", 5},
		{"between", []any{1}},
		{"range", []any{1, 2, 3}},
	} {
		if _, err := Evaluate(&Condition{Field: "${trigger.data.amount}", Operator: tc.op, Value: tc.value}, r); err == nil {
			t.Errorf("null %s %v was accepted", tc.op, tc.value)
		}
	}
}

func TestEvaluateResolvesReferencesInsideAListValue(t *testing.T) {
	r := NewResolver()
	r.AddSource("trigger", map[string]any{"data": map[string]any{
		"user":   "alice",
		"amount": 150,
		"low":    100,
		"high":   200,
	}})
	r.AddSource("lookup", map[string]any{"owner": "alice", "limit": 120})
	for _, tc := range []struct {
		name  string
		field string
		op    string
		value any
		want  bool
	}{
		{"in matches a referenced item", "${trigger.data.user}", "in", []any{"bob", "${lookup.owner}"}, true},
		{"not_in sees the referenced item", "${trigger.data.user}", "not_in", []any{"${lookup.owner}"}, false},
		{"between with both bounds referenced", "${trigger.data.amount}", "between", []any{"${trigger.data.low}", "${trigger.data.high}"}, true},
		{"between with one bound referenced", "${trigger.data.amount}", "between", []any{0, "${lookup.limit}"}, false},
		{"a referenced bound keeps its number type", "${trigger.data.amount}", "between", []any{"${lookup.limit}", 1000}, true},
		{"a literal item is unchanged", "${trigger.data.user}", "in", []any{"alice"}, true},
	} {
		got, err := Evaluate(&Condition{Field: tc.field, Operator: tc.op, Value: tc.value}, r)
		if err != nil || got != tc.want {
			t.Errorf("%s: got %v, %v; want %v", tc.name, got, err, tc.want)
		}
	}
}

func TestEvaluateFailsOnAListItemThatCannotResolve(t *testing.T) {
	r := NewResolver()
	r.AddSource("trigger", map[string]any{"data": map[string]any{"user": "alice"}})
	_, err := Evaluate(&Condition{Field: "${trigger.data.user}", Operator: "in", Value: []any{"${trigger.data.missing}"}}, r)
	if err == nil {
		t.Fatal("an item naming a missing path was accepted")
	}
}

func TestEvaluateReadsAMissingLazyItemAsNull(t *testing.T) {
	r := NewResolver()
	r.AddSource("trigger", map[string]any{"data": map[string]any{"amount": 5}})
	r.AddLazySource("viewer", func() (any, error) { return map[string]any{}, nil })
	got, err := Evaluate(&Condition{Field: "${trigger.data.amount}", Operator: "between", Value: []any{0, "${viewer.user.limit}"}}, r)
	if err != nil || got {
		t.Fatalf("5 between 0 and a missing bound = %v, %v; want false", got, err)
	}
}
