package runtime

import (
	"os"
	"path/filepath"
	"testing"
)

// writeConfigRoot creates a throwaway root holding the given files.
func writeConfigRoot(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	return root
}

func TestProcessEnvOverridesDotenvWhichOverridesTheFile(t *testing.T) {
	root := writeConfigRoot(t, map[string]string{
		".woofx3.json": `{"appName": "from-file", "fromDotenv": "from-file", "overwrite": "from-file"}`,
		".env":         "WOOFX3_FROM_DOTENV=from-dotenv\nWOOFX3_OVERWRITE=from-dotenv\n",
	})
	t.Setenv("WOOFX3_OVERWRITE", "from-process")

	env, err := LoadRuntimeEnv(&LoadRuntimeEnvOptions{RootDir: root})
	if err != nil {
		t.Fatalf("LoadRuntimeEnv: %v", err)
	}

	for key, want := range map[string]string{
		"WOOFX3_APP_NAME":    "from-file",
		"WOOFX3_FROM_DOTENV": "from-dotenv",
		"WOOFX3_OVERWRITE":   "from-process",
	} {
		if got := env[key]; got != want {
			t.Errorf("%s = %q, want %q", key, got, want)
		}
	}
}

func TestABlankValueNeverMasksANonBlankOne(t *testing.T) {
	root := writeConfigRoot(t, map[string]string{
		".woofx3.json": `{"blankInFile": "", "blankInEnv": "from-file", "blankEverywhere": ""}`,
	})
	t.Setenv("WOOFX3_BLANK_IN_FILE", "from-process")
	t.Setenv("WOOFX3_BLANK_IN_ENV", "")

	env, err := LoadRuntimeEnv(&LoadRuntimeEnvOptions{RootDir: root})
	if err != nil {
		t.Fatalf("LoadRuntimeEnv: %v", err)
	}

	if got := env["WOOFX3_BLANK_IN_FILE"]; got != "from-process" {
		t.Errorf("blank file value masked the environment: got %q", got)
	}
	if got := env["WOOFX3_BLANK_IN_ENV"]; got != "from-file" {
		t.Errorf("blank environment value masked the file: got %q", got)
	}
	if got, ok := env["WOOFX3_BLANK_EVERYWHERE"]; !ok || got != "" {
		t.Errorf("a key blank everywhere must still resolve to blank: got %q (present %v)", got, ok)
	}
}
