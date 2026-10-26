package main

import "fmt"

// integerBound is one end of an integer payload field's range, emitted as a
// named constant so callers state the same bound the validator enforces.
type integerBound struct {
	GoName string
	TSName string
	Doc    string
	Value  int
}

// integerBoundsOf lists the bounds of every integer field in action order.
// chat.pin's durationSeconds gives ChatPinDurationSecondsMin and
// CHAT_PIN_DURATION_SECONDS_MIN. A field repeated across an action's forms
// is listed once, as the forms share its contract.
func integerBoundsOf(actions []action) []integerBound {
	var out []integerBound
	seen := map[string]bool{}
	for _, a := range actions {
		for _, v := range a.variants() {
			for _, f := range v.Fields {
				if f.Type != fieldInteger || seen[a.ID+"/"+f.Name] {
					continue
				}
				seen[a.ID+"/"+f.Name] = true
				out = append(out,
					integerBoundOf(a.ID, f.Name, "min", *f.Min),
					integerBoundOf(a.ID, f.Name, "max", *f.Max))
			}
		}
	}
	return out
}

func integerBoundOf(actionID, fieldName, end string, value int) integerBound {
	return integerBound{
		GoName: goName(actionID) + goName(fieldName) + goName(end),
		TSName: screamingName(actionID + "." + fieldName + "." + end),
		Doc:    fmt.Sprintf("is the %s of %s.%s.", end, actionID, fieldName),
		Value:  value,
	}
}
