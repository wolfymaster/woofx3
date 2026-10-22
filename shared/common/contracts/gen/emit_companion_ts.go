package main

import (
	"bytes"
	_ "embed"
	"fmt"
	"strings"
	"text/template"
)

//go:embed templates/companion-gateway.ts.tmpl
var companionTSTemplateSource string

type companionTSSubject struct {
	Key     string
	Subject string
	Request string
	Reply   string
}

type companionTSFormat struct {
	PatternConst string
	Const        string
	Pattern      string
}

// companionTSStruct is one object or message variant: its interface and
// the function parsing a JSON object into it.
type companionTSStruct struct {
	Type   string
	Doc    string
	Fields []string
	Keys   string
	Reads  []tsRead
	// Entries builds the parsed value, the discriminant first for a variant.
	Entries string
}

type companionTSVariant struct {
	Tag  string
	Type string
}

type companionTSMessage struct {
	Type         string
	Doc          string
	Root         string
	Discriminant string
	Union        string
	Tags         string
	Variants     []companionTSVariant
}

// companionTSHelpers says which reader helpers the fields use; only those
// are emitted, so a consumer's type check never meets an unused function.
type companionTSHelpers struct {
	Required        bool
	String          bool
	Integer         bool
	StringOrInteger bool
	Enum            bool
	Object          bool
}

type companionTSData struct {
	Source   string
	Subjects []companionTSSubject
	Formats  []companionTSFormat
	Enums    []tsEnum
	Objects  []companionTSStruct
	Variants []companionTSStruct
	Messages []companionTSMessage
	Helpers  companionTSHelpers
}

func emitCompanionTS(c companionGateway) ([]byte, error) {
	data := companionTSData{Source: companionGatewaySource}
	for _, s := range c.Subjects {
		data.Subjects = append(data.Subjects, companionTSSubject{
			Key:     s.Name,
			Subject: s.Subject,
			Request: pascalName(s.Request),
			Reply:   pascalName(s.Reply),
		})
	}
	for _, f := range c.Formats {
		data.Formats = append(data.Formats, companionTSFormat{PatternConst: screamingName(f.Name) + "_PATTERN", Const: tsFormatConst(f.Name), Pattern: f.Pattern})
	}
	for _, e := range c.Enums {
		data.Enums = append(data.Enums, tsEnumOf(
			screamingName(e.Name)+"S",
			pascalName(e.Name),
			"is"+pascalName(e.Name),
			fmt.Sprintf("The values of `%s`.", pascalName(e.Name)),
			e.Values,
		))
	}
	for _, o := range c.Objects {
		data.Objects = append(data.Objects, data.Helpers.tsStruct(c, o.Name, "", "", o.Fields,
			fmt.Sprintf("A `%s` value.", pascalName(o.Name))))
	}
	for _, m := range c.Messages {
		tm := companionTSMessage{
			Type:         pascalName(m.Name),
			Root:         c.root(m.Name),
			Discriminant: m.Discriminant,
		}
		tm.Doc = fmt.Sprintf("A %s on %s, picked by its `%s`.", tm.Root, companionSubjectOf(c, m.Name), m.Discriminant)
		tags := make([]string, 0, len(m.Variants))
		types := make([]string, 0, len(m.Variants))
		for _, v := range m.Variants {
			doc := fmt.Sprintf("The `%s: %q` form of `%s`.", m.Discriminant, v.Tag, tm.Type)
			data.Variants = append(data.Variants, data.Helpers.tsStruct(c, v.Name, m.Discriminant, v.Tag, v.Fields, doc))
			tm.Variants = append(tm.Variants, companionTSVariant{Tag: v.Tag, Type: pascalName(v.Name)})
			tags = append(tags, v.Tag)
			types = append(types, pascalName(v.Name))
		}
		tm.Tags = strings.Join(tags, ", ")
		tm.Union = strings.Join(types, " | ")
		data.Messages = append(data.Messages, tm)
	}

	tmpl, err := template.New("companion-ts").Parse(companionTSTemplateSource)
	if err != nil {
		return nil, fmt.Errorf("parsing companion TypeScript template: %w", err)
	}
	var out bytes.Buffer
	if err := tmpl.Execute(&out, data); err != nil {
		return nil, fmt.Errorf("rendering companion TypeScript: %w", err)
	}
	return out.Bytes(), nil
}

// companionSubjectOf names the subject carrying a message, in backticks.
func companionSubjectOf(c companionGateway, messageName string) string {
	for _, s := range c.Subjects {
		if s.Request == messageName || s.Reply == messageName {
			return "`" + s.Subject + "`"
		}
	}
	return "no subject"
}

func tsFormatConst(name string) string {
	return "FORMAT_" + screamingName(name)
}

// tsStruct builds one interface and its parser, noting the helpers its
// fields read with. discriminant and tag are empty for a nested object.
func (h *companionTSHelpers) tsStruct(c companionGateway, name, discriminant, tag string, fields []companionField, doc string) companionTSStruct {
	out := companionTSStruct{Type: pascalName(name), Doc: doc}
	keys := make([]string, 0, len(fields)+1)
	entries := make([]string, 0, len(fields)+1)
	if discriminant != "" {
		out.Fields = append(out.Fields, fmt.Sprintf("%s: %q;", discriminant, tag))
		keys = append(keys, fmt.Sprintf("%q", discriminant))
		entries = append(entries, fmt.Sprintf("%s: %q", discriminant, tag))
	}
	for _, f := range fields {
		optional := ""
		if !f.Required {
			optional = "?"
		}
		out.Fields = append(out.Fields, fmt.Sprintf("%s%s: %s;", f.Name, optional, tsCompanionType(f)))
		keys = append(keys, fmt.Sprintf("%q", f.Name))
		variable := "parsed" + pascalName(f.Name)
		call := h.tsCompanionRead(f)
		if f.Required {
			h.Required = true
			call = fmt.Sprintf("required(%s, prefix, %q)", call, f.Name)
		}
		out.Reads = append(out.Reads, tsRead{Var: variable, Call: call})
		if f.Required {
			entries = append(entries, fmt.Sprintf("%s: %s.value", f.Name, variable))
		} else {
			entries = append(entries, fmt.Sprintf("...(%s.value === undefined ? {} : { %s: %s.value })", variable, f.Name, variable))
		}
	}
	out.Keys = strings.Join(keys, ", ")
	out.Entries = strings.Join(entries, ", ")
	return out
}

func tsCompanionType(f companionField) string {
	switch f.Type {
	case companionInteger:
		return "number"
	case companionStringOrInteger:
		return "string | number"
	case companionEnum:
		return pascalName(f.Enum)
	case companionObject:
		return pascalName(f.Object)
	}
	return "string"
}

func (h *companionTSHelpers) tsCompanionRead(f companionField) string {
	switch f.Type {
	case companionInteger:
		h.Integer = true
		return fmt.Sprintf("readInteger(object, prefix, %q, %d, %d)", f.Name, *f.Min, *f.Max)
	case companionStringOrInteger:
		h.StringOrInteger = true
		return fmt.Sprintf("readStringOrInteger(object, prefix, %q, %d, %d, %d)", f.Name, *f.MaxLength, *f.Min, *f.Max)
	case companionEnum:
		h.Enum = true
		return fmt.Sprintf("readEnum(object, prefix, %q, %s, %s)", f.Name, "is"+pascalName(f.Enum), screamingName(f.Enum)+"S")
	case companionObject:
		h.Object = true
		return fmt.Sprintf("readObject(object, prefix, %q, parse%s)", f.Name, pascalName(f.Object))
	}
	h.String = true
	var bound string
	switch {
	case f.Format != "":
		bound = tsFormatConst(f.Format)
	case f.MaxBytes != nil:
		bound = fmt.Sprintf(`{ kind: "bytes", max: %d }`, *f.MaxBytes)
	default:
		bound = fmt.Sprintf(`{ kind: "characters", max: %d }`, *f.MaxLength)
	}
	return fmt.Sprintf("readString(object, prefix, %q, %s)", f.Name, bound)
}
