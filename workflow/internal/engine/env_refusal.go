package engine

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// envReferenceMarker opens an expression that reads the `env` source. The
// resolver has no such source, so a reference to it fails at run time anyway;
// refusing it when the workflow is accepted tells the author why, with the
// path, instead of every run failing on an unknown source. Only the plain
// `${env.` form is matched; compound or spaced forms still fail at run time
// with an unknown-source error, which is the backstop. A step whose id is
// `env` is a real source, so the refusal applies to the token whatever the
// source would have been.
const envReferenceMarker = "${env."

// ErrEnvReference is returned, wrapped with the JSON path of the offending
// value, for a definition that references `${env.*}`. Must match the message
// in api/src/workflow/validate-definition.ts.
var ErrEnvReference = errors.New("${env.*} is not available to workflows: use module settings or secrets")

// refuseEnvReferences walks every string value of the definition, as it is
// serialized, so trigger conditions, step parameters at any depth, conditions,
// wait configs and sub-workflow event data are all covered without listing
// each field. Paths use the api validator's form, e.g.
// `tasks[0].parameters.headers.auth`.
func refuseEnvReferences(def *types.WorkflowDefinition) error {
	encoded, err := json.Marshal(def)
	if err != nil {
		return fmt.Errorf("encoding definition to check for env references: %w", err)
	}
	var tree any
	if err := json.Unmarshal(encoded, &tree); err != nil {
		return fmt.Errorf("decoding definition to check for env references: %w", err)
	}
	if path, found := findEnvReference(tree, ""); found {
		return fmt.Errorf("%s: %w", path, ErrEnvReference)
	}
	return nil
}

// findEnvReference returns the path of the first string under value that
// contains envReferenceMarker. Map keys are visited in sorted order so the
// reported path is the same on every call.
func findEnvReference(value any, path string) (string, bool) {
	switch v := value.(type) {
	case string:
		if strings.Contains(v, envReferenceMarker) {
			return path, true
		}
	case []any:
		for i, item := range v {
			if found, ok := findEnvReference(item, fmt.Sprintf("%s[%d]", path, i)); ok {
				return found, true
			}
		}
	case map[string]any:
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		slices.Sort(keys)
		for _, key := range keys {
			child := key
			if path != "" {
				child = path + "." + key
			}
			if found, ok := findEnvReference(v[key], child); ok {
				return found, true
			}
		}
	}
	return "", false
}
