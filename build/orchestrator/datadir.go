package main

import (
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

// legacyDataDirectories hold an engine's state when it runs without
// WOOFX3_DATA_DIR: the system database and module storage (./data, the
// default databaseUrl and storagePath in build/config/.woofx3.json) and the
// installed modules (./modules, barkloader's default file destination).
// Logs, uploads in progress and caches are left behind; nothing is lost
// without them.
var legacyDataDirectories = []string{"data", "modules"}

// copyLegacyData gives a data directory the state an engine wrote before it
// had one. Without WOOFX3_DATA_DIR the services resolve their relative paths
// against the working directory they inherit from the orchestrator; with it,
// against the data directory. For each directory in legacyDataDirectories
// that exists under workDir and not yet under dataDir, the directory is
// copied across before any service starts, so the engine keeps its
// database and modules instead of starting empty.
//
// The originals stay where they are, so unsetting WOOFX3_DATA_DIR returns to
// them. A directory that already exists in the data directory is never
// touched: it is the engine's state from an earlier run. Each copy is
// written beside its destination and renamed into place, so a copy cut
// short is redone on the next start rather than mistaken for a finished one.
func copyLegacyData(workDir, dataDir string, logger *slog.Logger) error {
	if dataDir == "" {
		return nil
	}
	for _, name := range legacyDataDirectories {
		source := filepath.Join(workDir, name)
		destination := filepath.Join(dataDir, name)
		copied, err := copyDirectoryOnce(source, destination)
		if err != nil {
			return fmt.Errorf("copying %s into %s: %w", source, destination, err)
		}
		if copied {
			logger.Info("Copied existing engine data into the data directory", "from", source, "to", destination)
		}
	}
	return nil
}

// copyDirectoryOnce copies source to destination when source is a directory
// and destination does not exist, and reports whether it copied.
func copyDirectoryOnce(source, destination string) (bool, error) {
	sourceInfo, err := os.Stat(source)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !sourceInfo.IsDir() {
		return false, nil
	}
	if _, err := os.Lstat(destination); err == nil {
		return false, nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return false, err
	}
	if within(destination, source) {
		return false, errors.New("the data directory is inside the directory it would be copied from")
	}

	partial := destination + ".partial"
	if err := os.RemoveAll(partial); err != nil {
		return false, fmt.Errorf("removing an unfinished copy: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return false, err
	}
	if err := os.CopyFS(partial, os.DirFS(source)); err != nil {
		return false, err
	}
	if err := os.Rename(partial, destination); err != nil {
		return false, err
	}
	return true, nil
}

// within reports whether path is directory or lies under it. Both must be
// cleaned absolute paths or both relative to the same directory.
func within(path, directory string) bool {
	relative, err := filepath.Rel(directory, path)
	if err != nil {
		return false
	}
	return relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)))
}
