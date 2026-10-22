package main

import (
	"bytes"
	_ "embed"
	"fmt"
	"strconv"
	"strings"
	"text/template"
)

//go:embed templates/platform-gateway.ts.tmpl
var tsTemplateSource string

// tsEnum is one string enum: a const array, its union type and a guard.
type tsEnum struct {
	Const  string
	Type   string
	Guard  string
	Doc    string
	Values string
}

// tsRead is one field read inside a generated parse function: a local
// holding the reader's result, and how the parsed object includes it.
type tsRead struct {
	Var  string
	Call string
	// Entry is the object-literal entry built from Var: `name: var.value`
	// for a required field, a conditional spread for an optional one, so an
	// absent value leaves no key behind.
	Entry string
}

type tsVariant struct {
	Type   string
	Doc    string
	Fields []string
	Keys   string
	Reads  []tsRead
}

type tsAction struct {
	Key      string
	ID       string
	Type     string
	Union    string
	FormsVar string
	Variants []tsVariant
}

type tsOutcome struct {
	Status string
	Branch string
	Reads  []tsRead
}

type tsPlatform struct {
	ID          string
	DisplayName string
}

// tsReaders says which payload reader helpers the actions use; only those are
// emitted, as the api's type check refuses unused functions.
type tsReaders struct {
	RequiredString  bool
	OptionalString  bool
	RequiredInteger bool
	OptionalInteger bool
}

type tsData struct {
	Readers   tsReaders
	Source    string
	Subjects  gatewaySubjects
	Enums     []tsEnum
	Platforms []tsPlatform
	Actions   []tsAction
	Outcomes  []tsOutcome
}

func emitTS(c platformGateway) ([]byte, error) {
	data := tsData{Source: platformGatewaySource, Subjects: c.Subjects}

	platformIDs := make([]string, 0, len(c.Platforms))
	for _, p := range c.Platforms {
		platformIDs = append(platformIDs, p.ID)
		data.Platforms = append(data.Platforms, tsPlatform{ID: p.ID, DisplayName: p.DisplayName})
	}
	data.Enums = []tsEnum{
		tsEnumOf("PLATFORM_IDS", "PlatformId", "isPlatformId", "A streaming platform the gateway can reach.", platformIDs),
		tsEnumOf("TARGET_KINDS", "TargetKind", "isTargetKind", "How a request picks its platforms.", targetKinds()),
		tsEnumOf("REQUESTER_KINDS", "RequesterKind", "isRequesterKind", "The kind of engine component sending a request.", c.Requesters),
		tsEnumOf("OUTCOME_STATUSES", "OutcomeStatus", "isOutcomeStatus", "What happened on one platform.", c.OutcomeStatuses),
		tsEnumOf("FAILURE_CODES", "FailureCode", "isFailureCode", "Classifies a failed outcome or a refused request.", c.FailureCodes),
		tsEnumOf("UNAVAILABLE_REASONS", "UnavailableReason", "isUnavailableReason", "Why a platform could not take a request.", c.UnavailableReasons),
	}

	for _, a := range c.Actions {
		data.Actions = append(data.Actions, tsActionOf(a))
		for _, v := range a.variants() {
			for _, f := range v.Fields {
				data.Readers.note(f)
			}
		}
	}

	shapes := outcomeShapes()
	for _, status := range c.OutcomeStatuses {
		data.Outcomes = append(data.Outcomes, tsOutcomeOf(status, shapes[status]))
	}

	tmpl, err := template.New("ts").Parse(tsTemplateSource)
	if err != nil {
		return nil, fmt.Errorf("parsing TypeScript template: %w", err)
	}
	var out bytes.Buffer
	if err := tmpl.Execute(&out, data); err != nil {
		return nil, fmt.Errorf("rendering TypeScript: %w", err)
	}
	return out.Bytes(), nil
}

func tsEnumOf(constName, typeName, guard, doc string, values []string) tsEnum {
	return tsEnum{Const: constName, Type: typeName, Guard: guard, Doc: doc, Values: tsStringList(values)}
}

func tsStringList(values []string) string {
	quoted := make([]string, 0, len(values))
	for _, value := range values {
		quoted = append(quoted, strconv.Quote(value))
	}
	return strings.Join(quoted, ", ")
}

func tsActionOf(a action) tsAction {
	base := pascalName(a.ID)
	out := tsAction{Key: screamingName(a.ID), ID: a.ID, Type: base + "Payload", FormsVar: screamingName(a.ID) + "_FORMS"}
	if len(a.OneOf) > 0 {
		out.Union = base + "Payload"
	}
	for _, v := range a.variants() {
		tv := tsVariant{Type: base + pascalName(v.Name) + "Payload"}
		if out.Union != "" {
			tv.Doc = fmt.Sprintf("The %q form of `%s`.", v.Name, a.ID)
		} else {
			tv.Doc = fmt.Sprintf("The payload of `%s`.", a.ID)
		}
		names := make([]string, 0, len(v.Fields))
		for _, f := range v.Fields {
			tv.Fields = append(tv.Fields, tsFieldDeclaration(f))
			tv.Reads = append(tv.Reads, tsPayloadRead(f))
			names = append(names, f.Name)
		}
		tv.Keys = tsStringList(names)
		out.Variants = append(out.Variants, tv)
	}
	return out
}

// note records the reader a field needs. A required reader delegates to the
// optional one, so it needs that one too.
func (r *tsReaders) note(f field) {
	switch {
	case f.Type == fieldInteger && f.Required:
		r.RequiredInteger, r.OptionalInteger = true, true
	case f.Type == fieldInteger:
		r.OptionalInteger = true
	case f.Required:
		r.RequiredString, r.OptionalString = true, true
	default:
		r.OptionalString = true
	}
}

func tsFieldDeclaration(f field) string {
	optional := ""
	if !f.Required {
		optional = "?"
	}
	tsType := "string"
	if f.Type == fieldInteger {
		tsType = "number"
	}
	return fmt.Sprintf("%s%s: %s;", f.Name, optional, tsType)
}

func tsPayloadRead(f field) tsRead {
	presence := "Optional"
	if f.Required {
		presence = "Required"
	}
	var call string
	switch f.Type {
	case fieldInteger:
		call = fmt.Sprintf("read%sInteger(object, %q, %d, %d)", presence, f.Name, *f.Min, *f.Max)
	default:
		call = fmt.Sprintf("read%sString(object, %q, %d)", presence, f.Name, *f.MaxLength)
	}
	return tsRead{Var: f.Name, Call: call, Entry: tsEntry(f.Name, f.Required)}
}

func tsEntry(name string, required bool) string {
	if required {
		return fmt.Sprintf("%s: %s.value", name, name)
	}
	return fmt.Sprintf("...(%s.value === undefined ? {} : { %s: %s.value })", name, name, name)
}

func tsOutcomeOf(status string, fields []outcomeField) tsOutcome {
	members := []string{fmt.Sprintf("status: %q", status)}
	out := tsOutcome{Status: status}
	for _, f := range fields {
		optional := ""
		if !f.Required {
			optional = "?"
		}
		var tsType, call string
		switch f.Kind {
		case outcomeFailureCode:
			tsType = "FailureCode"
			call = fmt.Sprintf("requireMember(object, field, %q, isFailureCode)", f.Name)
		case outcomeUnavailableReason:
			tsType = "UnavailableReason"
			call = fmt.Sprintf("requireMember(object, field, %q, isUnavailableReason)", f.Name)
		default:
			tsType = "string"
			if f.Required {
				call = fmt.Sprintf("requireText(object, field, %q)", f.Name)
			} else {
				call = fmt.Sprintf("optionalText(object, field, %q)", f.Name)
			}
		}
		members = append(members, fmt.Sprintf("%s%s: %s", f.Name, optional, tsType))
		out.Reads = append(out.Reads, tsRead{Var: f.Name, Call: call, Entry: tsEntry(f.Name, f.Required)})
	}
	out.Branch = "{ " + strings.Join(members, "; ") + " }"
	return out
}
