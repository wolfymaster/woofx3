use std::path::Path;

#[derive(Debug, Clone)]
pub struct Function {
    pub name: String,
    pub file_name: String,
    pub code: String,
    pub is_trusted: bool,
    pub entry_point: Option<String>,
}

impl Function {
    pub fn new(name: String, file_name: String, code: String, is_trusted: bool) -> Self {
        Self::new_with_entry_point(name, file_name, code, is_trusted, None)
    }

    pub fn new_with_entry_point(
        name: String,
        file_name: String,
        code: String,
        is_trusted: bool,
        entry_point: Option<String>,
    ) -> Self {
        Self {
            name,
            file_name,
            code,
            is_trusted,
            entry_point: entry_point.filter(|s| !s.is_empty()),
        }
    }

    pub fn get_extension(&self) -> Option<String> {
        Path::new(&self.file_name)
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_string())
    }

    pub fn resolved_entry_point(&self) -> &str {
        if let Some(ep) = self.entry_point.as_deref() {
            if !ep.is_empty() {
                return ep;
            }
        }
        // Sandbox module files conventionally export a function named
        // after the manifest id / file stem (`increment`, `sendChatMessage`).
        if !self.name.is_empty() {
            return &self.name;
        }
        "main"
    }
}
