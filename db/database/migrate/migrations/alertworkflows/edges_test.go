package alertworkflows

import (
	"slices"
	"testing"
)

func TestWorkflowEdges(t *testing.T) {
	tests := []struct {
		name    string
		steps   string
		trigger string
		want    []workflowEdge
	}{
		{
			name:    "trigger ref, step ref and invoked function",
			trigger: `{"type":"event","event":"channel.cheer","$ref":"twitch:trigger:cheer"}`,
			steps:   `[{"id":"a","$ref":"obs:action:flash"},{"id":"b","action":"function","function":"obs:function:flash"}]`,
			want: []workflowEdge{
				{TargetType: "trigger", TargetName: "twitch:trigger:cheer", Context: "trigger"},
				{TargetType: "action", TargetName: "obs:action:flash", Context: "step[0]"},
				{TargetType: "function", TargetName: "obs:function:flash", Context: "step[1].function"},
			},
		},
		{
			name:    "a ref of an unknown kind or the wrong shape is skipped",
			trigger: `{}`,
			steps:   `[{"id":"a","$ref":"obs:gadget:flash"},{"id":"b","$ref":"obs:action"},{"id":"c","$ref":"::"}]`,
		},
		{
			name:    "unreadable JSON yields no edges",
			trigger: `not json`,
			steps:   `not json`,
		},
		{
			name:    "unreadable steps keep the trigger's edge",
			trigger: `{"$ref":"twitch:trigger:cheer"}`,
			steps:   `{`,
			want:    []workflowEdge{{TargetType: "trigger", TargetName: "twitch:trigger:cheer", Context: "trigger"}},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := workflowEdges(tc.steps, tc.trigger); !slices.Equal(got, tc.want) {
				t.Fatalf("edges = %+v, want %+v", got, tc.want)
			}
		})
	}
}
