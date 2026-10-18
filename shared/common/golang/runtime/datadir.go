package runtime

import "github.com/wolfymaster/woofx3/common/config"

// DataDirEnv names the engine's data directory. See config.DataDirEnv.
const DataDirEnv = config.DataDirEnv

// DataDir returns the absolute data directory, or "" when WOOFX3_DATA_DIR is
// unset or blank.
func DataDir() string {
	return config.DataDir()
}

// ResolveDataPath anchors a relative path in the data directory. See
// config.ResolveDataPath.
func ResolveDataPath(path string) string {
	return config.ResolveDataPath(path)
}
