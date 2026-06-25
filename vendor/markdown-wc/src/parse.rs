use crate::document::{LineEnding, MarkdownDocument, MarkdownSourceMeta};
use crate::error::MarkdownWcError;
use markdown::mdast::Node;
use markdown::{to_mdast, ParseOptions};

pub fn parse_markdown_bytes(bytes: &[u8]) -> Result<MarkdownDocument, MarkdownWcError> {
    let markdown = std::str::from_utf8(bytes).map_err(|error| {
        MarkdownWcError::new(format!("markdown input must be valid UTF-8 bytes: {error}"))
    })?;
    parse_markdown(markdown)
}

pub fn parse_markdown(markdown: &str) -> Result<MarkdownDocument, MarkdownWcError> {
    let tree = to_mdast(markdown, &parse_options_all_extensions())
        .map_err(|error| MarkdownWcError::new(format!("markdown parse failed: {error}")))?;

    let root = match tree {
        Node::Root(root) => root,
        _ => {
            return Err(MarkdownWcError::new(
                "markdown parser returned non-root AST node",
            ));
        }
    };

    let mut blocks = Vec::with_capacity(root.children.len());
    for node in root.children {
        let value = serde_json::to_value(node).map_err(|error| {
            MarkdownWcError::new(format!("failed to serialize AST node: {error}"))
        })?;
        blocks.push(value);
    }

    Ok(MarkdownDocument {
        blocks,
        source: MarkdownSourceMeta {
            had_trailing_newline: markdown.ends_with('\n') || markdown.ends_with('\r'),
            line_ending: detect_line_ending(markdown),
        },
    })
}

fn parse_options_all_extensions() -> ParseOptions {
    let mut options = ParseOptions::gfm();
    let constructs = &mut options.constructs;
    constructs.frontmatter = true;
    constructs.gfm_autolink_literal = true;
    constructs.gfm_footnote_definition = true;
    constructs.gfm_label_start_footnote = true;
    constructs.gfm_strikethrough = true;
    constructs.gfm_table = true;
    constructs.gfm_task_list_item = true;
    constructs.math_flow = true;
    constructs.math_text = true;
    options
}

fn detect_line_ending(markdown: &str) -> LineEnding {
    let bytes = markdown.as_bytes();
    let mut lf_count = 0usize;
    let mut crlf_count = 0usize;
    let mut standalone_cr = false;
    let mut index = 0usize;

    while index < bytes.len() {
        match bytes[index] {
            b'\r' => {
                if index + 1 < bytes.len() && bytes[index + 1] == b'\n' {
                    crlf_count += 1;
                    lf_count += 1;
                    index += 2;
                } else {
                    standalone_cr = true;
                    index += 1;
                }
            }
            b'\n' => {
                lf_count += 1;
                index += 1;
            }
            _ => {
                index += 1;
            }
        }
    }

    if lf_count == 0 && !standalone_cr {
        return LineEnding::None;
    }
    if standalone_cr {
        return LineEnding::Mixed;
    }
    if crlf_count == 0 {
        return LineEnding::Lf;
    }
    if lf_count == crlf_count {
        return LineEnding::Crlf;
    }
    LineEnding::Mixed
}
