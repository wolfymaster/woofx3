package config

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadMergesByPrecedence(t *testing.T) {
	root := writeFiles(t, map[string]string{
		".woofx3.json": `{"appName": "from-file", "fromDotenv": "from-file", "overwrite": "from-file", "blankInEnv": "from-file", "port": 4222, "on": true}`,
		".env":         "WOOFX3_FROM_DOTENV=from-dotenv\nWOOFX3_OVERWRITE=from-dotenv\n",
	})
	t.Setenv("WOOFX3_OVERWRITE", "from-process")
	t.Setenv("WOOFX3_BLANK_IN_ENV", "")

	env, err := Load(ResolveLocation(root))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	for key, want := range map[string]string{
		"WOOFX3_APP_NAME":     "from-file",
		"WOOFX3_FROM_DOTENV":  "from-dotenv",
		"WOOFX3_OVERWRITE":    "from-process",
		"WOOFX3_BLANK_IN_ENV": "from-file",
		"WOOFX3_PORT":         "4222",
		"WOOFX3_ON":           "true",
	} {
		if got := env[key]; got != want {
			t.Errorf("%s = %q, want %q", key, got, want)
		}
	}
}

func TestLoadRefusesAMissingRequiredFile(t *testing.T) {
	isolate(t)
	t.Setenv(ConfigFileEnv, filepath.Join(t.TempDir(), "missing.json"))

	if _, err := Load(ResolveLocation("")); err == nil {
		t.Fatal("Load accepted a WOOFX3_CONFIG naming a missing file")
	}
}

func TestLoadRefusesAConfigFileThatIsNotAJSONObject(t *testing.T) {
	cases := []struct {
		name    string
		content string
	}{
		{name: "malformed JSON", content: "{not json"},
		{name: "a JSON array", content: "[1, 2]"},
		{name: "a JSON scalar", content: "42"},
		{name: "JSON null", content: "null"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			isolate(t)
			path := filepath.Join(writeFiles(t, map[string]string{"engine.json": tc.content}), "engine.json")
			t.Setenv(ConfigFileEnv, path)

			_, err := Load(ResolveLocation(""))
			if err == nil || !strings.Contains(err.Error(), path) {
				t.Fatalf("Load error = %v, want one naming %s", err, path)
			}
		})
	}
}

func TestLoadRefusesAConfigPathThatIsADirectory(t *testing.T) {
	isolate(t)
	t.Setenv(ConfigFileEnv, t.TempDir())

	if _, err := Load(ResolveLocation("")); err == nil {
		t.Fatal("Load accepted a WOOFX3_CONFIG naming a directory")
	}
}
