package main

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(content)
}

func TestCopyLegacyDataCopiesTheDatabaseAndModulesOnFirstRun(t *testing.T) {
	workDir := t.TempDir()
	dataDir := filepath.Join(t.TempDir(), "woofx3")
	writeFile(t, filepath.Join(workDir, "data", "woofx3.db"), "system")
	writeFile(t, filepath.Join(workDir, "data", "module-storage.db"), "storage")
	writeFile(t, filepath.Join(workDir, "modules", "chat-games", "manifest.json"), "{}")
	writeFile(t, filepath.Join(workDir, "logs", "api.log"), "log")

	if err := copyLegacyData(workDir, dataDir, discardLogger()); err != nil {
		t.Fatalf("copyLegacyData: %v", err)
	}

	if got := readFile(t, filepath.Join(dataDir, "data", "woofx3.db")); got != "system" {
		t.Errorf("woofx3.db = %q, want the original", got)
	}
	if got := readFile(t, filepath.Join(dataDir, "data", "module-storage.db")); got != "storage" {
		t.Errorf("module-storage.db = %q, want the original", got)
	}
	if got := readFile(t, filepath.Join(dataDir, "modules", "chat-games", "manifest.json")); got != "{}" {
		t.Errorf("manifest.json = %q, want the original", got)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "logs")); !os.IsNotExist(err) {
		t.Errorf("logs were copied (stat error %v)", err)
	}
	if got := readFile(t, filepath.Join(workDir, "data", "woofx3.db")); got != "system" {
		t.Errorf("the original woofx3.db = %q, want it left in place", got)
	}
}

func TestCopyLegacyDataNeverTouchesADirectoryAlreadyInTheDataDirectory(t *testing.T) {
	workDir := t.TempDir()
	dataDir := t.TempDir()
	writeFile(t, filepath.Join(workDir, "data", "woofx3.db"), "old")
	writeFile(t, filepath.Join(workDir, "modules", "a", "manifest.json"), "{}")
	writeFile(t, filepath.Join(dataDir, "data", "woofx3.db"), "current")

	if err := copyLegacyData(workDir, dataDir, discardLogger()); err != nil {
		t.Fatalf("copyLegacyData: %v", err)
	}

	if got := readFile(t, filepath.Join(dataDir, "data", "woofx3.db")); got != "current" {
		t.Errorf("woofx3.db = %q, want the data directory's own", got)
	}
	if got := readFile(t, filepath.Join(dataDir, "modules", "a", "manifest.json")); got != "{}" {
		t.Errorf("modules were not copied alongside an existing data directory: %q", got)
	}
}

func TestCopyLegacyDataRedoesACopyThatWasCutShort(t *testing.T) {
	workDir := t.TempDir()
	dataDir := t.TempDir()
	writeFile(t, filepath.Join(workDir, "data", "woofx3.db"), "system")
	writeFile(t, filepath.Join(dataDir, "data.partial", "stale.db"), "half")

	if err := copyLegacyData(workDir, dataDir, discardLogger()); err != nil {
		t.Fatalf("copyLegacyData: %v", err)
	}

	if got := readFile(t, filepath.Join(dataDir, "data", "woofx3.db")); got != "system" {
		t.Errorf("woofx3.db = %q, want the original", got)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "data", "stale.db")); !os.IsNotExist(err) {
		t.Errorf("the unfinished copy's file survived (stat error %v)", err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "data.partial")); !os.IsNotExist(err) {
		t.Errorf("the unfinished copy was left behind (stat error %v)", err)
	}
}

func TestCopyLegacyDataDoesNothingWithoutADataDirectoryOrExistingData(t *testing.T) {
	workDir := t.TempDir()
	writeFile(t, filepath.Join(workDir, "data", "woofx3.db"), "system")
	if err := copyLegacyData(workDir, "", discardLogger()); err != nil {
		t.Fatalf("copyLegacyData without a data directory: %v", err)
	}

	dataDir := t.TempDir()
	if err := copyLegacyData(t.TempDir(), dataDir, discardLogger()); err != nil {
		t.Fatalf("copyLegacyData with nothing to copy: %v", err)
	}
	entries, err := os.ReadDir(dataDir)
	if err != nil {
		t.Fatalf("read data directory: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("data directory has %d entries, want none", len(entries))
	}
}

func TestCopyLegacyDataIgnoresAFileNamedLikeADataDirectory(t *testing.T) {
	workDir := t.TempDir()
	dataDir := t.TempDir()
	writeFile(t, filepath.Join(workDir, "data"), "not a directory")

	if err := copyLegacyData(workDir, dataDir, discardLogger()); err != nil {
		t.Fatalf("copyLegacyData: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "data")); !os.IsNotExist(err) {
		t.Errorf("a file was copied as data (stat error %v)", err)
	}
}

func TestCopyLegacyDataRefusesADataDirectoryInsideTheDataItWouldCopy(t *testing.T) {
	workDir := t.TempDir()
	writeFile(t, filepath.Join(workDir, "data", "woofx3.db"), "system")

	err := copyLegacyData(workDir, filepath.Join(workDir, "data", "engine"), discardLogger())
	if err == nil {
		t.Fatal("copyLegacyData copied a directory into itself")
	}
}

func TestWithin(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "srv", "engine")
	tests := []struct {
		name string
		path string
		want bool
	}{
		{name: "the directory itself", path: root, want: true},
		{name: "a child", path: filepath.Join(root, "data"), want: true},
		{name: "the parent", path: filepath.Dir(root), want: false},
		{name: "a sibling sharing a prefix", path: root + "-data", want: false},
		{name: "a child named like a parent reference", path: filepath.Join(root, "..data"), want: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := within(test.path, root); got != test.want {
				t.Errorf("within(%q, %q) = %v, want %v", test.path, root, got, test.want)
			}
		})
	}
}
