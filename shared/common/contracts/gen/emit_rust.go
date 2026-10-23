package main

import (
	"bytes"
	_ "embed"
	"fmt"
	"strconv"
	"strings"
	"text/template"
)

//go:embed templates/companion_gateway.rs.tmpl
var rustTemplateSource string

type rustSubject struct {
	Const   string
	Subject string
	Request string
	Reply   string
}

type rustFormat struct {
	Const     string
	Predicate string
	Pattern   string
	Min       int
	Max       int
	// Chars is the match pattern accepting the format's characters, such as
	// 'a'..='z' | '_'.
	Chars string
}

type rustEnumValue struct {
	Variant string
	Value   string
}

type rustEnum struct {
	Type   string
	Doc    string
	Values []rustEnumValue
}

// rustScalarUnion is the type of a stringOrInteger field.
type rustScalarUnion struct {
	Type string
	Doc  string
}

type rustField struct {
	Name string
	Type string
	// Serde is the field's #[serde(...)] attribute, empty for none.
	Serde string
}

// rustStruct is one object or message variant with its validate_in body.
type rustStruct struct {
	Type   string
	Doc    string
	Fields []rustField
	Checks []string
}

type rustVariant struct {
	Tag     string
	Variant string
	Type    string
}

type rustMessage struct {
	Type         string
	Doc          string
	Discriminant string
	Variants     []rustVariant
}

// rustHelpers says which check functions the fields use; only those are
// emitted, as clippy refuses dead code.
type rustHelpers struct {
	Text            bool
	Bytes           bool
	Format          bool
	Integer         bool
	StringOrInteger bool
}

type rustData struct {
	Source       string
	Subjects     []rustSubject
	Formats      []rustFormat
	Enums        []rustEnum
	ScalarUnions []rustScalarUnion
	Objects      []rustStruct
	Variants     []rustStruct
	Messages     []rustMessage
	Helpers      rustHelpers
}

func emitRust(c companionGateway) ([]byte, error) {
	data := rustData{Source: companionGatewaySource}
	for _, s := range c.Subjects {
		data.Subjects = append(data.Subjects, rustSubject{
			Const:   "SUBJECT_" + screamingName(s.Name),
			Subject: s.Subject,
			Request: pascalName(s.Request),
			Reply:   pascalName(s.Reply),
		})
	}
	for _, f := range c.Formats {
		parsed := c.formats[f.Name]
		data.Formats = append(data.Formats, rustFormat{
			Const:     rustFormatConst(f.Name),
			Predicate: snakeName(f.Name) + "_char",
			Pattern:   f.Pattern,
			Min:       parsed.Min,
			Max:       parsed.Max,
			Chars:     rustCharPattern(parsed.Ranges),
		})
	}
	for _, e := range c.Enums {
		re := rustEnum{Type: pascalName(e.Name), Doc: fmt.Sprintf("The values of `%s`.", pascalName(e.Name))}
		for _, value := range e.Values {
			re.Values = append(re.Values, rustEnumValue{Variant: pascalName(value), Value: value})
		}
		data.Enums = append(data.Enums, re)
	}
	for _, o := range c.Objects {
		data.Objects = append(data.Objects, data.rustStruct(o.Name, o.Fields, fmt.Sprintf("A `%s` value.", pascalName(o.Name))))
	}
	for _, m := range c.Messages {
		rm := rustMessage{Type: pascalName(m.Name), Discriminant: m.Discriminant}
		rm.Doc = fmt.Sprintf("A %s on %s, picked by its `%s`.", c.root(m.Name), companionSubjectOf(c, m.Name), m.Discriminant)
		for _, v := range m.Variants {
			doc := fmt.Sprintf("The `%s: %q` form of [`%s`].", m.Discriminant, v.Tag, rm.Type)
			data.Variants = append(data.Variants, data.rustStruct(v.Name, v.Fields, doc))
			rm.Variants = append(rm.Variants, rustVariant{Tag: v.Tag, Variant: pascalName(v.Tag), Type: pascalName(v.Name)})
		}
		data.Messages = append(data.Messages, rm)
	}

	tmpl, err := template.New("rust").Parse(rustTemplateSource)
	if err != nil {
		return nil, fmt.Errorf("parsing Rust template: %w", err)
	}
	var out bytes.Buffer
	if err := tmpl.Execute(&out, data); err != nil {
		return nil, fmt.Errorf("rendering Rust: %w", err)
	}
	return out.Bytes(), nil
}

func rustFormatConst(name string) string {
	return "FORMAT_" + screamingName(name)
}

// snakeName is a contract name in snake_case, for Rust items and fields.
func snakeName(name string) string {
	return strings.Join(words(name), "_")
}

// rustFieldName is the Rust field for a JSON field, a raw identifier when the
// name is a Rust keyword ("match" becomes r#match, which serde reads as
// "match").
func rustFieldName(name string) string {
	snake := snakeName(name)
	if rustKeywords[snake] {
		return "r#" + snake
	}
	return snake
}

// rustKeywords are Rust's strict and reserved keywords that a raw identifier
// can stand in for.
var rustKeywords = map[string]bool{
	"abstract": true, "as": true, "async": true, "await": true, "become": true, "box": true,
	"break": true, "const": true, "continue": true, "do": true, "dyn": true, "else": true,
	"enum": true, "extern": true, "false": true, "final": true, "fn": true, "for": true,
	"gen": true, "if": true, "impl": true, "in": true, "let": true, "loop": true, "macro": true,
	"match": true, "mod": true, "move": true, "mut": true, "override": true, "priv": true,
	"pub": true, "ref": true, "return": true, "static": true, "struct": true, "trait": true,
	"true": true, "try": true, "type": true, "typeof": true, "unsafe": true, "unsized": true,
	"use": true, "virtual": true, "where": true, "while": true, "yield": true,
}

func rustCharPattern(ranges []charRange) string {
	parts := make([]string, 0, len(ranges))
	for _, r := range ranges {
		if r.From == r.To {
			parts = append(parts, fmt.Sprintf("'%c'", r.From))
			continue
		}
		parts = append(parts, fmt.Sprintf("'%c'..='%c'", r.From, r.To))
	}
	return strings.Join(parts, " | ")
}

// rustStruct builds one struct and its checks, noting the helpers and
// scalar unions its fields need.
func (d *rustData) rustStruct(name string, fields []companionField, doc string) rustStruct {
	out := rustStruct{Type: pascalName(name), Doc: doc}
	for _, f := range fields {
		fieldName := rustFieldName(f.Name)
		valueType := d.rustValueType(name, f)
		rf := rustField{Name: fieldName, Type: valueType}
		if !f.Required {
			rf.Type = "Option<" + valueType + ">"
			rf.Serde = `#[serde(default, skip_serializing_if = "Option::is_none")]`
		}
		out.Fields = append(out.Fields, rf)
		if check := d.rustCheck(f, fieldName); check != "" {
			out.Checks = append(out.Checks, check)
		}
	}
	return out
}

func (d *rustData) rustValueType(owner string, f companionField) string {
	switch f.Type {
	case companionInteger:
		return "i64"
	case companionStringOrInteger:
		union := pascalName(owner) + pascalName(f.Name)
		d.ScalarUnions = append(d.ScalarUnions, rustScalarUnion{
			Type: union,
			Doc:  fmt.Sprintf("The `%s` of a [`%s`]: a string or an integer.", f.Name, pascalName(owner)),
		})
		return union
	case companionEnum:
		return pascalName(f.Enum)
	case companionObject:
		return pascalName(f.Object)
	}
	return "String"
}

// rustCheck is the statement validating one field inside validate_in, or ""
// for an enum, which serde has already checked while decoding. An optional
// field is checked only when present, through the binding `value`.
func (d *rustData) rustCheck(f companionField, fieldName string) string {
	// reference is the field as a reference, value its target.
	reference, target := "&self."+fieldName, "self."+fieldName
	indent := rustCheckIndent
	if !f.Required {
		reference, target = "value", "value"
		indent += rustIndentWidth
	}
	name := strconv.Quote(f.Name)
	required := strconv.FormatBool(f.Required)
	var call string
	switch f.Type {
	case companionEnum:
		return ""
	case companionObject:
		call = rustCall(indent, target+".validate_in", []string{fmt.Sprintf("&format!(\"{prefix}%s.\")", f.Name)})
	case companionInteger:
		d.Helpers.Integer = true
		integer := target
		if !f.Required {
			integer = "*value"
		}
		call = rustCall(indent, "check_integer", []string{integer, "prefix", name, rustInt(*f.Min), rustInt(*f.Max)})
	case companionStringOrInteger:
		d.Helpers.StringOrInteger, d.Helpers.Text, d.Helpers.Integer = true, true, true
		call = rustCall(indent, target+".check", []string{"prefix", name, strconv.Itoa(*f.MaxLength), rustInt(*f.Min), rustInt(*f.Max), required})
	case companionString:
		switch {
		case f.Format != "":
			d.Helpers.Format = true
			call = rustCall(indent, "check_format", []string{reference, "prefix", name, "&" + rustFormatConst(f.Format), required})
		case f.MaxBytes != nil:
			d.Helpers.Bytes = true
			call = rustCall(indent, "check_bytes", []string{reference, "prefix", name, strconv.Itoa(*f.MaxBytes), required})
		default:
			d.Helpers.Text = true
			call = rustCall(indent, "check_text", []string{reference, "prefix", name, strconv.Itoa(*f.MaxLength), required})
		}
	}
	if f.Required {
		return call
	}
	pad := strings.Repeat(" ", rustCheckIndent)
	return fmt.Sprintf("if let Some(value) = &self.%s {\n%s%s\n%s}", fieldName, pad+strings.Repeat(" ", rustIndentWidth), call, pad)
}

func rustInt(value int64) string {
	return strconv.FormatInt(value, 10)
}

// rustfmt's default layout, which the generated file must already have:
// lines up to rustMaxWidth, and a call's arguments on one line only while
// they fit in rustCallWidth (rustfmt's fn_call_width, 60% of max_width).
const (
	rustMaxWidth    = 100
	rustCallWidth   = 60
	rustIndentWidth = 4
	// rustCheckIndent is the indent of a statement in validate_in.
	rustCheckIndent = 8
)

// rustCall is a `callee(args)?;` statement starting at indent (the indent
// itself is not included), laid out as rustfmt lays it out: on one line when
// it fits, otherwise one argument per line with a trailing comma.
func rustCall(indent int, callee string, args []string) string {
	joined := strings.Join(args, ", ")
	line := callee + "(" + joined + ")?;"
	if indent+len(line) <= rustMaxWidth && len(joined) <= rustCallWidth {
		return line
	}
	inner := strings.Repeat(" ", indent+rustIndentWidth)
	var b strings.Builder
	b.WriteString(callee + "(\n")
	for _, arg := range args {
		b.WriteString(inner + arg + ",\n")
	}
	b.WriteString(strings.Repeat(" ", indent) + ")?;")
	return b.String()
}
