package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

// companionGatewaySource is the contract's path from the repository root, as
// the generated files name it.
const companionGatewaySource = "shared/common/contracts/companion-gateway.json"

// companionGateway is shared/common/contracts/companion-gateway.json: the
// subjects the companion gateway answers, and the messages they carry.
// Unknown keys are refused, and so is any declared format, enum, object or
// message that nothing uses, so every entry reaches the generated code.
type companionGateway struct {
	Subjects []companionSubject `json:"subjects"`
	Formats  []stringFormat     `json:"formats"`
	Enums    []namedEnum        `json:"enums"`
	Objects  []objectType       `json:"objects"`
	Messages []message          `json:"messages"`

	// formats holds each format's pattern taken apart, filled once the
	// contract is valid.
	formats map[string]parsedFormat
}

// companionSubject is one request/reply subject and the messages it carries.
// Replies are raw JSON with no CloudEvent envelope.
type companionSubject struct {
	Name    string `json:"name"`
	Subject string `json:"subject"`
	Request string `json:"request"`
	Reply   string `json:"reply"`
}

// stringFormat names a pattern several fields share. Patterns are limited to
// one character class with a length range, `^[...]{min,max}$`, which every
// language checks without a regular-expression engine.
type stringFormat struct {
	Name    string `json:"name"`
	Pattern string `json:"pattern"`
}

type namedEnum struct {
	Name   string   `json:"name"`
	Values []string `json:"values"`
}

// objectType is a nested object a field holds. Its fields are plain values;
// objects do not nest further.
type objectType struct {
	Name   string           `json:"name"`
	Fields []companionField `json:"fields"`
}

// message is a top-level body, a union whose variant is picked by the string
// in its discriminant field.
type message struct {
	Name         string           `json:"name"`
	Discriminant string           `json:"discriminant"`
	Variants     []messageVariant `json:"variants"`
}

type messageVariant struct {
	Tag    string           `json:"tag"`
	Name   string           `json:"name"`
	Fields []companionField `json:"fields"`
}

type companionFieldType string

const (
	companionString          companionFieldType = "string"
	companionInteger         companionFieldType = "integer"
	companionStringOrInteger companionFieldType = "stringOrInteger"
	companionEnum            companionFieldType = "enum"
	companionObject          companionFieldType = "object"
)

// companionField is one property. Every value is bounded: a string by
// exactly one of maxLength (code points), maxBytes (UTF-8) or format; an
// integer by min and max; a stringOrInteger by all three of maxLength, min
// and max. An enum or object field names its declaration.
type companionField struct {
	Name      string             `json:"name"`
	Type      companionFieldType `json:"type"`
	Required  bool               `json:"required"`
	MaxLength *int               `json:"maxLength"`
	MaxBytes  *int               `json:"maxBytes"`
	Format    string             `json:"format"`
	Min       *int64             `json:"min"`
	Max       *int64             `json:"max"`
	Enum      string             `json:"enum"`
	Object    string             `json:"object"`
}

// charRange is an inclusive range of ASCII characters; a single character
// has From == To.
type charRange struct {
	From byte
	To   byte
}

// parsedFormat is a format's pattern taken apart.
type parsedFormat struct {
	Ranges []charRange
	Min    int
	Max    int
}

var (
	typeNamePattern = regexp.MustCompile(`^[a-z][a-zA-Z0-9]*$`)
	formatPattern   = regexp.MustCompile(`^\^\[([^\]]+)\]\{([0-9]+),([0-9]+)\}\$$`)
)

// formatLiterals are the punctuation characters a format's class may list.
// Each means itself inside a character class in every target language, and
// '-' is accepted only as the class's last character.
const formatLiterals = "._-"

func parseCompanionGateway(raw []byte) (companionGateway, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var c companionGateway
	if err := decoder.Decode(&c); err != nil {
		return companionGateway{}, fmt.Errorf("decoding: %w", err)
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return companionGateway{}, errors.New("decoding: trailing data after the contract object")
	}
	if err := c.validate(); err != nil {
		return companionGateway{}, err
	}
	c.formats = map[string]parsedFormat{}
	for _, f := range c.Formats {
		parsed, err := parseFormat(f.Pattern)
		if err != nil {
			return companionGateway{}, err
		}
		c.formats[f.Name] = parsed
	}
	return c, nil
}

func (c companionGateway) validate() error {
	// Enums, objects, messages and variants become types side by side in each
	// language, so their names share one namespace.
	typeNames := map[string]string{}
	claimType := func(key, name string) error {
		if !typeNamePattern.MatchString(name) {
			return fmt.Errorf("%s: %q must match %s", key, name, typeNamePattern)
		}
		if other, ok := typeNames[name]; ok {
			return fmt.Errorf("%s: %q is also %s", key, name, other)
		}
		typeNames[name] = key
		return nil
	}

	formats := map[string]bool{}
	for i, f := range c.Formats {
		key := fmt.Sprintf("formats[%d]", i)
		if !fieldNamePattern.MatchString(f.Name) {
			return fmt.Errorf("%s.name: %q must match %s", key, f.Name, fieldNamePattern)
		}
		if formats[f.Name] {
			return fmt.Errorf("%s.name: duplicate format %q", key, f.Name)
		}
		formats[f.Name] = true
		if _, err := parseFormat(f.Pattern); err != nil {
			return fmt.Errorf("%s.pattern: %w", key, err)
		}
	}

	enums := map[string]bool{}
	for i, e := range c.Enums {
		key := fmt.Sprintf("enums[%d]", i)
		if err := claimType(key+".name", e.Name); err != nil {
			return err
		}
		if err := validateEnum(key+".values", e.Values); err != nil {
			return err
		}
		enums[e.Name] = true
	}

	refs := declarations{formats: formats, enums: enums, objects: map[string]bool{}}
	for i, o := range c.Objects {
		key := fmt.Sprintf("objects[%d]", i)
		if err := claimType(key+".name", o.Name); err != nil {
			return err
		}
		// Objects are checked before any field may name one, so an object
		// field inside an object finds no declaration and is refused.
		if err := validateCompanionFields(key+".fields", o.Fields, refs, ""); err != nil {
			return err
		}
	}
	for _, o := range c.Objects {
		refs.objects[o.Name] = true
	}

	messages := map[string]bool{}
	for i, m := range c.Messages {
		key := fmt.Sprintf("messages[%d]", i)
		if err := claimType(key+".name", m.Name); err != nil {
			return err
		}
		if err := m.validate(key, refs, claimType); err != nil {
			return err
		}
		messages[m.Name] = true
	}

	if len(c.Subjects) == 0 {
		return fmt.Errorf("subjects: %w", errRequired)
	}
	subjectNames := map[string]bool{}
	subjects := map[string]bool{}
	carried := map[string]string{}
	for i, s := range c.Subjects {
		key := fmt.Sprintf("subjects[%d]", i)
		if !fieldNamePattern.MatchString(s.Name) {
			return fmt.Errorf("%s.name: %q must match %s", key, s.Name, fieldNamePattern)
		}
		if subjectNames[s.Name] {
			return fmt.Errorf("%s.name: duplicate subject name %q", key, s.Name)
		}
		subjectNames[s.Name] = true
		if !subjectPattern.MatchString(s.Subject) {
			return fmt.Errorf("%s.subject: %q is not a dotted lowercase name", key, s.Subject)
		}
		if subjects[s.Subject] {
			return fmt.Errorf("%s.subject: duplicate subject %q", key, s.Subject)
		}
		subjects[s.Subject] = true
		for _, role := range []struct{ key, name string }{{"request", s.Request}, {"reply", s.Reply}} {
			if !messages[role.name] {
				return fmt.Errorf("%s.%s: %q is not a declared message", key, role.key, role.name)
			}
			if other, ok := carried[role.name]; ok {
				return fmt.Errorf("%s.%s: message %q is also %s", key, role.key, role.name, other)
			}
			carried[role.name] = key + "." + role.key
		}
	}
	for _, m := range c.Messages {
		if _, ok := carried[m.Name]; !ok {
			return fmt.Errorf("messages: %q is carried by no subject", m.Name)
		}
	}

	used := c.usedDeclarations()
	for _, list := range []struct {
		kind  string
		names []string
	}{
		{"format", namesOf(c.Formats, func(f stringFormat) string { return f.Name })},
		{"enum", namesOf(c.Enums, func(e namedEnum) string { return e.Name })},
		{"object", namesOf(c.Objects, func(o objectType) string { return o.Name })},
	} {
		for _, name := range list.names {
			if !used[list.kind+":"+name] {
				return fmt.Errorf("%ss: %q is used by no field", list.kind, name)
			}
		}
	}
	return nil
}

// declarations are the names a field may refer to.
type declarations struct {
	formats map[string]bool
	enums   map[string]bool
	objects map[string]bool
}

func (m message) validate(key string, refs declarations, claimType func(key, name string) error) error {
	if !fieldNamePattern.MatchString(m.Discriminant) {
		return fmt.Errorf("%s.discriminant: %q must match %s", key, m.Discriminant, fieldNamePattern)
	}
	if len(m.Variants) < 2 {
		return fmt.Errorf("%s.variants: needs at least two variants", key)
	}
	tags := map[string]bool{}
	for i, v := range m.Variants {
		variantKey := fmt.Sprintf("%s.variants[%d]", key, i)
		if !enumValuePattern.MatchString(v.Tag) {
			return fmt.Errorf("%s.tag: %q must match %s", variantKey, v.Tag, enumValuePattern)
		}
		if tags[v.Tag] {
			return fmt.Errorf("%s.tag: duplicate tag %q", variantKey, v.Tag)
		}
		tags[v.Tag] = true
		if err := claimType(variantKey+".name", v.Name); err != nil {
			return err
		}
		if err := validateCompanionFields(variantKey+".fields", v.Fields, refs, m.Discriminant); err != nil {
			return err
		}
	}
	return nil
}

// validateCompanionFields checks one object's fields. reserved is a name no
// field may take: the discriminant of the message the fields belong to.
func validateCompanionFields(key string, fields []companionField, refs declarations, reserved string) error {
	if len(fields) == 0 {
		return fmt.Errorf("%s: %w", key, errRequired)
	}
	seen := map[string]bool{}
	for i, f := range fields {
		fieldKey := fmt.Sprintf("%s[%d]", key, i)
		if !fieldNamePattern.MatchString(f.Name) {
			return fmt.Errorf("%s.name: %q must match %s", fieldKey, f.Name, fieldNamePattern)
		}
		if f.Name == reserved {
			return fmt.Errorf("%s.name: %q is the message's discriminant", fieldKey, f.Name)
		}
		if seen[f.Name] {
			return fmt.Errorf("%s.name: duplicate field %q", fieldKey, f.Name)
		}
		seen[f.Name] = true
		if err := f.validate(fieldKey, refs); err != nil {
			return err
		}
	}
	return nil
}

func (f companionField) validate(key string, refs declarations) error {
	allowed := map[companionFieldType][]string{
		companionString:          {"maxLength", "maxBytes", "format"},
		companionInteger:         {"min", "max"},
		companionStringOrInteger: {"maxLength", "min", "max"},
		companionEnum:            {"enum"},
		companionObject:          {"object"},
	}
	permitted, ok := allowed[f.Type]
	if !ok {
		return fmt.Errorf("%s.type: %q is not one of string, integer, stringOrInteger, enum, object", key, f.Type)
	}
	for _, name := range f.boundsSet() {
		if !slices.Contains(permitted, name) {
			return fmt.Errorf("%s: %s does not apply to a %s field", key, name, f.Type)
		}
	}
	if f.MaxLength != nil && *f.MaxLength < 1 {
		return fmt.Errorf("%s: maxLength must be positive", key)
	}
	if f.MaxBytes != nil && *f.MaxBytes < 1 {
		return fmt.Errorf("%s: maxBytes must be positive", key)
	}
	if f.Min != nil || f.Max != nil {
		if f.Min == nil || f.Max == nil {
			return fmt.Errorf("%s: an integer needs both min and max", key)
		}
		if *f.Min < -maxSafeInteger || *f.Max > maxSafeInteger {
			return fmt.Errorf("%s: min and max must be within ±%d so TypeScript reads them exactly", key, maxSafeInteger)
		}
		if *f.Min > *f.Max {
			return fmt.Errorf("%s: min %d is above max %d", key, *f.Min, *f.Max)
		}
	}
	switch f.Type {
	case companionString:
		if len(f.boundsSet()) != 1 {
			return fmt.Errorf("%s: a string field needs exactly one of maxLength, maxBytes or format", key)
		}
		if f.Format != "" && !refs.formats[f.Format] {
			return fmt.Errorf("%s.format: %q is not a declared format", key, f.Format)
		}
	case companionInteger:
		if f.Min == nil {
			return fmt.Errorf("%s: an integer field needs min and max", key)
		}
	case companionStringOrInteger:
		if f.MaxLength == nil || f.Min == nil {
			return fmt.Errorf("%s: a stringOrInteger field needs maxLength, min and max", key)
		}
	case companionEnum:
		if !refs.enums[f.Enum] {
			return fmt.Errorf("%s.enum: %q is not a declared enum", key, f.Enum)
		}
	case companionObject:
		if !refs.objects[f.Object] {
			return fmt.Errorf("%s.object: %q is not a declared object; objects do not nest", key, f.Object)
		}
	}
	return nil
}

// boundsSet lists the type-specific keys the field carries.
func (f companionField) boundsSet() []string {
	var set []string
	if f.MaxLength != nil {
		set = append(set, "maxLength")
	}
	if f.MaxBytes != nil {
		set = append(set, "maxBytes")
	}
	if f.Format != "" {
		set = append(set, "format")
	}
	if f.Min != nil {
		set = append(set, "min")
	}
	if f.Max != nil {
		set = append(set, "max")
	}
	if f.Enum != "" {
		set = append(set, "enum")
	}
	if f.Object != "" {
		set = append(set, "object")
	}
	return set
}

// parseFormat takes a `^[class]{min,max}$` pattern apart. The class lists
// ASCII letters, digits, ranges within one of those, and formatLiterals.
func parseFormat(pattern string) (parsedFormat, error) {
	match := formatPattern.FindStringSubmatch(pattern)
	if match == nil {
		return parsedFormat{}, fmt.Errorf("%q is not of the form ^[class]{min,max}$", pattern)
	}
	class := match[1]
	minLength, minErr := strconv.Atoi(match[2])
	maxLength, maxErr := strconv.Atoi(match[3])
	if minErr != nil || maxErr != nil || minLength < 1 || minLength > maxLength {
		return parsedFormat{}, fmt.Errorf("%q needs lengths 1 <= min <= max", pattern)
	}
	var ranges []charRange
	for i := 0; i < len(class); i++ {
		c := class[i]
		if i+2 < len(class) && class[i+1] == '-' {
			to := class[i+2]
			if !sameAlnumKind(c, to) || c > to {
				return parsedFormat{}, fmt.Errorf("%q: %c-%c is not a range of letters or digits", pattern, c, to)
			}
			ranges = append(ranges, charRange{From: c, To: to})
			i += 2
			continue
		}
		if c == '-' && i != len(class)-1 {
			return parsedFormat{}, fmt.Errorf("%q: '-' must be the last character of the class", pattern)
		}
		if alnumKind(c) == "" && !strings.ContainsRune(formatLiterals, rune(c)) {
			return parsedFormat{}, fmt.Errorf("%q: %q may not appear in a class; use letters, digits or one of %q", pattern, c, formatLiterals)
		}
		ranges = append(ranges, charRange{From: c, To: c})
	}
	return parsedFormat{Ranges: ranges, Min: minLength, Max: maxLength}, nil
}

func alnumKind(c byte) string {
	switch {
	case c >= 'a' && c <= 'z':
		return "lower"
	case c >= 'A' && c <= 'Z':
		return "upper"
	case c >= '0' && c <= '9':
		return "digit"
	}
	return ""
}

func sameAlnumKind(a, b byte) bool {
	return alnumKind(a) != "" && alnumKind(a) == alnumKind(b)
}

// usedDeclarations returns "kind:name" for every format, enum and object a
// field refers to.
func (c companionGateway) usedDeclarations() map[string]bool {
	used := map[string]bool{}
	note := func(fields []companionField) {
		for _, f := range fields {
			if f.Format != "" {
				used["format:"+f.Format] = true
			}
			if f.Enum != "" {
				used["enum:"+f.Enum] = true
			}
			if f.Object != "" {
				used["object:"+f.Object] = true
			}
		}
	}
	for _, o := range c.Objects {
		note(o.Fields)
	}
	for _, m := range c.Messages {
		for _, v := range m.Variants {
			note(v.Fields)
		}
	}
	return used
}

// root is the label a message's whole-body problems are reported at: the
// role it plays on its subject.
func (c companionGateway) root(messageName string) string {
	for _, s := range c.Subjects {
		if s.Reply == messageName {
			return "reply"
		}
	}
	return "request"
}

func namesOf[T any](items []T, name func(T) string) []string {
	names := make([]string, 0, len(items))
	for _, item := range items {
		names = append(names, name(item))
	}
	return names
}
