package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
)

// platformGatewaySource is the contract's path from the repository root, as
// the generated files name it.
const platformGatewaySource = "shared/common/contracts/platform-gateway.json"

// targetKinds are the ways a request picks its platforms. They are fixed by
// the generator rather than listed in the contract because each kind has its
// own shape (ids for platforms, origin for origin) and resolution rule.
func targetKinds() []string {
	return []string{"all", "platforms", "origin"}
}

// platformGateway is shared/common/contracts/platform-gateway.json. Every
// field is required; unknown keys are refused so an entry added to the JSON
// cannot be silently left out of the generated code.
type platformGateway struct {
	Subjects           gatewaySubjects `json:"subjects"`
	Platforms          []platform      `json:"platforms"`
	Requesters         []string        `json:"requesters"`
	FailureCodes       []string        `json:"failureCodes"`
	OutcomeStatuses    []string        `json:"outcomeStatuses"`
	UnavailableReasons []string        `json:"unavailableReasons"`
	Actions            []action        `json:"actions"`
}

type gatewaySubjects struct {
	Send         string `json:"send"`
	Capabilities string `json:"capabilities"`
	FieldOptions string `json:"fieldOptions"`
}

type platform struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
}

// action declares its payload either as one set of fields or as oneOf
// variants, never both.
type action struct {
	ID     string    `json:"id"`
	Fields []field   `json:"fields"`
	OneOf  []variant `json:"oneOf"`
}

type variant struct {
	Name   string  `json:"name"`
	Fields []field `json:"fields"`
}

type fieldType string

const (
	fieldString  fieldType = "string"
	fieldInteger fieldType = "integer"
)

// field is one payload property. Strings must declare maxLength and integers
// min and max, so every value the gateway accepts is bounded.
type field struct {
	Name      string    `json:"name"`
	Type      fieldType `json:"type"`
	Required  bool      `json:"required"`
	MaxLength *int      `json:"maxLength"`
	Min       *int      `json:"min"`
	Max       *int      `json:"max"`
}

// variants returns the action's payload forms; an action declared with plain
// fields has exactly one, with no name.
func (a action) variants() []variant {
	if len(a.OneOf) > 0 {
		return a.OneOf
	}
	return []variant{{Fields: a.Fields}}
}

// outcomeFieldKind says how a PlatformOutcome field is checked.
type outcomeFieldKind string

const (
	outcomeText              outcomeFieldKind = "text"
	outcomeFailureCode       outcomeFieldKind = "failureCode"
	outcomeUnavailableReason outcomeFieldKind = "unavailableReason"
)

type outcomeField struct {
	Name     string
	Kind     outcomeFieldKind
	Required bool
}

// outcomeShapes holds the fields each outcome status carries. The contract
// names the statuses; their shapes live here because each one is read by
// code (replyOk, the workflow step summary) rather than passed through, so a
// new status needs code beside it anyway.
func outcomeShapes() map[string][]outcomeField {
	return map[string][]outcomeField{
		"delivered":   {{Name: "messageId", Kind: outcomeText}},
		"dropped":     {{Name: "reason", Kind: outcomeText, Required: true}},
		"unsupported": {},
		"unavailable": {{Name: "reason", Kind: outcomeUnavailableReason, Required: true}},
		"unconfirmed": {{Name: "message", Kind: outcomeText, Required: true}},
		"failed": {
			{Name: "code", Kind: outcomeFailureCode, Required: true},
			{Name: "message", Kind: outcomeText, Required: true},
			{Name: "messageId", Kind: outcomeText},
		},
	}
}

// maxSafeInteger is JavaScript's Number.MAX_SAFE_INTEGER, the largest
// integer a TypeScript reader holds exactly.
const maxSafeInteger = 1<<53 - 1

var (
	subjectPattern   = regexp.MustCompile(`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`)
	platformPattern  = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)
	enumValuePattern = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)
	actionIDPattern  = regexp.MustCompile(`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`)
	fieldNamePattern = regexp.MustCompile(`^[a-z][a-zA-Z0-9]*$`)
	errRequired      = errors.New("is required")
)

func parsePlatformGateway(raw []byte) (platformGateway, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var c platformGateway
	if err := decoder.Decode(&c); err != nil {
		return platformGateway{}, fmt.Errorf("decoding: %w", err)
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return platformGateway{}, errors.New("decoding: trailing data after the contract object")
	}
	if err := c.validate(); err != nil {
		return platformGateway{}, err
	}
	return c, nil
}

func (c platformGateway) validate() error {
	subjects := map[string]string{
		"subjects.send":         c.Subjects.Send,
		"subjects.capabilities": c.Subjects.Capabilities,
		"subjects.fieldOptions": c.Subjects.FieldOptions,
	}
	seenSubjects := map[string]string{}
	for _, key := range []string{"subjects.send", "subjects.capabilities", "subjects.fieldOptions"} {
		subject := subjects[key]
		if !subjectPattern.MatchString(subject) {
			return fmt.Errorf("%s: %q is not a dotted lowercase subject", key, subject)
		}
		if other, ok := seenSubjects[subject]; ok {
			return fmt.Errorf("%s: %q is also %s", key, subject, other)
		}
		seenSubjects[subject] = key
	}

	if len(c.Platforms) == 0 {
		return fmt.Errorf("platforms: %w", errRequired)
	}
	seenPlatforms := map[string]bool{}
	for i, p := range c.Platforms {
		if !platformPattern.MatchString(p.ID) {
			return fmt.Errorf("platforms[%d].id: %q must match %s", i, p.ID, platformPattern)
		}
		if seenPlatforms[p.ID] {
			return fmt.Errorf("platforms[%d].id: duplicate platform %q", i, p.ID)
		}
		seenPlatforms[p.ID] = true
		if strings.TrimSpace(p.DisplayName) == "" {
			return fmt.Errorf("platforms[%d].displayName: %w", i, errRequired)
		}
	}

	for _, list := range []struct {
		key    string
		values []string
	}{
		{"requesters", c.Requesters},
		{"failureCodes", c.FailureCodes},
		{"outcomeStatuses", c.OutcomeStatuses},
		{"unavailableReasons", c.UnavailableReasons},
	} {
		if err := validateEnum(list.key, list.values); err != nil {
			return err
		}
	}
	shapes := outcomeShapes()
	for i, status := range c.OutcomeStatuses {
		if _, ok := shapes[status]; !ok {
			return fmt.Errorf("outcomeStatuses[%d]: the generator has no outcome shape for %q", i, status)
		}
	}

	if len(c.Actions) == 0 {
		return fmt.Errorf("actions: %w", errRequired)
	}
	seenActions := map[string]bool{}
	for i, a := range c.Actions {
		key := fmt.Sprintf("actions[%d]", i)
		if !actionIDPattern.MatchString(a.ID) {
			return fmt.Errorf("%s.id: %q must match %s", key, a.ID, actionIDPattern)
		}
		if seenActions[a.ID] {
			return fmt.Errorf("%s.id: duplicate action %q", key, a.ID)
		}
		seenActions[a.ID] = true
		if err := a.validate(key); err != nil {
			return err
		}
	}
	return nil
}

func validateEnum(key string, values []string) error {
	if len(values) == 0 {
		return fmt.Errorf("%s: %w", key, errRequired)
	}
	seen := map[string]bool{}
	for i, value := range values {
		if !enumValuePattern.MatchString(value) {
			return fmt.Errorf("%s[%d]: %q must match %s", key, i, value, enumValuePattern)
		}
		if seen[value] {
			return fmt.Errorf("%s[%d]: duplicate value %q", key, i, value)
		}
		seen[value] = true
	}
	return nil
}

func (a action) validate(key string) error {
	hasFields, hasOneOf := len(a.Fields) > 0, len(a.OneOf) > 0
	if hasFields == hasOneOf {
		return fmt.Errorf("%s: declare exactly one of fields or oneOf", key)
	}
	if hasFields {
		return validateFields(key+".fields", a.Fields)
	}
	if len(a.OneOf) < 2 {
		return fmt.Errorf("%s.oneOf: needs at least two variants; use fields for one", key)
	}
	seenVariants := map[string]bool{}
	// Variants own disjoint field names, so the fields a payload carries
	// pick its variant without a discriminant key.
	fieldOwner := map[string]string{}
	for i, v := range a.OneOf {
		variantKey := fmt.Sprintf("%s.oneOf[%d]", key, i)
		if !fieldNamePattern.MatchString(v.Name) {
			return fmt.Errorf("%s.name: %q must match %s", variantKey, v.Name, fieldNamePattern)
		}
		if seenVariants[v.Name] {
			return fmt.Errorf("%s.name: duplicate variant %q", variantKey, v.Name)
		}
		seenVariants[v.Name] = true
		if err := validateFields(variantKey+".fields", v.Fields); err != nil {
			return err
		}
		for _, f := range v.Fields {
			if owner, ok := fieldOwner[f.Name]; ok {
				return fmt.Errorf("%s.fields: %q is also a field of variant %q; variants need disjoint fields", variantKey, f.Name, owner)
			}
			fieldOwner[f.Name] = v.Name
		}
	}
	return nil
}

func validateFields(key string, fields []field) error {
	if len(fields) == 0 {
		return fmt.Errorf("%s: %w", key, errRequired)
	}
	seen := map[string]bool{}
	for i, f := range fields {
		fieldKey := fmt.Sprintf("%s[%d]", key, i)
		if !fieldNamePattern.MatchString(f.Name) {
			return fmt.Errorf("%s.name: %q must match %s", fieldKey, f.Name, fieldNamePattern)
		}
		if seen[f.Name] {
			return fmt.Errorf("%s.name: duplicate field %q", fieldKey, f.Name)
		}
		seen[f.Name] = true
		switch f.Type {
		case fieldString:
			if f.MaxLength == nil || *f.MaxLength < 1 {
				return fmt.Errorf("%s: a string field needs a positive maxLength", fieldKey)
			}
			if f.Min != nil || f.Max != nil {
				return fmt.Errorf("%s: min and max apply to integer fields only", fieldKey)
			}
		case fieldInteger:
			if f.Min == nil || f.Max == nil {
				return fmt.Errorf("%s: an integer field needs min and max", fieldKey)
			}
			if *f.Min < -maxSafeInteger || *f.Max > maxSafeInteger {
				return fmt.Errorf("%s: min and max must be within ±%d so TypeScript reads them exactly", fieldKey, maxSafeInteger)
			}
			if *f.Min > *f.Max {
				return fmt.Errorf("%s: min %d is above max %d", fieldKey, *f.Min, *f.Max)
			}
			if f.MaxLength != nil {
				return fmt.Errorf("%s: maxLength applies to string fields only", fieldKey)
			}
		default:
			return fmt.Errorf("%s.type: %q is not one of string, integer", fieldKey, f.Type)
		}
	}
	return nil
}
