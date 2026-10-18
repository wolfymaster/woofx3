package logging

import (
	"path/filepath"
	"testing"
)

func TestResolveLogDirectoryWithoutDataDir(t *testing.T) {
	t.Setenv(dataDirEnv, "")

	t.Setenv(envLogDirectory, "")
	if got := ResolveLogDirectory("/srv/woofx3/logs"); got != "/srv/woofx3/logs" {
		t.Errorf("configured directory resolved to %q", got)
	}
	if got := ResolveLogDirectory(""); got != defaultLogDirectory {
		t.Errorf("no directory resolved to %q, want %q", got, defaultLogDirectory)
	}

	t.Setenv(envLogDirectory, "elsewhere")
	if got := ResolveLogDirectory("/srv/woofx3/logs"); got != "/srv/woofx3/logs" {
		t.Errorf("the configured directory must beat WOOFX3_LOG_DIR, got %q", got)
	}
	if got := ResolveLogDirectory(""); got != "elsewhere" {
		t.Errorf("WOOFX3_LOG_DIR resolved to %q", got)
	}
}

func TestResolveLogDirectoryWithDataDir(t *testing.T) {
	dataDir := t.TempDir()
	t.Setenv(dataDirEnv, dataDir)

	t.Setenv(envLogDirectory, "")
	if got, want := ResolveLogDirectory("/opt/woofx3/logs"), filepath.Join(dataDir, "logs"); got != want {
		t.Errorf("got %q, want %q: the data dir replaces the install-root directory", got, want)
	}

	t.Setenv(envLogDirectory, "service-logs")
	if got, want := ResolveLogDirectory("/opt/woofx3/logs"), filepath.Join(dataDir, "service-logs"); got != want {
		t.Errorf("relative WOOFX3_LOG_DIR resolved to %q, want %q", got, want)
	}

	absolute := filepath.Join(t.TempDir(), "logs")
	t.Setenv(envLogDirectory, absolute)
	if got := ResolveLogDirectory(""); got != absolute {
		t.Errorf("absolute WOOFX3_LOG_DIR resolved to %q, want %q", got, absolute)
	}
}
