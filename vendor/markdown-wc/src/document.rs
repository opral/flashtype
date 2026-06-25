use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum LineEnding {
    #[default]
    None,
    Lf,
    Crlf,
    Mixed,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarkdownSourceMeta {
    pub had_trailing_newline: bool,
    pub line_ending: LineEnding,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct MarkdownDocument {
    pub blocks: Vec<Value>,
    pub source: MarkdownSourceMeta,
}
