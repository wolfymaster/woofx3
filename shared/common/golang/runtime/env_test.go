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

// loadWithLocationEnv clears both location variables, sets the given ones, and loads with no
// explicit root, from a working directory with no config file above it.
func loadWithLocationEnv(t *testing.T, vars map[string]string) (map[string]string, error) {
	t.Helper()
	t.Setenv(RootDirEnv, "")
	t.Setenv(ConfigFileEnv, "")
	for name, value := range vars {
		t.Setenv(name, value)
	}
	t.Chdir(t.TempDir())
	return LoadRuntimeEnv(nil)
}

func TestWoofx3RootNamesTheConfigRoot(t *testing.T) {
	root := writeConfigRoot(t, map[string]string{
		".woofx3.json": `{"locationRootFile": "from-root"}`,
		".env":         "WOOFX3_LOCATION_ROOT_DOTENV=from-root\n",
	})

	env, err := loadWithLocationEnv(t, map[string]string{RootDirEnv: root})
	if err != nil {
		t.Fatalf("LoadRuntimeEnv: %v", err)
	}

	if got := env["WOOFX3_LOCATION_ROOT_FILE"]; got != "from-root" {
		t.Errorf("config file under WOOFX3_ROOT not read: got %q", got)
	}
	if got := env["WOOFX3_LOCATION_ROOT_DOTENV"]; got != "from-root" {
		t.Errorf(".env under WOOFX3_ROOT not read: got %q", got)
	}
}

func TestWoofx3ConfigNamesTheConfigFileAndItsDirectoryHoldsDotenv(t *testing.T) {
	dir := writeConfigRoot(t, map[string]string{
		"engine.json": `{"locationConfigFile": "from-named-file"}`,
		".env":        "WOOFX3_LOCATION_CONFIG_DOTENV=from-file-dir\n",
	})

	env, err := loadWithLocationEnv(t, map[string]string{ConfigFileEnv: filepath.Join(dir, "engine.json")})
	if err != nil {
		t.Fatalf("LoadRuntimeEnv: %v", err)
	}

	if got := env["WOOFX3_LOCATION_CONFIG_FILE"]; got != "from-named-file" {
		t.Errorf("WOOFX3_CONFIG file not read: got %q", got)
	}
	if got := env["WOOFX3_LOCATION_CONFIG_DOTENV"]; got != "from-file-dir" {
		t.Errorf(".env beside the WOOFX3_CONFIG file not read: got %q", got)
	}
}

func TestWoofx3ConfigBeatsTheRootsConfigFileButTheRootKeepsDotenv(t *testing.T) {
	root := writeConfigRoot(t, map[string]string{
		".woofx3.json": `{"locationBoth": "from-root-file"}`,
		".env":         "WOOFX3_LOCATION_BOTH_DOTENV=from-root\n",
	})
	dir := writeConfigRoot(t, map[string]string{"engine.json": `{"locationBoth": "from-named-file"}`})

	env, err := loadWithLocationEnv(t, map[string]string{
		RootDirEnv:    root,
		ConfigFileEnv: filepath.Join(dir, "engine.json"),
	})
	if err != nil {
		t.Fatalf("LoadRuntimeEnv: %v", err)
	}

	if got := env["WOOFX3_LOCATION_BOTH"]; got != "from-named-file" {
		t.Errorf("WOOFX3_CONFIG did not win over WOOFX3_ROOT's file: got %q", got)
	}
	if got := env["WOOFX3_LOCATION_BOTH_DOTENV"]; got != "from-root" {
		t.Errorf(".env under WOOFX3_ROOT not read: got %q", got)
	}
}

func TestAMissingWoofx3ConfigFileIsAnError(t *testing.T) {
	_, err := loadWithLocationEnv(t, map[string]string{
		ConfigFileEnv: filepath.Join(t.TempDir(), "missing.json"),
	})
	if err == nil {
		t.Fatal("LoadRuntimeEnv accepted a WOOFX3_CONFIG naming a missing file")
	}
}

func TestAnExplicitRootDirIgnoresTheLocationVariables(t *testing.T) {
	root := writeConfigRoot(t, map[string]string{".woofx3.json": `{"locationExplicit": "from-explicit"}`})
	other := writeConfigRoot(t, map[string]string{".woofx3.json": `{"locationExplicit": "from-env-root"}`})
	t.Setenv(RootDirEnv, other)
	t.Setenv(ConfigFileEnv, filepath.Join(other, ".woofx3.json"))

	env, err := LoadRuntimeEnv(&LoadRuntimeEnvOptions{RootDir: root})
	if err != nil {
		t.Fatalf("LoadRuntimeEnv: %v", err)
	}

	if got := env["WOOFX3_LOCATION_EXPLICIT"]; got != "from-explicit" {
		t.Errorf("explicit RootDir did not win: got %q", got)
	}
}

func TestWithoutLocationVariablesTheConfigIsFoundAboveTheWorkingDirectory(t *testing.T) {
	root := writeConfigRoot(t, map[string]string{".woofx3.json": `{"locationSearch": "from-parent"}`})
	nested := filepath.Join(root, "service", "bin")
	if err := os.MkdirAll(nested, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	t.Setenv(RootDirEnv, "")
	t.Setenv(ConfigFileEnv, "")
	t.Chdir(nested)

	env, err := LoadRuntimeEnv(nil)
	if err != nil {
		t.Fatalf("LoadRuntimeEnv: %v", err)
	}

	if got := env["WOOFX3_LOCATION_SEARCH"]; got != "from-parent" {
		t.Errorf("parent-directory search did not find the config: got %q", got)
	}
}
