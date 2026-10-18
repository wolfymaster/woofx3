package config

import (
	"path/filepath"
	"testing"
)

func TestResolveDataPathWithoutDataDirLeavesPathsAlone(t *testing.T) {
	t.Setenv(DataDirEnv, "")

	for _, path := range []string{"./data/module-storage.db", "modules", "", filepath.Join(t.TempDir(), "x.db")} {
		if got := ResolveDataPath(path); got != path {
			t.Errorf("ResolveDataPath(%q) = %q, want it unchanged", path, got)
		}
	}
}

func TestResolveDataPathAnchorsRelativePathsInTheDataDir(t *testing.T) {
	dataDir := t.TempDir()
	t.Setenv(DataDirEnv, dataDir)

	if got, want := ResolveDataPath("./data/module-storage.db"), filepath.Join(dataDir, "data", "module-storage.db"); got != want {
		t.Errorf("relative path resolved to %q, want %q", got, want)
	}
	absolute := filepath.Join(t.TempDir(), "elsewhere.db")
	if got := ResolveDataPath(absolute); got != absolute {
		t.Errorf("absolute path resolved to %q, want it unchanged", got)
	}
}

func TestCheckDataDir(t *testing.T) {
	cases := []struct {
		name  string
		value string
		ok    bool
	}{
		{name: "unset", value: "", ok: true},
		{name: "blank", value: "  ", ok: true},
		{name: "absolute", value: t.TempDir(), ok: true},
		{name: "relative", value: "relative-data", ok: false},
		{name: "dot relative", value: "./data", ok: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(DataDirEnv, tc.value)

			if err := CheckDataDir(); (err == nil) != tc.ok {
				t.Errorf("CheckDataDir() = %v, want ok %v", err, tc.ok)
			}
		})
	}
}

func TestLoadRefusesARelativeDataDir(t *testing.T) {
	isolate(t)
	t.Setenv(DataDirEnv, "relative-data")

	if _, err := Load(ResolveLocation("")); err == nil {
		t.Fatal("Load accepted a relative WOOFX3_DATA_DIR")
	}
}

func TestDataDirBlankCountsAsUnset(t *testing.T) {
	t.Setenv(DataDirEnv, "   ")

	if got := DataDir(); got != "" {
		t.Errorf("DataDir() = %q, want empty", got)
	}
}
