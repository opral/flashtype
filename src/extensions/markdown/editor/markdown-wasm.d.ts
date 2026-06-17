declare module "@markdown-wc/wasm" {
	export function parse_markdown(markdown: string): any;
	export function parse_markdown_bytes(bytes: Uint8Array): any;
	export function normalize_document(document: any): any;
	export function normalize_ast_json(ast: any): any;
	export function serialize_markdown(document: any): string;
}
