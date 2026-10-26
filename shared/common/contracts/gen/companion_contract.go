package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"iter"
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
// Unknown keys are refused, and so is any declared limit, format, enum,
// object or message that nothing uses, so every entry reaches the generated
// code.
type companionGateway struct {
	Subjects []companionSubject `json:"subjects"`
	Limits   []namedLimit       `json:"limits"`
	Formats  []stringFormat     `json:"formats"`
	Enums    []namedEnum        `json:"enums"`
	Objects  []objectType       `json:"objects"`
	Messages []message          `json:"messages"`

	// formats holds each format's pattern taken apart, filled once the
	// contract is valid.
	formats map[string]parsedFormat
	// limitKinds holds how the fields use each limit, filled once the
	// contract is valid.
	limitKinds map[string]limitKind
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

// namedLimit is a number fields bound themselves with, by naming it in place
// of a literal. Each limit becomes an exported constant in every generated
// file, so code outside the contract that has to agree with a bound imports
// the constant instead of repeating the number.
type namedLimit struct {
	Name  string `json:"name"`
	Value int64  `json:"value"`
}

// limitKind is how fields use a limit, which fixes the type its Rust
// constant takes.
type limitKind int

const (
	// limitLength bounds a string's maxLength or maxBytes: a usize in Rust.
	limitLength limitKind = iota + 1
	// limitInteger bounds an integer's min or max: an i64 in Rust.
	limitInteger
)

// fieldBound is one numeric bound of a field: a number written in place, or
// the name of a declared limit. The name is resolved to its value before the
// contract is validated, so every check reads Value either way.
type fieldBound struct {
	Value int64
	// Limit is the declared limit Value comes from, "" for a literal.
	Limit string
}

func (b *fieldBound) UnmarshalJSON(raw []byte) error {
	if bytes.HasPrefix(raw, []byte(`"`)) {
		return json.Unmarshal(raw, &b.Limit)
	}
	return json.Unmarshal(raw, &b.Value)
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
// and max. Each numeric bound is a number or a declared limit's name. An
// enum or object field names its declaration.
type companionField struct {
	Name      string             `json:"name"`
	Type      companionFieldType `json:"type"`
	Required  bool               `json:"required"`
	MaxLength *fieldBound        `json:"maxLength"`
	MaxBytes  *fieldBound        `json:"maxBytes"`
	Format    string             `json:"format"`
	Min       *fieldBound        `json:"min"`
	Max       *fieldBound        `json:"max"`
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
	kinds, err := c.resolveLimits()
	if err != nil {
		return companionGateway{}, err
	}
	if err := c.validate(); err != nil {
		return companionGateway{}, err
	}
	c.limitKinds = kinds
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
	return c.validateLimitConstants()
}

// resolveLimits checks the declared limits and fills every bound that names
// one with its value, so validate checks the value as if it were written in
// place. It returns how the fields use each limit: lengths or integers, never
// both, since the limit's Rust constant has one type.
func (c *companionGateway) resolveLimits() (map[string]limitKind, error) {
	values := map[string]int64{}
	for i, l := range c.Limits {
		key := fmt.Sprintf("limits[%d]", i)
		if !fieldNamePattern.MatchString(l.Name) {
			return nil, fmt.Errorf("%s.name: %q must match %s", key, l.Name, fieldNamePattern)
		}
		if _, ok := values[l.Name]; ok {
			return nil, fmt.Errorf("%s.name: duplicate limit %q", key, l.Name)
		}
		if l.Value < -maxSafeInteger || l.Value > maxSafeInteger {
			return nil, fmt.Errorf("%s.value: %d must be within ±%d so TypeScript reads it exactly", key, l.Value, maxSafeInteger)
		}
		values[l.Name] = l.Value
	}
	kinds := map[string]limitKind{}
	for site, f := range c.fields() {
		for _, b := range []struct {
			name  string
			bound *fieldBound
			kind  limitKind
		}{
			{"maxLength", f.MaxLength, limitLength},
			{"maxBytes", f.MaxBytes, limitLength},
			{"min", f.Min, limitInteger},
			{"max", f.Max, limitInteger},
		} {
			if b.bound == nil || b.bound.Limit == "" {
				continue
			}
			value, ok := values[b.bound.Limit]
			if !ok {
				return nil, fmt.Errorf("%s.%s: %q is not a declared limit", site.key, b.name, b.bound.Limit)
			}
			if kind, seen := kinds[b.bound.Limit]; seen && kind != b.kind {
				return nil, fmt.Errorf("%s.%s: limit %q may bound lengths or integers, not both", site.key, b.name, b.bound.Limit)
			}
			kinds[b.bound.Limit] = b.kind
			b.bound.Value = value
		}
	}
	for _, l := range c.Limits {
		if _, ok := kinds[l.Name]; !ok {
			return nil, fmt.Errorf("limits: %q is used by no field", l.Name)
		}
	}
	return kinds, nil
}

// validateLimitConstants refuses a limit whose constant would take the name
// of another constant the generated files export.
func (c companionGateway) validateLimitConstants() error {
	constants := map[string]string{"COMPANION_GATEWAY_SUBJECTS": "the subjects"}
	for _, s := range c.Subjects {
		constants[rustSubjectConst(s.Name)] = "subject " + s.Name
	}
	for _, f := range c.Formats {
		constants[tsFormatConst(f.Name)] = "format " + f.Name
		constants[tsPatternConst(f.Name)] = "format " + f.Name
	}
	for _, e := range c.Enums {
		constants[tsEnumConst(e.Name)] = "enum " + e.Name
	}
	for i, l := range c.Limits {
		name := limitConst(l.Name)
		if other, ok := constants[name]; ok {
			return fmt.Errorf("limits[%d].name: its constant %s is also the constant of %s", i, name, other)
		}
		constants[name] = "limit " + l.Name
	}
	return nil
}

// limitConst is the constant a limit is exported as, in every language.
func limitConst(name string) string {
	return screamingName(name)
}

// boundExpr is a numeric bound as the generated TypeScript and Rust both
// spell it: its limit's constant, or the number itself.
func boundExpr(b *fieldBound) string {
	if b.Limit != "" {
		return limitConst(b.Limit)
	}
	return strconv.FormatInt(b.Value, 10)
}

// limitDoc describes a limit by the bounds it sets, such as "The `max` of
// `ModuleEndpointSend.budgetMs`.", wrapped into lines for the doc comment on
// its constant.
func (c companionGateway) limitDoc(name string) []string {
	roles := []string{"maxLength", "maxBytes", "min", "max"}
	fieldsByRole := map[string][]string{}
	for site, f := range c.fields() {
		for i, b := range []*fieldBound{f.MaxLength, f.MaxBytes, f.Min, f.Max} {
			if b != nil && b.Limit == name {
				fieldsByRole[roles[i]] = append(fieldsByRole[roles[i]], "`"+pascalName(site.owner)+"."+f.Name+"`")
			}
		}
	}
	parts := make([]string, 0, len(roles))
	for _, role := range roles {
		if fields := fieldsByRole[role]; len(fields) > 0 {
			parts = append(parts, fmt.Sprintf("the `%s` of %s", role, englishList(fields)))
		}
	}
	description := strings.Join(parts, "; ")
	return wrapWords(strings.ToUpper(description[:1])+description[1:]+".", limitDocWidth)
}

// limitDocWidth is the widest line of a limit's doc comment, leaving room
// for the comment markers and indent within rustfmt's and Biome's widths.
const limitDocWidth = 76

// englishList joins items as prose: "a", "a and b", "a, b and c".
func englishList(items []string) string {
	if len(items) == 1 {
		return items[0]
	}
	return strings.Join(items[:len(items)-1], ", ") + " and " + items[len(items)-1]
}

// wrapWords breaks text at spaces into lines of at most width bytes; a word
// longer than width gets a line of its own.
func wrapWords(text string, width int) []string {
	var lines []string
	line := ""
	for _, word := range strings.Fields(text) {
		if line != "" && len(line)+1+len(word) > width {
			lines = append(lines, line)
			line = ""
		}
		if line != "" {
			line += " "
		}
		line += word
	}
	return append(lines, line)
}

// fieldSite is where a field is declared: the key it is reported at, and
// the object or message variant holding it.
type fieldSite struct {
	key   string
	owner string
}

// fields yields every field of every object and message variant, with where
// it is declared.
func (c companionGateway) fields() iter.Seq2[fieldSite, companionField] {
	return func(yield func(fieldSite, companionField) bool) {
		for i, o := range c.Objects {
			for j, f := range o.Fields {
				if !yield(fieldSite{key: fmt.Sprintf("objects[%d].fields[%d]", i, j), owner: o.Name}, f) {
					return
				}
			}
		}
		for i, m := range c.Messages {
			for k, v := range m.Variants {
				for j, f := range v.Fields {
					if !yield(fieldSite{key: fmt.Sprintf("messages[%d].variants[%d].fields[%d]", i, k, j), owner: v.Name}, f) {
						return
					}
				}
			}
		}
	}
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
	if f.MaxLength != nil && f.MaxLength.Value < 1 {
		return fmt.Errorf("%s: maxLength must be positive", key)
	}
	if f.MaxBytes != nil && f.MaxBytes.Value < 1 {
		return fmt.Errorf("%s: maxBytes must be positive", key)
	}
	if f.Min != nil || f.Max != nil {
		if f.Min == nil || f.Max == nil {
			return fmt.Errorf("%s: an integer needs both min and max", key)
		}
		if f.Min.Value < -maxSafeInteger || f.Max.Value > maxSafeInteger {
			return fmt.Errorf("%s: min and max must be within ±%d so TypeScript reads them exactly", key, maxSafeInteger)
		}
		if f.Min.Value > f.Max.Value {
			return fmt.Errorf("%s: min %d is above max %d", key, f.Min.Value, f.Max.Value)
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
