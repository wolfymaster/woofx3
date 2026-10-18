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

func TestDataDirIsMadeAbsolute(t *testing.T) {
	t.Setenv(DataDirEnv, "relative-data")

	got := DataDir()
	if !filepath.IsAbs(got) || filepath.Base(got) != "relative-data" {
		t.Errorf("DataDir() = %q, want an absolute path ending in relative-data", got)
	}
}

func TestDataDirBlankCountsAsUnset(t *testing.T) {
	t.Setenv(DataDirEnv, "   ")

	if got := DataDir(); got != "" {
		t.Errorf("DataDir() = %q, want empty", got)
	}
}
