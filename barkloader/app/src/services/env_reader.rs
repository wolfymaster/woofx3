use lib_sandbox::host::EnvReader;

pub struct OsEnvReader;

impl EnvReader for OsEnvReader {
    fn get(&self, key: &str) -> Option<String> {
        std::env::var(key).ok()
    }
}
