package conditions

import "testing"

func TestCanonicalFoldsAliases(t *testing.T) {
	cases := map[string]string{
		"eq": "eq", "==": "eq", "equals": "eq",
		"!=": "ne", ">=": "gte", "matches": "regex", "range": "between",
		"contains": "contains", "not_exists": "not_exists",
	}
	for op, want := range cases {
		got, ok := Canonical(op)
		if !ok || got != want {
			t.Errorf("Canonical(%q) = %q, %v; want %q", op, got, ok, want)
		}
	}
}

func TestCanonicalRefusesUnknownSpellings(t *testing.T) {
	for _, op := range []string{"", "contians", "EQ", "like", "within"} {
		if got, ok := Canonical(op); ok {
			t.Errorf("Canonical(%q) = %q, true; want not an operator", op, got)
		}
	}
}

func TestEverySpellingIsCanonical(t *testing.T) {
	spellings := Spellings()
	if len(spellings) == 0 {
		t.Fatal("no operator spellings")
	}
	for _, spelling := range spellings {
		if _, ok := Canonical(spelling); !ok {
			t.Errorf("Spellings lists %q but Canonical refuses it", spelling)
		}
	}
}

func TestValidateExpected(t *testing.T) {
	cases := []struct {
		name      string
		canonical string
		expected  any
		valid     bool
	}{
		{"regex pattern", "regex", "^a+$", true},
		{"regex not a string", "regex", float64(1), false},
		{"regex does not compile", "regex", "(", false},
		{"in list", "in", []any{"a", "b"}, true},
		{"in scalar", "in", "a", false},
		{"not_in scalar", "not_in", float64(1), false},
		{"between pair", "between", []any{float64(1), float64(5)}, true},
		{"between one bound", "between", []any{float64(1)}, false},
		{"between scalar", "between", float64(1), false},
		{"eq takes anything", "eq", nil, true},
		{"contains takes anything", "contains", "apple", true},
	}
	for _, c := range cases {
		err := ValidateExpected(c.canonical, c.expected)
		if (err == nil) != c.valid {
			t.Errorf("%s: ValidateExpected(%q, %v) = %v; want valid %v", c.name, c.canonical, c.expected, err, c.valid)
		}
	}
}
