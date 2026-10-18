package runtime

import (
	"strings"

	"github.com/wolfymaster/woofx3/common/config"
)

// LoadRuntimeEnvOptions configures where to load from. The loader never writes to the process environment.
type LoadRuntimeEnvOptions struct {
	// RootDir, if not blank, is the directory for .env and the config file, and WOOFX3_ROOT and
	// WOOFX3_CONFIG are ignored. See config.ResolveLocation.
	RootDir string
}

// ConfigFileEnv names an explicit config file, which must exist. See config.ConfigFileEnv.
const ConfigFileEnv = config.ConfigFileEnv

// RootDirEnv names the config root directory. See config.RootDirEnv.
const RootDirEnv = config.RootDirEnv

// LoadRuntimeEnv resolves configuration from the config file, .env and the process environment,
// keyed as WOOFX3_* variables. Precedence, highest first: the process environment, then .env, then
// the config file -- a deployment configures by variables, so a value baked into the file must
// never beat one the host set. A blank value never masks a non-blank one from a lower source; a
// key blank everywhere still resolves, to blank. See config.ResolveLocation for where the files
// are found.
func LoadRuntimeEnv(options *LoadRuntimeEnvOptions) (map[string]string, error) {
	rootDir := ""
	if options != nil {
		rootDir = options.RootDir
	}
	return config.Load(config.ResolveLocation(rootDir))
}

func ValidateRequiredEnv(env map[string]string, required []string) []string {
	var missing []string
	for _, key := range required {
		v := env[key]
		if strings.TrimSpace(v) == "" {
			missing = append(missing, key)
		}
	}
	return missing
}

func camelToScreamingSnake(s string) string {
	return config.CamelToScreamingSnake(s)
}
