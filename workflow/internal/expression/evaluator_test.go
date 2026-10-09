package expression

import "testing"

// A null field used to reach the ordering and text operators as the string
// "<nil>", which sorts after every digit: `null gt 10` was true.
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
