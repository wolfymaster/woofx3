package main

import (
	"bytes"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	woofx3config "github.com/wolfymaster/woofx3/common/config"
)

var barkloaderKeySpec = SecretSpec{Name: "barkloader-key", EnvKey: "WOOFX3_BARKLOADER_KEY", ConfigKey: "barkloaderKey"}

// fixedRandom yields the same byte forever, so a generated secret is known
// in advance: 32 of b, hex-encoded.
type fixedRandom byte

func (b fixedRandom) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = byte(b)
	}
	return len(p), nil
}

func hexOf(b byte, n int) string {
	return hex.EncodeToString(bytes.Repeat([]byte{b}, n))
}

func TestResolveSecrets(t *testing.T) {
	valid := strings.Repeat("v", 40)
	other := strings.Repeat("o", 40)
	generated := hexOf(0xab, 32)

	cases := []struct {
		name    string
		sources woofx3config.Sources
		// stored is the secret file's content before the call; "" means no file.
		stored string
		want   string
		// wantStored is the secret file's content after the call; "" means no file.
		wantStored string
	}{
		{
			name:    "a valid environment value wins",
			sources: woofx3config.Sources{Process: map[string]string{"WOOFX3_BARKLOADER_KEY": valid}, File: map[string]string{"WOOFX3_BARKLOADER_KEY": other}},
			want:    valid,
		},
		{
			name:    ".env counts as the environment",
			sources: woofx3config.Sources{Dotenv: map[string]string{"WOOFX3_BARKLOADER_KEY": valid}, File: map[string]string{"WOOFX3_BARKLOADER_KEY": other}},
			want:    valid,
		},
		{
			name:       "a placeholder in the environment is ignored",
			sources:    woofx3config.Sources{Process: map[string]string{"WOOFX3_BARKLOADER_KEY": "CHANGE_ME"}},
			want:       generated,
			wantStored: generated,
		},
		{
			name:    "a valid config file value is used when the environment has none",
			sources: woofx3config.Sources{Process: map[string]string{"WOOFX3_BARKLOADER_KEY": "  "}, File: map[string]string{"WOOFX3_BARKLOADER_KEY": valid}},
			stored:  other,
			want:    valid,
			// The stored file is left alone.
			wantStored: other,
		},
		{
			name:       "a placeholder in the config file is ignored",
			sources:    woofx3config.Sources{File: map[string]string{"WOOFX3_BARKLOADER_KEY": "CHANGE_ME"}},
			want:       generated,
			wantStored: generated,
		},
		{
			name:       "a short config file value falls back to the stored secret",
			sources:    woofx3config.Sources{File: map[string]string{"WOOFX3_BARKLOADER_KEY": "too-short"}},
			stored:     other + "\n",
			want:       other,
			wantStored: other + "\n",
		},
		{
			name:       "an unusable stored secret is replaced",
			stored:     "changeme",
			want:       generated,
			wantStored: generated,
		},
		{
			name:       "nothing set generates one",
			want:       generated,
			wantStored: generated,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dataDir := t.TempDir()
			path := filepath.Join(dataDir, "data", "secrets", barkloaderKeySpec.Name)
			if tc.stored != "" {
				if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
					t.Fatalf("mkdir: %v", err)
				}
				if err := os.WriteFile(path, []byte(tc.stored), 0o600); err != nil {
					t.Fatalf("write stored secret: %v", err)
				}
			}

			got, err := ResolveSecrets([]SecretSpec{barkloaderKeySpec}, tc.sources, dataDir, fixedRandom(0xab), discardLogger())
			if err != nil {
				t.Fatalf("ResolveSecrets: %v", err)
			}
			if want := map[string]string{"WOOFX3_BARKLOADER_KEY": tc.want}; !reflect.DeepEqual(got, want) {
				t.Errorf("ResolveSecrets = %v, want %v", got, want)
			}

			stored, err := os.ReadFile(path)
			switch {
			case tc.wantStored == "" && !os.IsNotExist(err):
				t.Errorf("secret file exists (%v), want none", err)
			case tc.wantStored != "" && err != nil:
				t.Errorf("read secret file: %v", err)
			case tc.wantStored != "" && string(stored) != tc.wantStored:
				t.Errorf("secret file = %q, want %q", stored, tc.wantStored)
			}
		})
	}
}

func TestResolveSecretsGeneratesOncePrivately(t *testing.T) {
	dataDir := t.TempDir()
	specs := []SecretSpec{
		barkloaderKeySpec,
		{Name: "scene-manager-token-secret", EnvKey: "WOOFX3_SCENE_MANAGER_TOKEN_SECRET", ConfigKey: "sceneManagerTokenSecret"},
	}

	first, err := ResolveSecrets(specs, woofx3config.Sources{}, dataDir, fixedRandom(0x11), discardLogger())
	if err != nil {
		t.Fatalf("first ResolveSecrets: %v", err)
	}
	// A different random source on the second run proves the value is read
	// back rather than generated again.
	second, err := ResolveSecrets(specs, woofx3config.Sources{}, dataDir, fixedRandom(0x22), discardLogger())
	if err != nil {
		t.Fatalf("second ResolveSecrets: %v", err)
	}
	want := map[string]string{
		"WOOFX3_BARKLOADER_KEY":             hexOf(0x11, 32),
		"WOOFX3_SCENE_MANAGER_TOKEN_SECRET": hexOf(0x11, 32),
	}
	if !reflect.DeepEqual(first, want) || !reflect.DeepEqual(second, want) {
		t.Fatalf("first = %v, second = %v, want both %v", first, second, want)
	}

	if runtime.GOOS == "windows" {
		return
	}
	secretsDir := filepath.Join(dataDir, "data", "secrets")
	assertMode(t, secretsDir, 0o700)
	for _, spec := range specs {
		assertMode(t, filepath.Join(secretsDir, spec.Name), 0o600)
	}
	entries, err := os.ReadDir(secretsDir)
	if err != nil {
		t.Fatalf("read secrets dir: %v", err)
	}
	if len(entries) != len(specs) {
		t.Errorf("secrets dir holds %d entries, want %d: no temporary files left", len(entries), len(specs))
	}
}

func assertMode(t *testing.T, path string, want os.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	if got := info.Mode().Perm(); got != want {
		t.Errorf("%s mode = %o, want %o", path, got, want)
	}
}

func TestResolveSecretsRefusesABadRegistry(t *testing.T) {
	cases := []struct {
		name  string
		specs []SecretSpec
	}{
		{"name with a path separator", []SecretSpec{{Name: "../key", EnvKey: "WOOFX3_BARKLOADER_KEY", ConfigKey: "barkloaderKey"}}},
		{"empty name", []SecretSpec{{Name: "", EnvKey: "WOOFX3_BARKLOADER_KEY", ConfigKey: "barkloaderKey"}}},
		{"variable that does not match the config key", []SecretSpec{{Name: "barkloader-key", EnvKey: "BARKLOADER_KEY", ConfigKey: "barkloaderKey"}}},
		{"no config key", []SecretSpec{{Name: "barkloader-key", EnvKey: "WOOFX3_", ConfigKey: ""}}},
		{"duplicate name", []SecretSpec{barkloaderKeySpec, {Name: "barkloader-key", EnvKey: "WOOFX3_OTHER_KEY", ConfigKey: "otherKey"}}},
		{"duplicate variable", []SecretSpec{barkloaderKeySpec, {Name: "other-key", EnvKey: "WOOFX3_BARKLOADER_KEY", ConfigKey: "barkloaderKey"}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := ResolveSecrets(tc.specs, woofx3config.Sources{}, t.TempDir(), fixedRandom(0), discardLogger()); err == nil {
				t.Fatal("ResolveSecrets accepted the registry")
			}
		})
	}
}

func TestResolveSecretsNeedsAStateDir(t *testing.T) {
	if _, err := ResolveSecrets([]SecretSpec{barkloaderKeySpec}, woofx3config.Sources{}, "", fixedRandom(0), discardLogger()); err == nil {
		t.Fatal("ResolveSecrets accepted no state directory")
	}
}

func TestResolveSecretsReportsAFailedRandomSource(t *testing.T) {
	_, err := ResolveSecrets([]SecretSpec{barkloaderKeySpec}, woofx3config.Sources{}, t.TempDir(), bytes.NewReader(nil), discardLogger())
	if err == nil || !strings.Contains(err.Error(), io.EOF.Error()) {
		t.Fatalf("ResolveSecrets = %v, want the random source's EOF", err)
	}
}

func TestServiceEnvironment(t *testing.T) {
	cases := []struct {
		name      string
		base      []string
		overrides map[string]string
		want      []string
	}{
		{"no overrides keeps the base", []string{"A=1", "B=2"}, nil, []string{"A=1", "B=2"}},
		{
			"an override replaces every inherited entry for its key",
			[]string{"WOOFX3_BARKLOADER_KEY=CHANGE_ME", "PATH=/bin", "WOOFX3_BARKLOADER_KEY=again"},
			map[string]string{"WOOFX3_BARKLOADER_KEY": "k"},
			[]string{"PATH=/bin", "WOOFX3_BARKLOADER_KEY=k"},
		},
		{
			"overrides are appended in key order",
			[]string{"PATH=/bin"},
			map[string]string{"WOOFX3_Z": "z", "WOOFX3_A": "a"},
			[]string{"PATH=/bin", "WOOFX3_A=a", "WOOFX3_Z=z"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := serviceEnvironment(tc.base, tc.overrides); !reflect.DeepEqual(got, tc.want) {
				t.Errorf("serviceEnvironment = %v, want %v", got, tc.want)
			}
		})
	}
}

// Without a data directory the secrets must land in data/, the tree the
// production image keeps on its volume, and copyLegacyData must carry them
// into a data directory set later, so neither recreating a container nor
// moving to WOOFX3_DATA_DIR changes them.
func TestResolveSecretsKeepsSecretsInPersistedState(t *testing.T) {
	workDir := t.TempDir()
	first, err := ResolveSecrets([]SecretSpec{barkloaderKeySpec}, woofx3config.Sources{}, engineStateDir(workDir, ""), fixedRandom(0x33), discardLogger())
	if err != nil {
		t.Fatalf("ResolveSecrets without a data dir: %v", err)
	}
	stored, err := os.ReadFile(filepath.Join(workDir, "data", "secrets", barkloaderKeySpec.Name))
	if err != nil {
		t.Fatalf("read secret under data/: %v", err)
	}
	if string(stored) != first["WOOFX3_BARKLOADER_KEY"] {
		t.Fatalf("stored secret = %q, want %q", stored, first["WOOFX3_BARKLOADER_KEY"])
	}

	dataDir := filepath.Join(t.TempDir(), "engine")
	if err := copyLegacyData(workDir, dataDir, discardLogger()); err != nil {
		t.Fatalf("copyLegacyData: %v", err)
	}
	second, err := ResolveSecrets([]SecretSpec{barkloaderKeySpec}, woofx3config.Sources{}, engineStateDir(workDir, dataDir), fixedRandom(0x44), discardLogger())
	if err != nil {
		t.Fatalf("ResolveSecrets with a data dir: %v", err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("secrets after moving to a data dir = %v, want %v", second, first)
	}
}
