use crate::document::{LineEnding, MarkdownDocument};
use crate::error::MarkdownWcError;

pub fn serialize_markdown(document: &MarkdownDocument) -> Result<String, MarkdownWcError> {
    let mut rendered_blocks = Vec::with_capacity(document.blocks.len());
    for block in &document.blocks {
        let text = render_block(block)?;
        if text.is_empty() {
            continue;
        }
        rendered_blocks.push(text);
    }

    let mut output = rendered_blocks.join("\n\n");
    if output.is_empty() {
        return Ok(output);
    }

    if document.source.had_trailing_newline {
        output.push('\n');
    }

    output = match document.source.line_ending {
        LineEnding::Crlf => output.replace('\n', "\r\n"),
        _ => output,
    };

    Ok(output)
}

fn render_block(node: &serde_json::Value) -> Result<String, MarkdownWcError> {
    match node_type(node)? {
        "paragraph" => render_inline_children(node),
        "heading" => {
            let depth = node
                .get("depth")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(1)
                .clamp(1, 6) as usize;
            let prefix = "#".repeat(depth);
            Ok(format!("{prefix} {}", render_inline_children(node)?))
        }
        "code" => {
            let value = node
                .get("value")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let lang = node
                .get("lang")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let meta = node
                .get("meta")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let fence = fence_for(value);
            if lang.is_empty() && meta.is_empty() {
                Ok(format!("{fence}\n{value}\n{fence}"))
            } else if meta.is_empty() {
                Ok(format!("{fence}{lang}\n{value}\n{fence}"))
            } else {
                Ok(format!("{fence}{lang} {meta}\n{value}\n{fence}"))
            }
        }
        "blockquote" => {
            let children = node
                .get("children")
                .and_then(serde_json::Value::as_array)
                .ok_or_else(|| MarkdownWcError::new("blockquote.children must be an array"))?;
            let mut parts = Vec::new();
            for child in children {
                let child_rendered = render_block(child)?;
                let prefixed = child_rendered
                    .lines()
                    .map(|line| {
                        if line.is_empty() {
                            ">".to_string()
                        } else {
                            format!("> {line}")
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                parts.push(prefixed);
            }
            Ok(parts.join("\n>\n"))
        }
        "list" => render_list(node),
        "thematicBreak" => Ok("---".to_string()),
        "table" => render_table(node),
        "html" => Ok(node
            .get("value")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_string()),
        "yaml" => {
            let value = node
                .get("value")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .trim_matches('\n')
                .to_string();
            Ok(format!("---\n{value}\n---"))
        }
        other => Err(MarkdownWcError::new(format!(
            "unsupported block node type '{other}'"
        ))),
    }
}

fn render_list(node: &serde_json::Value) -> Result<String, MarkdownWcError> {
    let ordered = node
        .get("ordered")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let mut number = node
        .get("start")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(1);

    let items = node
        .get("children")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| MarkdownWcError::new("list.children must be an array"))?;

    let mut out = Vec::new();
    for item in items {
        if node_type(item)? != "listItem" {
            return Err(MarkdownWcError::new(
                "list.children must contain listItem nodes",
            ));
        }

        let marker = if ordered {
            let m = format!("{number}. ");
            number += 1;
            m
        } else {
            "- ".to_string()
        };

        let rendered = render_list_item(item)?;
        let mut lines = rendered.lines();
        let first = lines.next().unwrap_or("");
        out.push(format!("{marker}{first}"));
        for line in lines {
            out.push(format!("  {line}"));
        }
    }

    Ok(out.join("\n"))
}

fn render_list_item(node: &serde_json::Value) -> Result<String, MarkdownWcError> {
    let children = node
        .get("children")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| MarkdownWcError::new("listItem.children must be an array"))?;

    if children.is_empty() {
        return Ok(String::new());
    }

    let mut rendered = Vec::new();
    for child in children {
        let child_text = if node_type(child)? == "paragraph" {
            render_inline_children(child)?
        } else {
            render_block(child)?
        };
        rendered.push(child_text);
    }

    Ok(rendered.join("\n"))
}

fn render_table(node: &serde_json::Value) -> Result<String, MarkdownWcError> {
    let rows = node
        .get("children")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| MarkdownWcError::new("table.children must be an array"))?;

    if rows.is_empty() {
        return Ok(String::new());
    }

    let header_cells = table_cells(&rows[0])?;
    let header = format!("| {} |", header_cells.join(" | "));
    let separator = format!(
        "| {} |",
        header_cells
            .iter()
            .map(|_| "-")
            .collect::<Vec<_>>()
            .join(" | ")
    );

    let mut lines = vec![header, separator];
    for row in rows.iter().skip(1) {
        let cells = table_cells(row)?;
        lines.push(format!("| {} |", cells.join(" | ")));
    }

    Ok(lines.join("\n"))
}

fn table_cells(row: &serde_json::Value) -> Result<Vec<String>, MarkdownWcError> {
    if node_type(row)? != "tableRow" {
        return Err(MarkdownWcError::new(
            "table.children must contain tableRow nodes",
        ));
    }

    let cells = row
        .get("children")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| MarkdownWcError::new("tableRow.children must be an array"))?;

    let mut out = Vec::new();
    for cell in cells {
        if node_type(cell)? != "tableCell" {
            return Err(MarkdownWcError::new(
                "tableRow.children must contain tableCell nodes",
            ));
        }
        out.push(render_inline_children(cell)?);
    }
    Ok(out)
}

fn render_inline_children(node: &serde_json::Value) -> Result<String, MarkdownWcError> {
    let empty = Vec::new();
    let children = node
        .get("children")
        .and_then(serde_json::Value::as_array)
        .unwrap_or(&empty);
    let mut out = String::new();
    for child in children {
        out.push_str(&render_inline(child)?);
    }
    Ok(out)
}

fn render_inline(node: &serde_json::Value) -> Result<String, MarkdownWcError> {
    match node_type(node)? {
        "text" => Ok(node
            .get("value")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_string()),
        "emphasis" => Ok(format!("_{}_", render_inline_children(node)?)),
        "strong" => Ok(format!("**{}**", render_inline_children(node)?)),
        "delete" => Ok(format!("~~{}~~", render_inline_children(node)?)),
        "inlineCode" => {
            let value = node
                .get("value")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            Ok(render_inline_code(value))
        }
        "link" => {
            let label = render_inline_children(node)?;
            let url = node
                .get("url")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let title = node
                .get("title")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            if title.is_empty() {
                Ok(format!("[{label}]({url})"))
            } else {
                Ok(format!("[{label}]({url} \"{title}\")"))
            }
        }
        "image" => {
            let alt = node
                .get("alt")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let url = node
                .get("url")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let title = node
                .get("title")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            if title.is_empty() {
                Ok(format!("![{alt}]({url})"))
            } else {
                Ok(format!("![{alt}]({url} \"{title}\")"))
            }
        }
        "break" => Ok("\\\n".to_string()),
        "html" => Ok(node
            .get("value")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_string()),
        other => Err(MarkdownWcError::new(format!(
            "unsupported inline node type '{other}'"
        ))),
    }
}

fn render_inline_code(value: &str) -> String {
    let mut fence_size = 1usize;
    while value.contains(&"`".repeat(fence_size)) {
        fence_size += 1;
    }
    let fence = "`".repeat(fence_size);
    format!("{fence}{value}{fence}")
}

fn fence_for(value: &str) -> String {
    let mut fence_size = 3usize;
    while value.contains(&"`".repeat(fence_size)) {
        fence_size += 1;
    }
    "`".repeat(fence_size)
}

fn node_type(node: &serde_json::Value) -> Result<&str, MarkdownWcError> {
    node.get("type")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| MarkdownWcError::new("AST node is missing string field 'type'"))
}
