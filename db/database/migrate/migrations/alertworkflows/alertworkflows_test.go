package alertworkflows

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

const cheerTrigger = `{"$ref":"twitch:trigger:cheer","type":"event","event":"channel.cheer"}`

// The shape the triggers screens write: an unconditional trigger first, then
// one condition task per trigger followed by its actions, each depending on the
// one before it.
const eventTriggers = `[
	{"id":"act_1","type":"action","action":"alert","parameters":{"message":"Thanks <3"}},
	{"id":"rule_1","type":"condition","conditions":[{"field":"${trigger.data.amount}","operator":"gte","value":100}],"onTrue":["act_2","act_3"]},
	{"id":"act_2","type":"action","action":"function","function":"obs:function:flash","parameters":{},"dependsOn":["rule_1"]},
	{"id":"act_3","type":"action","action":"alert","parameters":{"layout":{"widgets":[]}},"dependsOn":["act_2"]},
	{"id":"rule_2","type":"condition","disabled":true,"conditions":[{"field":"${trigger.data.amount}","operator":"gte","value":1000}],"onTrue":["act_4"]},
	{"id":"act_4","type":"action","action":"alert","parameters":{"volume":0.5},"dependsOn":["rule_2"]}
]`

func mustSplit(t *testing.T, trigger, steps string) Plan {
	t.Helper()
	plan, err := Split(trigger, steps)
	if err != nil {
		t.Fatalf("Split: %v", err)
	}
	return plan
}

func decoded(t *testing.T, text string) any {
	t.Helper()
	var value any
	if err := json.Unmarshal([]byte(text), &value); err != nil {
		t.Fatalf("not JSON: %v (%s)", err, text)
	}
	return value
}

func assertJSON(t *testing.T, label, got, want string) {
	t.Helper()
	if !reflect.DeepEqual(decoded(t, got), decoded(t, want)) {
		t.Errorf("%s =\n  %s\nwant\n  %s", label, got, want)
	}
}

func TestSplitGivesEachTriggerAWorkflowInTheOrderTheyRan(t *testing.T) {
	plan := mustSplit(t, cheerTrigger, eventTriggers)
	if plan.Reason != "" || len(plan.Parts) != 3 {
		t.Fatalf("plan = %+v, want three parts", plan)
	}

	unconditional, big, huge := plan.Parts[0], plan.Parts[1], plan.Parts[2]
	assertJSON(t, "unconditional trigger", unconditional.Trigger,
		`{"$ref":"twitch:trigger:cheer","type":"event","event":"channel.cheer","order":0}`)
	assertJSON(t, "unconditional steps", unconditional.Steps,
		`[{"id":"act_1","type":"action","action":"alert","parameters":{"message":"Thanks <3"}}]`)
	if unconditional.Paused {
		t.Error("unconditional trigger is paused")
	}

	assertJSON(t, "first condition's trigger", big.Trigger,
		`{"$ref":"twitch:trigger:cheer","type":"event","event":"channel.cheer","order":1,
			"conditions":[{"field":"${trigger.data.amount}","operator":"gte","value":100}]}`)
	assertJSON(t, "first condition's steps", big.Steps, `[
		{"id":"act_2","type":"action","action":"function","function":"obs:function:flash","parameters":{}},
		{"id":"act_3","type":"action","action":"alert","parameters":{"layout":{"widgets":[]}},"dependsOn":["act_2"]}
	]`)

	if !huge.Paused {
		t.Error("a trigger whose condition was disabled is not paused")
	}
	assertJSON(t, "paused trigger", huge.Trigger,
		`{"$ref":"twitch:trigger:cheer","type":"event","event":"channel.cheer","order":2,
			"conditions":[{"field":"${trigger.data.amount}","operator":"gte","value":1000}]}`)
}

// A message typed with < or & is stored as typed, not escaped.
func TestSplitKeepsStepTextAsTyped(t *testing.T) {
	plan := mustSplit(t, cheerTrigger, eventTriggers)
	if !strings.Contains(plan.Parts[0].Steps, `"Thanks <3"`) {
		t.Errorf("steps = %s", plan.Parts[0].Steps)
	}
}

func TestSplitTurnsALoneConditionIntoTriggerConditions(t *testing.T) {
	plan := mustSplit(t, cheerTrigger, `[
		{"id":"rule_1","type":"condition","condition":{"field":"${trigger.data.amount}","operator":"eq","value":5},"onTrue":["act_1"]},
		{"id":"act_1","type":"action","action":"alert","parameters":{},"dependsOn":["rule_1"]}
	]`)
	if len(plan.Parts) != 1 {
		t.Fatalf("plan = %+v, want one part", plan)
	}
	assertJSON(t, "trigger", plan.Parts[0].Trigger,
		`{"$ref":"twitch:trigger:cheer","type":"event","event":"channel.cheer","order":0,
			"conditions":[{"field":"${trigger.data.amount}","operator":"eq","value":5}]}`)
}

// A trigger with no steps yet has nothing to run, and the engine refuses a
// workflow without steps, so it arrives paused.
func TestSplitPausesATriggerWithNoSteps(t *testing.T) {
	plan := mustSplit(t, cheerTrigger, `[
		{"id":"rule_1","type":"condition","conditions":[{"field":"${trigger.data.amount}","operator":"gte","value":1}],"onTrue":[]},
		{"id":"rule_2","type":"condition","conditions":[{"field":"${trigger.data.amount}","operator":"gte","value":9}],"onTrue":["act_1"]},
		{"id":"act_1","type":"action","action":"alert","parameters":{},"dependsOn":["rule_2"]}
	]`)
	if len(plan.Parts) != 2 {
		t.Fatalf("plan = %+v, want two parts", plan)
	}
	if !plan.Parts[0].Paused || plan.Parts[0].Steps != "[]" {
		t.Errorf("empty trigger = %+v, want paused with no steps", plan.Parts[0])
	}
	if plan.Parts[1].Paused {
		t.Error("the trigger with a step is paused")
	}
}

// Splitting what a split produced finds nothing to do, so the migration can
// run again after dying part way.
func TestSplitIsIdempotent(t *testing.T) {
	plan := mustSplit(t, cheerTrigger, eventTriggers)
	for i, part := range plan.Parts {
		again := mustSplit(t, part.Trigger, part.Steps)
		if len(again.Parts) != 0 {
			t.Errorf("part %d split again into %+v", i, again.Parts)
		}
	}
}

func TestSplitLeavesWorkflowsItCannotReproduce(t *testing.T) {
	action := func(id string, extra string) string {
		return `{"id":"` + id + `","type":"action","action":"alert","parameters":{}` + extra + `}`
	}
	condition := func(id string, onTrue string, extra string) string {
		return `{"id":"` + id + `","type":"condition","conditions":[{"field":"${trigger.data.amount}","operator":"gte","value":1}],"onTrue":[` + onTrue + `]` + extra + `}`
	}
	cases := []struct {
		name    string
		trigger string
		steps   string
	}{
		{"a single unconditional trigger", cheerTrigger, `[` + action("act_1", "") + `]`},
		{"no steps at all", cheerTrigger, `[]`},
		{"a scheduled workflow", `{"type":"schedule","schedule":"0 * * * *"}`, `[` + condition("rule_1", `"act_1"`, "") + `,` + action("act_1", "") + `]`},
		{"conditions already on the trigger",
			`{"type":"event","event":"channel.cheer","conditions":[{"field":"${trigger.data.amount}","operator":"gte","value":1}]}`,
			`[` + condition("rule_1", `"act_1"`, "") + `,` + action("act_1", "") + `]`},
		{"a wait step", cheerTrigger, `[` + condition("rule_1", `"act_1"`, "") + `,` + action("act_1", "") + `,{"id":"w","type":"wait","wait":{"type":"delay","durationMs":5}}]`},
		{"an else branch", cheerTrigger, `[` + condition("rule_1", `"act_1"`, `,"onFalse":["act_2"]`) + `,` + action("act_1", "") + `,` + action("act_2", "") + `]`},
		{"a step claimed by two triggers", cheerTrigger, `[` + condition("rule_1", `"act_1"`, "") + `,` + action("act_1", "") + `,` + condition("rule_2", `"act_1"`, "") + `]`},
		{"a step shared between triggers", cheerTrigger, `[` +
			condition("rule_1", `"act_1"`, "") + `,` + action("act_1", "") + `,` +
			condition("rule_2", `"act_2"`, "") + `,` + action("act_2", "") + `,` +
			action("shared", `,"conditions":[{"field":"${rule_1.result}","operator":"eq","value":true},{"field":"${rule_2.result}","operator":"eq","value":true}],"conditionLogic":"or"`) + `]`},
		{"either of two conditions", cheerTrigger, `[{"id":"rule_1","type":"condition","conditionLogic":"or","conditions":[
			{"field":"${trigger.data.amount}","operator":"gte","value":1},{"field":"${trigger.data.anonymous}","operator":"eq","value":true}],"onTrue":["act_1"]},` + action("act_1", "") + `]`},
		{"interleaved triggers", cheerTrigger, `[` + condition("rule_1", `"act_1"`, "") + `,` + condition("rule_2", `"act_2"`, "") + `,` + action("act_1", "") + `,` + action("act_2", "") + `]`},
		{"an action stored before its condition", cheerTrigger, `[` + action("act_1", "") + `,` + condition("rule_1", `"act_1"`, "") + `]`},
		{"a dependency on another trigger", cheerTrigger, `[` + condition("rule_1", `"act_1"`, "") + `,` + action("act_1", "") + `,` + condition("rule_2", `"act_2"`, "") + `,` + action("act_2", `,"dependsOn":["act_1"]`) + `]`},
		{"a step reading another trigger's results", cheerTrigger, `[` + condition("rule_1", `"act_1"`, "") + `,` + action("act_1", "") + `,` + condition("rule_2", `"act_2"`, "") + `,{"id":"act_2","type":"action","action":"alert","parameters":{"text":"${act_1.published}"}}]`},
		{"a step reading its condition's result", cheerTrigger, `[` + condition("rule_1", `"act_1"`, "") + `,{"id":"act_1","type":"action","action":"alert","parameters":{"text":"${rule_1.result}"}}]`},
		{"a condition reading a step", cheerTrigger, `[` + action("act_0", "") + `,{"id":"rule_1","type":"condition","conditions":[{"field":"${act_0.ok}","operator":"eq","value":true}],"onTrue":["act_1"]},` + action("act_1", "") + `]`},
		{"steps running at the same time", cheerTrigger, `[` + condition("rule_1", `"act_1","act_2"`, "") + `,` + action("act_1", `,"dependsOn":["rule_1"]`) + `,` + action("act_2", `,"dependsOn":["rule_1"]`) + `]`},
		{"a condition depending on a step", cheerTrigger, `[` + action("act_0", "") + `,` + condition("rule_1", `"act_1"`, `,"dependsOn":["act_0"]`) + `,` + action("act_1", "") + `]`},
		{"a condition with nothing to check", cheerTrigger, `[{"id":"rule_1","type":"condition","onTrue":["act_1"]},` + action("act_1", "") + `]`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			plan := mustSplit(t, tc.trigger, tc.steps)
			if len(plan.Parts) != 0 {
				t.Fatalf("split into %+v, want it left as it is", plan.Parts)
			}
			if plan.Reason == "" {
				t.Error("no reason given for leaving it")
			}
		})
	}
}

func TestSplitRefusesUnreadableJSON(t *testing.T) {
	if _, err := Split(cheerTrigger, `[{"id":`); err == nil {
		t.Error("Split accepted truncated steps")
	}
}

func TestPartNameStaysWithinTheColumn(t *testing.T) {
	if got := partName("Cheer triggers", 2); got != "Cheer triggers (2)" {
		t.Errorf("partName = %q", got)
	}
	long := strings.Repeat("é", maxNameLength)
	got := partName(long, 12)
	if n := len([]rune(got)); n != maxNameLength || !strings.HasSuffix(got, " (12)") {
		t.Errorf("partName of a full-width name = %d runes, %q", n, got[len(got)-8:])
	}
}
