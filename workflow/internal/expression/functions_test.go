package expression

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

const conformancePath = "../../../shared/clients/typescript/api/tests/expression-conformance.json"

type conformanceFile struct {
	Functions map[string]struct {
		MinArgs int  `json:"minArgs"`
		MaxArgs *int `json:"maxArgs"`
	} `json:"functions"`
	Valid   []string `json:"valid"`
	Invalid []string `json:"invalid"`
}

func loadConformance(t *testing.T) conformanceFile {
	t.Helper()
	raw, err := os.ReadFile(filepath.FromSlash(conformancePath))
	if err != nil {
		t.Fatalf("reading the conformance file: %v", err)
	}
	var file conformanceFile
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatalf("parsing the conformance file: %v", err)
	}
	return file
}

func TestFunctionSetMatchesConformanceFile(t *testing.T) {
	file := loadConformance(t)
	if len(file.Functions) != len(functions) {
		t.Fatalf("conformance file has %d functions, the engine has %d", len(file.Functions), len(functions))
	}
	for name, fn := range functions {
		want, ok := file.Functions[name]
		if !ok {
			t.Errorf("%s is not in the conformance file", name)
			continue
		}
		maxArgs := noArgLimit
		if want.MaxArgs != nil {
			maxArgs = *want.MaxArgs
		}
		if fn.minArgs != want.MinArgs || fn.maxArgs != maxArgs {
			t.Errorf("%s: engine takes %d to %d arguments, conformance file %d to %d", name, fn.minArgs, fn.maxArgs, want.MinArgs, maxArgs)
		}
	}
}

func TestValidateFunctionCallsMatchesConformanceFile(t *testing.T) {
	file := loadConformance(t)
	for _, text := range file.Valid {
		if err := ValidateFunctionCalls(text); err != nil {
			t.Errorf("%s: unexpected error: %v", text, err)
		}
	}
	for _, text := range file.Invalid {
		if err := ValidateFunctionCalls(text); err == nil {
			t.Errorf("%s: expected an error", text)
		}
	}
}

func functionResolver() *Resolver {
	r := NewResolver()
	r.AddSource("trigger", map[string]any{"data": map[string]any{
		"userName": "Wolfy",
		"amount":   float64(5),
		"count":    7,
		"typed":    " 12.5 ",
		"word":     "many",
		"yes":      true,
		"blank":    "",
		"list":     []any{float64(1)},
		"record":   map[string]any{"a": 1},
	}})
	r.AddSource("round", map[string]any{"result": "a step named round"})
	return r
}

func TestFunctionResults(t *testing.T) {
	cases := []struct {
		in   string
		want any
	}{
		{"${add(1, 2)}", float64(3)},
		{"${add(1, 2, 3.5)}", 6.5},
		{"${add(0.1, 0.2)}", 0.3},
		{"${add(trigger.data.amount, trigger.data.count)}", float64(12)},
		{"${add(trigger.data.typed, 1)}", 13.5},
		{"${add(trigger.data.missing || 0, 1)}", float64(1)},
		{"${subtract(1, 3)}", float64(-2)},
		{"${multiply(2, 3, 4)}", float64(24)},
		{"${multiply(1.1, 3)}", 3.3},
		{"${divide(1, 4)}", 0.25},
		{"${min(3, 1, 2)}", float64(1)},
		{"${max(3, 1, 2)}", float64(3)},
		{"${round(2.5)}", float64(3)},
		{"${round(-2.5)}", float64(-3)},
		{"${round(1.005, 2)}", 1.01},
		{"${round(1.25, 1)}", 1.3},
		{"${round(1234.5678, 0)}", float64(1235)},
		{"${round(divide(125, 100), 2)}", 1.25},
		{"${uppercase(trigger.data.userName)}", "WOLFY"},
		{"${lowercase(trigger.data.userName)}", "wolfy"},
		{"${uppercase('é')}", "É"},
		{"${uppercase(trigger.data.missing)}", ""},
		{"${uppercase(trigger.data.amount)}", "5"},
		{"${uppercase(trigger.data.amount > 1 ? 'subs' : 'sub')}", "SUBS"},
		{"${round.result}", "a step named round"},
		{"${true ? 'x' : add(trigger.data.word, 1)}", "x"},
		{"${add(1, 2) > 2 ? 'big' : 'small'}", "big"},
		{"Total: ${add(1, 2)}!", "Total: 3!"},
		{"${uppercase(trigger.data.word)} ${trigger.data.userName}", "MANY Wolfy"},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			got, err := functionResolver().ResolveString(tc.in)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %#v, want %#v", got, tc.want)
			}
		})
	}
}

func TestFunctionFailures(t *testing.T) {
	for _, expr := range []string{
		"add(trigger.data.missing, 1)",
		"add(trigger.data.word, 1)",
		"add(trigger.data.blank, 1)",
		"add(trigger.data.yes, 1)",
		"add(trigger.data.list, 1)",
		"add('Inf', 1)",
		"add('NaN', 1)",
		"add('0x10', 1)",
		"add(typo.path, 1)",
		"divide(1, 0)",
		"multiply(1e308, 10)",
		"round(1.5, 11)",
		"round(1.5, -1)",
		"round(1.5, 0.5)",
		"random(6, 1)",
		"random(1.5, 6)",
		"random(1, 1e300)",
		"random(trigger.data.missing, 6)",
		"uppercase(trigger.data.list)",
		"uppercase(trigger.data.record)",
		"foo(1)",
		"add(1)",
	} {
		t.Run(expr, func(t *testing.T) {
			if _, err := functionResolver().ResolveString("${" + expr + "}"); !errors.Is(err, ErrFunctionCall) {
				t.Fatalf("whole value: got %v, want ErrFunctionCall", err)
			}
			if _, err := functionResolver().ResolveString("Hello ${" + expr + "} there"); !errors.Is(err, ErrFunctionCall) {
				t.Fatalf("inside text: got %v, want ErrFunctionCall", err)
			}
		})
	}
}

// A failing expression with no call keeps leaving its token in the text.
func TestEmbeddedFailureWithoutACallLeavesTheToken(t *testing.T) {
	in := "x ${trigger.data.amount > } ${typo.path} y"
	got, err := functionResolver().ResolveString(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != in {
		t.Fatalf("got %#v", got)
	}
}

func TestRandomStaysInRangeAndUsesTheInjectedSource(t *testing.T) {
	cases := []struct {
		name  string
		draw  uint64
		in    string
		want  float64
		wantN uint64
	}{
		{"lowest", 0, "${random(1, 6)}", 1, 6},
		{"highest", 5, "${random(1, 6)}", 6, 6},
		{"negative bounds", 2, "${random(-3, 3)}", -1, 7},
		{"one value", 0, "${random(4, 4)}", 4, 1},
		{"numeric text", 1, "${random('1', '2')}", 2, 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := functionResolver()
			var gotN uint64
			r.SetRandomSource(func(n uint64) uint64 {
				gotN = n
				return tc.draw
			})
			got, err := r.ResolveString(tc.in)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want || gotN != tc.wantN {
				t.Fatalf("got %v from n=%d, want %v from n=%d", got, gotN, tc.want, tc.wantN)
			}
		})
	}
}

func TestRandomDrawsAgainForEachCall(t *testing.T) {
	r := functionResolver()
	next := uint64(0)
	r.SetRandomSource(func(uint64) uint64 {
		next++
		return next
	})
	got, err := r.ResolveString("${random(0, 9)} ${random(0, 9)}")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "1 2" {
		t.Fatalf("got %#v", got)
	}
}
