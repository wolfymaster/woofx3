// Package fixturetest runs the shared contract fixtures in shared/contracts/<domain>/fixtures through a generated
// Go type. The same files run in the TypeScript and Rust tests, so one case fixes the verdict of all three languages.
package fixturetest

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

type suite struct {
	Schema string `json:"schema"`
	Cases  []struct {
		Name  string          `json:"name"`
		Valid bool            `json:"valid"`
		Value json.RawMessage `json:"value"`
		// UnknownFields marks a valid value carrying fields the type does not know, which an open reply allows and
		// decoding drops.
		UnknownFields bool `json:"unknownFields"`
	} `json:"cases"`
}

// Validatable is what ogen generates for every schema.
type Validatable interface {
	json.Unmarshaler
	json.Marshaler
	Validate() error
}

// Run decodes and validates each case of the fixture file with a fresh *T. A valid case must also encode back to
// the same JSON value, unless it carries fields the type does not know, so a producer's output is exactly what the
// fixture says it may be.
func Run[T any, P interface {
	*T
	Validatable
}](t *testing.T, domain, file, schema string) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", domain, "fixtures", file))
	if err != nil {
		t.Fatal(err)
	}
	var s suite
	if err := json.Unmarshal(raw, &s); err != nil {
		t.Fatal(err)
	}
	if s.Schema != schema {
		t.Fatalf("%s is for schema %s, the test runs %s", file, s.Schema, schema)
	}
	for _, c := range s.Cases {
		t.Run(c.Name, func(t *testing.T) {
			var v T
			err := P(&v).UnmarshalJSON(c.Value)
			if err == nil {
				err = P(&v).Validate()
			}
			if !c.Valid {
				if err == nil {
					t.Fatalf("accepted an invalid value: %s", c.Value)
				}
				return
			}
			if err != nil {
				t.Fatalf("refused a valid value: %v", err)
			}
			encoded, err := P(&v).MarshalJSON()
			if err != nil {
				t.Fatal(err)
			}
			if !c.UnknownFields && !equalJSON(t, encoded, c.Value) {
				t.Fatalf("round trip changed the value:\n got  %s\n want %s", encoded, c.Value)
			}
		})
	}
}

func equalJSON(t *testing.T, a, b []byte) bool {
	t.Helper()
	var x, y any
	if err := json.NewDecoder(bytes.NewReader(a)).Decode(&x); err != nil {
		t.Fatal(err)
	}
	if err := json.NewDecoder(bytes.NewReader(b)).Decode(&y); err != nil {
		t.Fatal(err)
	}
	return reflect.DeepEqual(x, y)
}
