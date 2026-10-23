package main

import (
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"

	woofx3config "github.com/wolfymaster/woofx3/common/config"
)

// SecretSpec is one engine secret the orchestrator hands every service it
// starts. The services refuse to start without a usable value, so the
// orchestrator resolves one before any of them runs.
type SecretSpec struct {
	// Name is the file the secret persists in under <state dir>/data/secrets.
	Name string
	// EnvKey is the variable the services read the secret from.
	EnvKey string
	// ConfigKey is the secret's key in .woofx3.json. Config file keys map to
	// variables by name, so EnvKey must be WOOFX3_ plus its SCREAMING_SNAKE form.
	ConfigKey string
}

// secretsSubdir holds generated secrets, one file per SecretSpec.Name, under
// the state dir. It sits inside data/ because that tree is what an engine
// persists: copyLegacyData carries it into a new data directory, and the
// production image keeps it on its /app/data volume. Anywhere else, the
// secrets would change whenever the container is recreated.
var secretsSubdir = filepath.Join("data", "secrets")

// engineStateDir is the directory the services resolve their relative paths
// against: the data directory when one is set, otherwise the working
// directory they inherit from the orchestrator.
func engineStateDir(workDir, dataDir string) string {
	if dataDir != "" {
		return dataDir
	}
	return workDir
}

// secretNamePattern keeps a SecretSpec.Name usable as a file name on every OS.
var secretNamePattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

const (
	secretsDirMode  fs.FileMode = 0o700
	secretFileMode  fs.FileMode = 0o600
	generatedSecret             = woofx3config.MinSecretBytes
)

// ResolveSecrets returns a usable value for each spec, keyed by its EnvKey.
// Each comes from the first of these that holds a valid secret (see
// woofx3config.ValidateSecret):
//
//  1. the environment (the process environment, then .env);
//  2. the config file;
//  3. <stateDir>/data/secrets/<Name>, written by an earlier run;
//  4. a new secret of MinSecretBytes bytes from random, hex-encoded and
//     written to that file (mode 0600, in a 0700 directory).
//
// A value that is set but invalid, such as a template placeholder, is logged
// and passed over rather than refused, so an install that carries one starts
// with a usable secret instead of failing.
// Running again reads the file back, so the generated value is stable.
func ResolveSecrets(specs []SecretSpec, sources woofx3config.Sources, stateDir string, random io.Reader, logger *slog.Logger) (map[string]string, error) {
	if err := checkSecretSpecs(specs); err != nil {
		return nil, err
	}
	if stateDir == "" {
		return nil, errors.New("resolving engine secrets: no state directory to keep them in")
	}
	environment := woofx3config.MergeByPrecedence(sources.Dotenv, sources.Process)
	secretsDir := filepath.Join(stateDir, secretsSubdir)

	resolved := make(map[string]string, len(specs))
	for _, spec := range specs {
		if value, ok := usableSecret(spec, environment[spec.EnvKey], "environment", logger); ok {
			resolved[spec.EnvKey] = value
			continue
		}
		if value, ok := usableSecret(spec, sources.File[spec.EnvKey], "config file", logger); ok {
			resolved[spec.EnvKey] = value
			continue
		}
		value, err := persistedSecret(spec, secretsDir, random, logger)
		if err != nil {
			return nil, fmt.Errorf("resolving %s: %w", spec.EnvKey, err)
		}
		resolved[spec.EnvKey] = value
	}
	return resolved, nil
}

// checkSecretSpecs refuses a registry the orchestrator could not honour: a
// name that is not a plain file name, an EnvKey the services would not find
// under ConfigKey, or two specs sharing a name or variable.
func checkSecretSpecs(specs []SecretSpec) error {
	names := make(map[string]bool, len(specs))
	envKeys := make(map[string]bool, len(specs))
	for _, spec := range specs {
		if !secretNamePattern.MatchString(spec.Name) {
			return fmt.Errorf("secret name %q must be lowercase words joined by hyphens", spec.Name)
		}
		if want := "WOOFX3_" + woofx3config.CamelToScreamingSnake(spec.ConfigKey); spec.ConfigKey == "" || spec.EnvKey != want {
			return fmt.Errorf("secret %s: EnvKey %q does not match ConfigKey %q", spec.Name, spec.EnvKey, spec.ConfigKey)
		}
		if names[spec.Name] || envKeys[spec.EnvKey] {
			return fmt.Errorf("secret %s (%s) is registered twice", spec.Name, spec.EnvKey)
		}
		names[spec.Name] = true
		envKeys[spec.EnvKey] = true
	}
	return nil
}

// usableSecret reports whether value, read from source, is a valid secret. A
// blank value is simply absent; any other invalid one is logged, by key and
// reason only, so the operator learns why their setting was passed over.
func usableSecret(spec SecretSpec, value, source string, logger *slog.Logger) (string, bool) {
	if strings.TrimSpace(value) == "" {
		return "", false
	}
	if err := woofx3config.ValidateSecret(spec.ConfigKey, value); err != nil {
		logger.Warn("Ignoring an engine secret that is not usable; falling back to the next source",
			"key", spec.EnvKey, "source", source, "reason", err)
		return "", false
	}
	return value, true
}

// persistedSecret reads the secret an earlier run wrote for spec, or writes a
// new one when there is none or it is not valid.
func persistedSecret(spec SecretSpec, secretsDir string, random io.Reader, logger *slog.Logger) (string, error) {
	path := filepath.Join(secretsDir, spec.Name)
	data, err := os.ReadFile(path)
	switch {
	case err == nil:
		value := strings.TrimSpace(string(data))
		validateErr := woofx3config.ValidateSecret(spec.ConfigKey, value)
		if validateErr == nil {
			return value, nil
		}
		logger.Warn("Replacing a stored engine secret that is not usable", "path", path, "reason", validateErr)
	case !errors.Is(err, fs.ErrNotExist):
		return "", fmt.Errorf("reading %s: %w", path, err)
	}

	raw := make([]byte, generatedSecret)
	if _, err := io.ReadFull(random, raw); err != nil {
		return "", fmt.Errorf("generating a secret: %w", err)
	}
	value := hex.EncodeToString(raw)
	if err := writeSecretFile(secretsDir, spec.Name, value); err != nil {
		return "", err
	}
	logger.Info("Generated an engine secret", "key", spec.EnvKey, "path", path)
	return value, nil
}

// writeSecretFile writes value to dir/name so that the file is either absent
// or complete: it is written beside its destination, flushed, and renamed
// into place. A crash part way leaves a temporary file, never a truncated
// secret.
func writeSecretFile(dir, name, value string) error {
	if err := os.MkdirAll(dir, secretsDirMode); err != nil {
		return fmt.Errorf("creating %s: %w", dir, err)
	}
	// MkdirAll leaves an existing directory's mode alone, and the umask can
	// widen a new one; neither may expose the secrets.
	if err := os.Chmod(dir, secretsDirMode); err != nil {
		return fmt.Errorf("restricting %s: %w", dir, err)
	}
	temp, err := os.CreateTemp(dir, "."+name+".*.tmp")
	if err != nil {
		return fmt.Errorf("creating a temporary file in %s: %w", dir, err)
	}
	tempPath := temp.Name()
	committed := false
	defer func() {
		if !committed {
			// Best effort: the write already failed, and a stray temporary
			// file is never read as a secret.
			_ = temp.Close()
			_ = os.Remove(tempPath)
		}
	}()
	if err := temp.Chmod(secretFileMode); err != nil {
		return fmt.Errorf("restricting %s: %w", tempPath, err)
	}
	if _, err := temp.WriteString(value); err != nil {
		return fmt.Errorf("writing %s: %w", tempPath, err)
	}
	if err := temp.Sync(); err != nil {
		return fmt.Errorf("flushing %s: %w", tempPath, err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("closing %s: %w", tempPath, err)
	}
	path := filepath.Join(dir, name)
	if err := os.Rename(tempPath, path); err != nil {
		return fmt.Errorf("renaming %s to %s: %w", tempPath, path, err)
	}
	committed = true
	return syncDirectory(dir)
}

// syncDirectory flushes dir's entries, so a rename into it survives a power
// loss. Windows cannot open a directory for writing and commits renames to
// disk itself, so there is nothing to do there.
func syncDirectory(dir string) error {
	if runtime.GOOS == "windows" {
		return nil
	}
	handle, err := os.Open(dir)
	if err != nil {
		return fmt.Errorf("opening %s: %w", dir, err)
	}
	syncErr := handle.Sync()
	closeErr := handle.Close()
	if syncErr != nil {
		return fmt.Errorf("flushing %s: %w", dir, syncErr)
	}
	if closeErr != nil {
		return fmt.Errorf("closing %s: %w", dir, closeErr)
	}
	return nil
}

// serviceEnvironment is base with overrides set over it. Each overridden key
// is removed from base before the override is appended, because a process
// may read either of two entries for one key: Go's os.Getenv in the child
// takes the first.
func serviceEnvironment(base []string, overrides map[string]string) []string {
	if len(overrides) == 0 {
		return base
	}
	out := make([]string, 0, len(base)+len(overrides))
	for _, entry := range base {
		key, _, _ := strings.Cut(entry, "=")
		if _, overridden := overrides[key]; overridden {
			continue
		}
		out = append(out, entry)
	}
	keys := make([]string, 0, len(overrides))
	for key := range overrides {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		out = append(out, key+"="+overrides[key])
	}
	return out
}
