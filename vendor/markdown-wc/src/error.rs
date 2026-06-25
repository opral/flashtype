#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarkdownWcError {
    pub message: String,
}

impl MarkdownWcError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for MarkdownWcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for MarkdownWcError {}
