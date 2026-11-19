// Package contracts validates woofx3 messages against the JSON Schema files in schemas/, which are embedded in the
// binary so no network or file access is needed at run time.
package contracts

import (
	"bytes"
	"embed"
	"fmt"
	"io/fs"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

//go:embed schemas
var schemaFiles embed.FS

const schemaBase = "https://schemas.woofx3.tv/contracts/"

// Strictness picks how unknown fields are treated: producers refuse them, consumers tolerate them.
type Strictness int

const (
	// Strict keeps additionalProperties:false as written. For validating what this process sends.
	Strict Strictness = iota
	// Lenient drops additionalProperties:false so a newer producer can add fields. For validating what this process reads.
	Lenient
)

// Validators compiles every schema once; it is safe for concurrent use.
type Validators struct {
	compiler *jsonschema.Compiler
	cache    map[string]*jsonschema.Schema
}

// NewValidators loads and compiles every embedded schema. It fails on any schema the library cannot compile.
func NewValidators(mode Strictness) (*Validators, error) {
	compiler := jsonschema.NewCompiler()
	compiler.DefaultDraft(jsonschema.Draft2020)
	compiler.AssertFormat()
	var paths []string
	err := fs.WalkDir(schemaFiles, "schemas", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".json") {
			return err
		}
		raw, err := schemaFiles.ReadFile(path)
		if err != nil {
			return err
		}
		doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
		if err != nil {
			return fmt.Errorf("parsing %s: %w", path, err)
		}
		if mode == Lenient {
			doc = allowExtraFields(doc)
		}
		rel := strings.TrimPrefix(path, "schemas/")
		if err := compiler.AddResource(schemaBase+rel, doc); err != nil {
			return fmt.Errorf("adding %s: %w", path, err)
		}
		paths = append(paths, rel)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("loading schemas: %w", err)
	}
	v := &Validators{compiler: compiler, cache: map[string]*jsonschema.Schema{}}
	for _, rel := range paths {
		s, err := compiler.Compile(schemaBase + rel)
		if err != nil {
			return nil, fmt.Errorf("compiling %s: %w", rel, err)
		}
		v.cache[rel] = s
	}
	return v, nil
}

// Validate checks raw JSON against the schema at path (relative to schemas/, such as "platform-gateway/gateway-request.json").
func (v *Validators) Validate(path string, raw []byte) error {
	s, ok := v.cache[path]
	if !ok {
		return fmt.Errorf("no schema %q", path)
	}
	// UnmarshalJSON keeps numbers exact, so 30.0 is an integer and 1.5 is not.
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("not JSON: %w", err)
	}
	return s.Validate(doc)
}

func allowExtraFields(node any) any {
	switch n := node.(type) {
	case map[string]any:
		out := make(map[string]any, len(n))
		for k, val := range n {
			if k == "additionalProperties" && val == false {
				continue
			}
			out[k] = allowExtraFields(val)
		}
		return out
	case []any:
		out := make([]any, len(n))
		for i, val := range n {
			out[i] = allowExtraFields(val)
		}
		return out
	}
	return node
}

