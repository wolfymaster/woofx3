package expression

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/wolfymaster/woofx3/common/conditions"
)

func mustTree(t *testing.T, raw string) *ConditionTree {
	t.Helper()
	var tree ConditionTree
	if err := json.Unmarshal([]byte(raw), &tree); err != nil {
		t.Fatalf("decode %s: %v", raw, err)
	}
	if err := tree.Validate(); err != nil {
		t.Fatalf("validate %s: %v", raw, err)
	}
	return &tree
}

func treeData() map[string]any {
	return map[string]any{
		"message":   "I love apple pie",
		"bits":      float64(500),
		"anonymous": false,
		"nothing":   nil,
		"badges":    []any{"vip", "subscriber"},
		"user":      map[string]any{"name": "wolfy", "tier": "2000"},
	}
}

func TestConditionTreeEvaluate(t *testing.T) {
	cases := []struct {
		name string
		tree string
		want bool
	}{
		{"atom contains", `{"path":"message","op":"contains","value":"apple"}`, true},
		{"atom alias", `{"path":"bits","op":">=","value":500}`, true},
		{"nested path", `{"path":"user.name","op":"eq","value":"wolfy"}`, true},
		{"indexed path", `{"path":"badges[0]","op":"eq","value":"vip"}`, true},
		{"all true", `{"all":[{"path":"bits","op":"gt","value":100},{"path":"message","op":"starts_with","value":"I "}]}`, true},
		{"all one false", `{"all":[{"path":"bits","op":"gt","value":100},{"path":"message","op":"contains","value":"pear"}]}`, false},
		{"any one true", `{"any":[{"path":"bits","op":"lt","value":100},{"path":"message","op":"contains","value":"pie"}]}`, true},
		{"any none true", `{"any":[{"path":"bits","op":"lt","value":100},{"path":"message","op":"contains","value":"pear"}]}`, false},
		{"not negates", `{"not":{"path":"message","op":"contains","value":"apple"}}`, false},
		{"not of false", `{"not":{"path":"message","op":"contains","value":"pear"}}`, true},
		{"not of all", `{"not":{"all":[{"path":"bits","op":"gt","value":100},{"path":"anonymous","op":"eq","value":true}]}}`, true},
		{"double not", `{"not":{"not":{"path":"bits","op":"eq","value":500}}}`, true},
		{"regex", `{"path":"message","op":"regex","value":"(?i)APPLE"}`, true},
		{"in", `{"path":"user.tier","op":"in","value":["1000","2000"]}`, true},
		{"between", `{"path":"bits","op":"between","value":[100,1000]}`, true},
		{"bool eq", `{"path":"anonymous","op":"eq","value":false}`, true},

		{"missing exists", `{"path":"gone","op":"exists"}`, false},
		{"missing not_exists", `{"path":"gone","op":"not_exists"}`, true},
		{"missing eq", `{"path":"gone","op":"eq","value":"x"}`, false},
		{"missing ne", `{"path":"gone","op":"ne","value":"x"}`, true},
		{"missing eq null", `{"path":"gone","op":"eq","value":null}`, true},
		{"missing not_in", `{"path":"gone","op":"not_in","value":["x"]}`, true},
		{"missing in", `{"path":"gone","op":"in","value":["x"]}`, false},
		{"missing gt", `{"path":"gone","op":"gt","value":0}`, false},
		{"missing lt", `{"path":"gone","op":"lt","value":0}`, false},
		{"missing contains its own text", `{"path":"gone","op":"contains","value":"nil"}`, false},
		{"missing regex", `{"path":"gone","op":"regex","value":".*"}`, false},
		{"missing between", `{"path":"gone","op":"between","value":[0,1]}`, false},
		{"missing under nested path", `{"path":"user.address.city","op":"exists"}`, false},
		{"missing index", `{"path":"badges[5]","op":"not_exists"}`, true},
		{"null reads as missing", `{"path":"nothing","op":"contains","value":"nil"}`, false},
		{"null not_exists", `{"path":"nothing","op":"not_exists"}`, true},
		{"not over missing", `{"not":{"path":"gone","op":"contains","value":"x"}}`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := mustTree(t, tc.tree).Evaluate(treeData())
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestConditionTreeValidateRejects(t *testing.T) {
	cases := []struct {
		name    string
		tree    string
		wantErr string
	}{
		{"empty node", `{}`, "exactly one"},
		{"two kinds", `{"all":[{"path":"a","op":"exists"}],"path":"b","op":"exists"}`, "exactly one"},
		{"empty all", `{"all":[]}`, "all has no conditions"},
		{"empty any", `{"any":[]}`, "any has no conditions"},
		{"no path", `{"op":"eq","value":1}`, "no path"},
		{"unknown op", `{"path":"a","op":"like","value":1}`, "unknown operator"},
		{"bad regex", `{"path":"a","op":"regex","value":"("}`, "invalid regex"},
		{"regex not string", `{"path":"a","op":"regex","value":3}`, "string pattern"},
		{"in not list", `{"path":"a","op":"in","value":"x"}`, "list value"},
		{"between shape", `{"path":"a","op":"between","value":[1]}`, "[min, max]"},
		{"nested error has location", `{"any":[{"path":"a","op":"exists"},{"not":{"path":"b","op":"nope"}}]}`, "any[1]: not: b: unknown operator"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var tree ConditionTree
			if err := json.Unmarshal([]byte(tc.tree), &tree); err != nil {
				t.Fatalf("decode: %v", err)
			}
			err := tree.Validate()
			if err == nil {
				t.Fatalf("expected an error containing %q", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("error %q does not contain %q", err, tc.wantErr)
			}
		})
	}
}

func TestConditionTreeEvaluateAtomsShortCircuits(t *testing.T) {
	tree := mustTree(t, `{"any":[{"path":"a","op":"exists"},{"path":"b","op":"exists"}]}`)
	var seen []string
	got, err := tree.EvaluateAtoms(func(atom *ConditionTree) (bool, error) {
		seen = append(seen, atom.Path)
		return true, nil
	})
	if err != nil || !got {
		t.Fatalf("got %v, %v", got, err)
	}
	if len(seen) != 1 || seen[0] != "a" {
		t.Fatalf("any evaluated %v after its first true atom", seen)
	}
}

func TestEvaluateOperatorKeepsAliasesEquivalent(t *testing.T) {
	pairs := [][2]string{
		{"eq", "=="}, {"eq", "equals"}, {"ne", "!="}, {"ne", "not_equals"},
		{"gt", ">"}, {"gte", ">="}, {"lt", "<"}, {"lte", "<="},
		{"regex", "matches"}, {"between", "range"},
	}
	for _, pair := range pairs {
		canonical, ok := CanonicalOperator(pair[1])
		if !ok || canonical != pair[0] {
			t.Errorf("CanonicalOperator(%q) = %q, %v; want %q", pair[1], canonical, ok, pair[0])
		}
	}
	if _, err := EvaluateOperator("like", "a", "a"); err == nil {
		t.Fatal("expected an unknown operator to fail")
	}
}

func TestEveryOperatorSpellingEvaluates(t *testing.T) {
	for _, spelling := range conditions.Spellings() {
		if _, err := EvaluateOperator(spelling, "a", []any{"a", "b"}); err != nil {
			t.Errorf("%s: %v", spelling, err)
		}
	}
}
