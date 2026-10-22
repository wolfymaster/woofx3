package main

import (
	"bytes"
	_ "embed"
	"fmt"
	"go/format"
	"strconv"
	"strings"
	"text/template"
)

//go:embed templates/platformgateway.go.tmpl
var goTemplateSource string

type goEnumValue struct {
	Const string
	Value string
}

// goEnum is one string enum: a named type, its constants, a list function
// and Valid.
type goEnum struct {
	Type   string
	Doc    string
	Prefix string
	List   string
	Values []goEnumValue
}

type goField struct {
	Name string
	Type string
	Tag  string
}

type goVariant struct {
	Type   string
	Doc    string
	Fields []goField
	// Checks are the calls validating this variant's decoded fields, in
	// declaration order.
	Checks []string
	// Keys are the variant's JSON field names.
	Keys string
}

type goAction struct {
	Const    string
	ID       string
	Union    string
	Variants []goVariant
}

type goOutcome struct {
	Const  string
	Checks []string
}

type goPlatform struct {
	Const       string
	DisplayName string
}

type goData struct {
	// HasIntegers is whether any payload field is an integer; checkInteger
	// and its math import are emitted only then, as Go refuses an unused
	// import.
	HasIntegers   bool
	Source        string
	Subjects      gatewaySubjects
	Enums         []goEnum
	Platforms     []goPlatform
	Actions       []goAction
	Outcomes      []goOutcome
	OutcomeFields []goField
}

func emitGo(c platformGateway) ([]byte, error) {
	data := goData{Source: platformGatewaySource, Subjects: c.Subjects}

	platformValues := make([]goEnumValue, 0, len(c.Platforms))
	for _, p := range c.Platforms {
		value := goEnumValue{Const: "Platform" + goName(p.ID), Value: p.ID}
		platformValues = append(platformValues, value)
		data.Platforms = append(data.Platforms, goPlatform{Const: value.Const, DisplayName: p.DisplayName})
	}
	actionIDs := make([]string, 0, len(c.Actions))
	for _, a := range c.Actions {
		actionIDs = append(actionIDs, a.ID)
	}
	data.Enums = []goEnum{
		{Type: "PlatformID", Doc: "names a streaming platform the gateway can reach.", Prefix: "Platform", List: "PlatformIDs", Values: platformValues},
		goEnumOf("ActionID", "names an action in the catalog.", "Action", "ActionIDs", actionIDs),
		goEnumOf("TargetKind", "says how a request picks its platforms.", "Target", "TargetKinds", targetKinds()),
		goEnumOf("RequesterKind", "names the kind of engine component sending a request.", "Requester", "RequesterKinds", c.Requesters),
		goEnumOf("OutcomeStatus", "is what happened on one platform.", "Outcome", "OutcomeStatuses", c.OutcomeStatuses),
		goEnumOf("FailureCode", "classifies a failed outcome or a refused request.", "Failure", "FailureCodes", c.FailureCodes),
		goEnumOf("UnavailableReason", "says why a platform could not take a request.", "Unavailable", "UnavailableReasons", c.UnavailableReasons),
	}

	for _, a := range c.Actions {
		data.Actions = append(data.Actions, goActionOf(a))
		for _, v := range a.variants() {
			for _, f := range v.Fields {
				data.HasIntegers = data.HasIntegers || f.Type == fieldInteger
			}
		}
	}

	shapes := outcomeShapes()
	declared := map[string]bool{}
	for _, status := range c.OutcomeStatuses {
		outcome := goOutcome{Const: "Outcome" + goName(status)}
		for _, f := range shapes[status] {
			if !declared[f.Name] {
				declared[f.Name] = true
				data.OutcomeFields = append(data.OutcomeFields, goOutcomeField(f))
			}
			if !f.Required {
				continue
			}
			outcome.Checks = append(outcome.Checks, goOutcomeCheck(f))
		}
		data.Outcomes = append(data.Outcomes, outcome)
	}

	tmpl, err := template.New("go").Parse(goTemplateSource)
	if err != nil {
		return nil, fmt.Errorf("parsing Go template: %w", err)
	}
	var out bytes.Buffer
	if err := tmpl.Execute(&out, data); err != nil {
		return nil, fmt.Errorf("rendering Go: %w", err)
	}
	formatted, err := format.Source(out.Bytes())
	if err != nil {
		return nil, fmt.Errorf("formatting generated Go: %w", err)
	}
	return formatted, nil
}

func goEnumOf(typeName, doc, prefix, list string, values []string) goEnum {
	e := goEnum{Type: typeName, Doc: doc, Prefix: prefix, List: list}
	for _, value := range values {
		e.Values = append(e.Values, goEnumValue{Const: prefix + goName(value), Value: value})
	}
	return e
}

func goActionOf(a action) goAction {
	out := goAction{Const: "Action" + goName(a.ID), ID: a.ID}
	base := goName(a.ID)
	if len(a.OneOf) > 0 {
		out.Union = base + "Payload"
	}
	for _, v := range a.variants() {
		gv := goVariant{Type: base + goName(v.Name) + "Payload"}
		if out.Union != "" {
			gv.Doc = fmt.Sprintf("is the %q form of %s.", v.Name, a.ID)
		} else {
			gv.Doc = fmt.Sprintf("is the payload of %s.", a.ID)
		}
		keys := make([]string, 0, len(v.Fields))
		for _, f := range v.Fields {
			gv.Fields = append(gv.Fields, goFieldOf(f))
			gv.Checks = append(gv.Checks, goFieldCheck(f))
			keys = append(keys, strconv.Quote(f.Name))
		}
		gv.Keys = strings.Join(keys, ", ")
		out.Variants = append(out.Variants, gv)
	}
	return out
}

func goFieldOf(f field) goField {
	tag := f.Name
	if !f.Required {
		tag += ",omitempty"
	}
	goType := "string"
	if f.Type == fieldInteger {
		goType = "int"
		if !f.Required {
			// A pointer, so an absent value is not confused with zero.
			goType = "*int"
		}
	}
	return goField{Name: goName(f.Name), Type: goType, Tag: "`json:\"" + tag + "\"`"}
}

func goFieldCheck(f field) string {
	switch f.Type {
	case fieldInteger:
		return fmt.Sprintf("checkInteger(fields, %q, %t, %d, %d)", f.Name, f.Required, *f.Min, *f.Max)
	default:
		return fmt.Sprintf("checkString(fields, %q, %t, %d)", f.Name, f.Required, *f.MaxLength)
	}
}

// goOutcomeField is one field of the flattened PlatformOutcome struct. Every
// one is optional on the wire because each status carries only its own.
func goOutcomeField(f outcomeField) goField {
	goType := "string"
	if f.Kind == outcomeFailureCode {
		goType = "FailureCode"
	}
	return goField{Name: goName(f.Name), Type: goType, Tag: "`json:\"" + f.Name + ",omitempty\"`"}
}

func goOutcomeCheck(f outcomeField) string {
	goField := goName(f.Name)
	switch f.Kind {
	case outcomeFailureCode:
		return fmt.Sprintf("requireFailureCode(field+%q, o.%s)", "."+f.Name, goField)
	case outcomeUnavailableReason:
		return fmt.Sprintf("requireUnavailableReason(field+%q, o.%s)", "."+f.Name, goField)
	default:
		return fmt.Sprintf("requireText(field+%q, o.%s)", "."+f.Name, goField)
	}
}
