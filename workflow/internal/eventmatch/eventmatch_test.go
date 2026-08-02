package eventmatch

import "testing"

func TestMatches(t *testing.T) {
	cases := []struct {
		pattern string
		subject string
		want    bool
	}{
		// Exact matches (no wildcards)
		{"foo.bar", "foo.bar", true},
		{"foo.bar", "foo.baz", false},
		{"foo.bar", "foo.bar.baz", false},
		{"foo.bar.baz", "foo.bar", false},

		// Single-token wildcard
		{"*.channel.twitch", "cheer.channel.twitch", true},
		{"*.channel.twitch", "follow.channel.twitch", true},
		{"*.channel.twitch", "channel.twitch", false},
		{"*.channel.twitch", "message.user.twitch", false},
		{"foo.*", "foo.bar", true},
		{"foo.*", "foo", false},
		{"foo.*", "foo.bar.baz", false},
		{"*.*.twitch", "message.user.twitch", true},

		// Multi-token tail
		{"foo.>", "foo.bar", true},
		{"foo.>", "foo.bar.baz", true},
		{"foo.>", "foo", false},
		{"workflow.>", "workflow.change.add", true},
		{">", "anything.at.all", true},

		// Edge cases
		{"", "", true},
		{"", "foo", false},
		{"foo", "", false},
	}

	for _, tc := range cases {
		got := Matches(tc.pattern, tc.subject)
		if got != tc.want {
			t.Errorf("Matches(%q, %q) = %v, want %v", tc.pattern, tc.subject, got, tc.want)
		}
	}
}
