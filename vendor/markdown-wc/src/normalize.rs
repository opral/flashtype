use crate::document::MarkdownDocument;
use serde_json::Value;
use unicode_normalization::{is_nfc, UnicodeNormalization};

pub fn normalize_document(document: &mut MarkdownDocument) {
    for block in &mut document.blocks {
        normalize_ast_json(block);
    }
}

pub fn normalize_ast_json(value: &mut Value) {
    match value {
        Value::Object(map) => {
            map.remove("position");
            for child in map.values_mut() {
                normalize_ast_json(child);
            }
        }
        Value::Array(items) => {
            for item in items {
                normalize_ast_json(item);
            }
        }
        Value::String(text) => {
            *text = normalize_text(text);
        }
        _ => {}
    }
}

fn normalize_text(input: &str) -> String {
    let normalized_newlines = input.replace("\r\n", "\n").replace('\r', "\n");
    if normalized_newlines.is_ascii() || is_nfc(&normalized_newlines) {
        return normalized_newlines;
    }
    normalized_newlines.nfc().collect()
}
