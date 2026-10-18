package config

import (
	"os"
	"path/filepath"
	"testing"
)

// writeFiles creates a throwaway directory holding the given files and returns it.
func writeFiles(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	return dir
}

// isolate clears the location variables and moves to a working directory with no config file
// above it, so only what a test sets is found.
func isolate(t *testing.T) string {
	t.Helper()
	t.Setenv(ConfigFileEnv, "")
	t.Setenv(RootDirEnv, "")
	dir := t.TempDir()
	t.Chdir(dir)
	return dir
}

func TestResolveLocation(t *testing.T) {
	jsonRoot := writeFiles(t, map[string]string{".woofx3.json": "{}", ".woofx3.config": "{}"})
	configRoot := writeFiles(t, map[string]string{".woofx3.config": "{}"})
	emptyRoot := t.TempDir()
	named := filepath.Join(configRoot, "engine.json")

	cases := []struct {
		name    string
		rootDir string
		env     map[string]string
		want    Location
	}{
		{
			name:    "an explicit root ignores the variables",
			rootDir: jsonRoot,
			env:     map[string]string{RootDirEnv: emptyRoot, ConfigFileEnv: named},
			want:    Location{RootDir: jsonRoot, ConfigPath: filepath.Join(jsonRoot, ".woofx3.json")},
		},
		{
			name:    "a blank explicit root counts as unset",
			rootDir: "  ",
			env:     map[string]string{RootDirEnv: jsonRoot},
			want:    Location{RootDir: jsonRoot, ConfigPath: filepath.Join(jsonRoot, ".woofx3.json")},
		},
		{
			name: "WOOFX3_CONFIG names the file, with .env from its directory",
			env:  map[string]string{ConfigFileEnv: named},
			want: Location{RootDir: configRoot, ConfigPath: named, Required: true},
		},
		{
			name: "WOOFX3_CONFIG names the file and WOOFX3_ROOT the .env directory",
			env:  map[string]string{RootDirEnv: emptyRoot, ConfigFileEnv: named},
			want: Location{RootDir: emptyRoot, ConfigPath: named, Required: true},
		},
		{
			name: "the variables are trimmed",
			env:  map[string]string{RootDirEnv: " " + emptyRoot + "\n", ConfigFileEnv: "\t" + named + " "},
			want: Location{RootDir: emptyRoot, ConfigPath: named, Required: true},
		},
		{
			name: "WOOFX3_ROOT prefers .woofx3.json",
			env:  map[string]string{RootDirEnv: jsonRoot},
			want: Location{RootDir: jsonRoot, ConfigPath: filepath.Join(jsonRoot, ".woofx3.json")},
		},
		{
			name: "WOOFX3_ROOT falls back to .woofx3.config",
			env:  map[string]string{RootDirEnv: configRoot},
			want: Location{RootDir: configRoot, ConfigPath: filepath.Join(configRoot, ".woofx3.config")},
		},
		{
			name: "WOOFX3_ROOT without a config file",
			env:  map[string]string{RootDirEnv: emptyRoot},
			want: Location{RootDir: emptyRoot},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			isolate(t)
			for key, value := range tc.env {
				t.Setenv(key, value)
			}

			if got := ResolveLocation(tc.rootDir); got != tc.want {
				t.Errorf("ResolveLocation = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestResolveLocationSearchesAboveTheWorkingDirectory(t *testing.T) {
	isolate(t)
	root := writeFiles(t, map[string]string{".woofx3.config": "{}"})
	nested := filepath.Join(root, "service", "bin")
	if err := os.MkdirAll(nested, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	t.Chdir(nested)

	want := Location{RootDir: root, ConfigPath: filepath.Join(root, ".woofx3.config"), Searched: true}
	if got := ResolveLocation(""); got != want {
		t.Errorf("ResolveLocation = %+v, want %+v", got, want)
	}
}

func TestResolveLocationWithNothingFoundIsTheWorkingDirectory(t *testing.T) {
	cwd := isolate(t)

	want := Location{RootDir: cwd, Searched: true}
	if got := ResolveLocation(""); got != want {
		t.Errorf("ResolveLocation = %+v, want %+v", got, want)
	}
}
