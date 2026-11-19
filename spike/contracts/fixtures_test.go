package contracts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// knownGaps are the cases JSON Schema cannot express; each pins the disagreement so closing a gap fails the test.
var knownGaps = map[string]bool{
	"requests.json: an empty ids list on an all target counts as absent":  true,
	"requests.json: a null origin on a platforms target counts as absent": true,
	"capabilities-replies.json: a platform listed twice":                  true,
	"field-options-requests.json: an unknown key is ignored":              true,
}

const fixtureDir = "../../shared/common/contracts/testdata/platform-gateway"

func TestFixtures(t *testing.T) {
	strict, err := NewValidators(Strict)
	if err != nil {
		t.Fatal(err)
	}
	lenient, err := NewValidators(Lenient)
	if err != nil {
		t.Fatal(err)
	}
	suites := []struct {
		file, key, schema string
		v                 *Validators
	}{
		{"requests.json", "request", "platform-gateway/gateway-request.json", strict},
		{"replies.json", "reply", "platform-gateway/gateway-reply.json", lenient},
		{"capabilities-replies.json", "reply", "platform-gateway/capabilities-reply.json", lenient},
		{"field-options-requests.json", "request", "platform-gateway/field-options-request.json", strict},
		{"field-options-replies.json", "reply", "platform-gateway/field-options-reply.json", lenient},
	}
	for _, s := range suites {
		raw, err := os.ReadFile(filepath.Join(fixtureDir, s.file))
		if err != nil {
			t.Fatal(err)
		}
		var doc struct {
			Cases []map[string]json.RawMessage `json:"cases"`
		}
		if err := json.Unmarshal(raw, &doc); err != nil {
			t.Fatal(err)
		}
		for _, c := range doc.Cases {
			var name string
			_ = json.Unmarshal(c["name"], &name)
			valid := string(c["invalidField"]) == "null"
			if knownGaps[s.file+": "+name] {
				valid = !valid
			}
			t.Run(s.file+"/"+name, func(t *testing.T) {
				err := s.v.Validate(s.schema, c[s.key])
				if valid && err != nil {
					t.Errorf("valid but refused: %v", err)
				}
				if !valid && err == nil {
					t.Errorf("invalid but accepted")
				}
			})
		}
	}
}
