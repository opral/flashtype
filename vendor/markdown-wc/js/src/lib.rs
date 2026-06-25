use markdown_wc::{
    normalize_ast_json as core_normalize_ast_json, normalize_document as core_normalize_document,
    parse_markdown as core_parse_markdown, parse_markdown_bytes as core_parse_markdown_bytes,
    serialize_markdown as core_serialize_markdown, MarkdownDocument,
};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use serde_wasm_bindgen::Serializer;
use wasm_bindgen::prelude::*;

fn to_js_value<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    value
        .serialize(&Serializer::json_compatible())
        .map_err(|error| JsValue::from_str(&format!("failed to serialize value for JS: {error}")))
}

fn from_js_value<T: DeserializeOwned>(value: JsValue, type_name: &str) -> Result<T, JsValue> {
    serde_wasm_bindgen::from_value(value)
        .map_err(|error| JsValue::from_str(&format!("invalid {type_name} value: {error}")))
}

#[wasm_bindgen]
pub fn parse_markdown(markdown: &str) -> Result<JsValue, JsValue> {
    let document =
        core_parse_markdown(markdown).map_err(|error| JsValue::from_str(&error.to_string()))?;
    to_js_value(&document)
}

#[wasm_bindgen]
pub fn parse_markdown_bytes(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let document =
        core_parse_markdown_bytes(bytes).map_err(|error| JsValue::from_str(&error.to_string()))?;
    to_js_value(&document)
}

#[wasm_bindgen]
pub fn normalize_document(document: JsValue) -> Result<JsValue, JsValue> {
    let mut parsed: MarkdownDocument = from_js_value(document, "MarkdownDocument")?;
    core_normalize_document(&mut parsed);
    to_js_value(&parsed)
}

#[wasm_bindgen]
pub fn normalize_ast_json(ast: JsValue) -> Result<JsValue, JsValue> {
    let mut value: Value = from_js_value(ast, "JSON AST")?;
    core_normalize_ast_json(&mut value);
    to_js_value(&value)
}

#[wasm_bindgen]
pub fn serialize_markdown(document: JsValue) -> Result<String, JsValue> {
    let parsed: MarkdownDocument = from_js_value(document, "MarkdownDocument")?;
    core_serialize_markdown(&parsed).map_err(|error| JsValue::from_str(&error.to_string()))
}
