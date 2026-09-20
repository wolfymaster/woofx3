package services

import "testing"

func TestNormalizeInstanceSettings(t *testing.T) {
	cases := map[string]string{
		"":                            "{}",
		"   ":                         "{}",
		"null":                        "{}",
		`{"lifetime":"session"}`:      `{"lifetime":"session"}`,
		`{"initialValue":0,"step":1}`: `{"initialValue":0,"step":1}`,
	}
	for raw, want := range cases {
		got, err := normalizeInstanceSettings(raw)
		if err != nil {
			t.Errorf("normalizeInstanceSettings(%q): %v", raw, err)
			continue
		}
		if got != want {
			t.Errorf("normalizeInstanceSettings(%q) = %q, want %q", raw, got, want)
		}
	}

	// Every reader decodes an object; anything else is refused at the door.
	for _, raw := range []string{`[1,2]`, `"text"`, `42`, `{not json`} {
		if _, err := normalizeInstanceSettings(raw); err == nil {
			t.Errorf("normalizeInstanceSettings(%q) accepted a non-object", raw)
		}
	}
}
