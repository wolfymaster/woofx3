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
        Self {
            name,
            file_name,
            code,
            is_trusted,
            entry_point: None,
        }
    }

    pub fn get_extension(&self) -> Option<String> {
        Path::new(&self.file_name)
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_string())
    }

    pub fn resolved_entry_point(&self) -> &str {
        self.entry_point.as_deref().unwrap_or("main")
    }
}
