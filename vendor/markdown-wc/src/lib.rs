mod document;
mod error;
mod normalize;
mod parse;
mod serialize;

pub use document::{LineEnding, MarkdownDocument, MarkdownSourceMeta};
pub use error::MarkdownWcError;
pub use normalize::{normalize_ast_json, normalize_document};
pub use parse::{parse_markdown, parse_markdown_bytes};
pub use serialize::serialize_markdown;
