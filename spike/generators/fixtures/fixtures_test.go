// Runs the shared platform-gateway fixtures through the code each generator emitted and through both Go validators
// that read the same OpenAPI document. Nothing here encodes the contract: type names are the only coupling.
package fixtures

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"gopkg.in/yaml.v3"

	oapi "github.com/wolfymaster/woofx3/spike/generators/gen/oapi/nats.31"
	ogen "github.com/wolfymaster/woofx3/spike/generators/gen/ogen/nats.31"
)

const (
	fixtureDir = "../in/fixtures"
	docPath    = "../work/nats.31.yaml"
	doc30Path  = "../work/nats.30.yaml"
)

type suite struct{ file, key, schema string }

var suites = []suite{
	{"requests.json", "request", "GatewayRequest"},
	{"replies.json", "reply", "GatewayReply"},
	{"capabilities-replies.json", "reply", "CapabilitiesReply"},
	{"field-options-requests.json", "request", "FieldOptionsRequest"},
	{"field-options-replies.json", "reply", "FieldOptionsReply"},
}

type fixture struct {
	suite suite
	name  string
	valid bool
	raw   []byte
}

func load(t *testing.T) []fixture {
	var out []fixture
	for _, s := range suites {
		b, err := os.ReadFile(filepath.Join(fixtureDir, s.file))
		if err != nil {
			t.Fatal(err)
		}
		var d struct {
			Cases []map[string]json.RawMessage `json:"cases"`
		}
		if err := json.Unmarshal(b, &d); err != nil {
			t.Fatal(err)
		}
		for _, c := range d.Cases {
			var name string
			_ = json.Unmarshal(c["name"], &name)
			out = append(out, fixture{s, name, string(c["invalidField"]) == "null", c[s.key]})
		}
	}
	return out
}

func norm(t *testing.T, raw []byte) any {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

// roundTrip decodes raw into T with the generated decoder and encodes it again.
func roundTrip[T any](raw []byte, validate func(*T) error) ([]byte, error) {
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	if validate != nil {
		if err := validate(&v); err != nil {
			return nil, fmt.Errorf("validate: %w", err)
		}
	}
	return json.Marshal(&v)
}

func oapiRT(name string, raw []byte) ([]byte, error) {
	switch name {
	case "GatewayRequest":
		var v oapi.GatewayRequest
		if err := json.Unmarshal(raw, &v); err != nil {
			return nil, err
		}
		variant, err := v.ValueByDiscriminator()
		if err != nil {
			return nil, err
		}
		return json.Marshal(variant)
	case "GatewayReply":
		return roundTrip[oapi.GatewayReply](raw, nil)
	case "CapabilitiesReply":
		return roundTrip[oapi.CapabilitiesReply](raw, nil)
	case "FieldOptionsRequest":
		return roundTrip[oapi.FieldOptionsRequest](raw, nil)
	case "FieldOptionsReply":
		return roundTrip[oapi.FieldOptionsReply](raw, nil)
	}
	panic(name)
}

func ogenRT(name string, raw []byte) ([]byte, error) {
	switch name {
	case "GatewayRequest":
		return roundTrip[ogen.GatewayRequest](raw, (*ogen.GatewayRequest).Validate)
	case "GatewayReply":
		return roundTrip[ogen.GatewayReply](raw, (*ogen.GatewayReply).Validate)
	case "CapabilitiesReply":
		return roundTrip[ogen.CapabilitiesReply](raw, (*ogen.CapabilitiesReply).Validate)
	case "FieldOptionsRequest":
		return roundTrip[ogen.FieldOptionsRequest](raw, (*ogen.FieldOptionsRequest).Validate)
	case "FieldOptionsReply":
		return roundTrip[ogen.FieldOptionsReply](raw, (*ogen.FieldOptionsReply).Validate)
	}
	panic(name)
}

// stripExtra drops additionalProperties:false, the consumer-side policy for replies.
func stripExtra(n any) any {
	switch v := n.(type) {
	case map[string]any:
		for k, x := range v {
			if k == "additionalProperties" && x == false {
				delete(v, k)
				continue
			}
			v[k] = stripExtra(x)
		}
	case []any:
		for i := range v {
			v[i] = stripExtra(v[i])
		}
	}
	return n
}

func santhosh(t *testing.T, lenient bool) func(schema string, raw []byte) error {
	b, err := os.ReadFile("../work/nats.31.json")
	if err != nil {
		t.Fatal(err)
	}
	var d any
	if err := json.Unmarshal(b, &d); err != nil {
		t.Fatal(err)
	}
	if lenient {
		d = stripExtra(d)
	}
	c := jsonschema.NewCompiler()
	c.AssertFormat()
	if err := c.AddResource("nats.json", d); err != nil {
		t.Fatal(err)
	}
	return func(schema string, raw []byte) error {
		s, err := c.Compile("nats.json#/components/schemas/" + schema)
		if err != nil {
			t.Fatal(err)
		}
		inst, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
		if err != nil {
			return err
		}
		return s.Validate(inst)
	}
}

func kin(t *testing.T, path string, lenient bool) func(schema string, raw []byte) error {
	if lenient {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var d any
		if err := yaml.Unmarshal(b, &d); err != nil {
			t.Fatal(err)
		}
		out, _ := json.Marshal(stripExtra(d))
		path = filepath.Join(t.TempDir(), "lenient.json")
		if err := os.WriteFile(path, out, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	l := openapi3.NewLoader()
	d, err := l.LoadFromFile(path)
	if err != nil {
		t.Logf("kin-openapi cannot load %s: %v", path, err)
		return nil
	}
	return func(schema string, raw []byte) error {
		s := d.Components.Schemas[schema]
		var v any
		_ = json.Unmarshal(raw, &v)
		return s.Value.VisitJSON(v, openapi3.MultiErrors(), openapi3.EnableFormatValidation())
	}
}

type outcome struct{ accepted bool }

func TestFixtures(t *testing.T) {
	_ = context.Background
	cases := load(t)
	type tool struct {
		name string
		run  func(f fixture) (accepted bool, detail string)
	}
	rtTool := func(name string, rt func(string, []byte) ([]byte, error)) tool {
		return tool{name, func(f fixture) (bool, string) {
			out, err := rt(f.suite.schema, f.raw)
			if err != nil {
				return false, err.Error()
			}
			if f.valid && !reflect.DeepEqual(norm(t, out), norm(t, f.raw)) {
				return true, "ACCEPTED BUT NOT ROUND-TRIPPED: " + string(out)
			}
			return true, ""
		}}
	}
	vTool := func(name string, strict, lenient func(string, []byte) error) tool {
		return tool{name, func(f fixture) (bool, string) {
			fn := strict
			if strings.Contains(f.suite.file, "replies") {
				fn = lenient
			}
			if err := fn(f.suite.schema, f.raw); err != nil {
				return false, err.Error()
			}
			return true, ""
		}}
	}
	tools := []tool{
		rtTool("oapi-codegen types", oapiRT),
		rtTool("ogen types+Validate", ogenRT),
		vTool("santhosh on 3.1 doc", santhosh(t, false), santhosh(t, true)),
	}
	if k := kin(t, docPath, false); k != nil {
		tools = append(tools, vTool("kin-openapi on 3.1 doc", k, kin(t, docPath, true)))
	}
	if k := kin(t, doc30Path, false); k != nil {
		tools = append(tools, vTool("kin-openapi on 3.0.3 doc", k, kin(t, doc30Path, true)))
	}
	for _, tl := range tools {
		wrongValid, wrongInvalid := []string{}, []string{}
		for _, f := range cases {
			acc, detail := tl.run(f)
			switch {
			case f.valid && !acc:
				wrongValid = append(wrongValid, fmt.Sprintf("  REJECTS VALID   %s/%s: %s", f.suite.file, f.name, trunc(detail)))
			case f.valid && strings.HasPrefix(detail, "ACCEPTED BUT"):
				wrongValid = append(wrongValid, fmt.Sprintf("  LOSSY ROUNDTRIP %s/%s: %s", f.suite.file, f.name, trunc(detail)))
			case !f.valid && acc:
				wrongInvalid = append(wrongInvalid, fmt.Sprintf("  ACCEPTS INVALID %s/%s", f.suite.file, f.name))
			}
		}
		sort.Strings(wrongValid)
		sort.Strings(wrongInvalid)
		t.Logf("== %s: %d cases, %d valid fixtures mishandled, %d invalid fixtures accepted\n%s\n%s",
			tl.name, len(cases), len(wrongValid), len(wrongInvalid), strings.Join(wrongValid, "\n"), strings.Join(wrongInvalid, "\n"))
	}
}

func trunc(s string) string {
	if len(s) > 160 {
		return s[:160] + "..."
	}
	return s
}

// A bound read through kin-openapi's typed schema model, not copied into code.
func TestBoundFromDocument(t *testing.T) {
	d, err := openapi3.NewLoader().LoadFromFile(docPath)
	if err != nil {
		t.Fatal(err)
	}
	max := d.Components.Schemas["StreamOnlineEvent"].Value.Properties["twitchUserId"].Value.MaxLength
	if max == nil || *max != 200 {
		t.Fatalf("maxLength = %v", max)
	}
}
