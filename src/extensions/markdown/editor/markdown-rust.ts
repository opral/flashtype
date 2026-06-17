import {
	normalize_ast_json,
	parse_markdown,
	serialize_markdown,
} from "@markdown-wc/wasm";

type LineEnding = "None" | "Lf" | "Crlf" | "Mixed";

type MarkdownDocument = {
	blocks: any[];
	source: {
		had_trailing_newline: boolean;
		line_ending: LineEnding;
	};
};

type AstRoot = {
	type: "root";
	children: any[];
};

const DEFAULT_SOURCE_META: MarkdownDocument["source"] = {
	had_trailing_newline: true,
	line_ending: "Lf",
};

export function parseMarkdown(markdown: string): AstRoot {
	const document = parse_markdown(markdown) as MarkdownDocument;
	return {
		type: "root",
		children: Array.isArray(document?.blocks) ? document.blocks : [],
	};
}

export function serializeAst(ast: any): string {
	const children = Array.isArray(ast?.children)
		? ast.children.map(prepareTaskListMarkers)
		: [];
	return serialize_markdown({
		blocks: children,
		source: DEFAULT_SOURCE_META,
	} satisfies MarkdownDocument);
}

function prepareTaskListMarkers(node: any): any {
	if (!node || typeof node !== "object") {
		return node;
	}
	if (Array.isArray(node)) {
		return node.map(prepareTaskListMarkers);
	}

	const out: Record<string, any> = { ...node };
	if (Array.isArray(node.children)) {
		out.children = node.children.map(prepareTaskListMarkers);
	}

	if (
		node.type !== "listItem" ||
		!(node.checked === true || node.checked === false)
	) {
		return out;
	}

	const marker = node.checked ? "[x] " : "[ ] ";
	const children = Array.isArray(out.children) ? [...out.children] : [];
	const first = children[0];
	if (first?.type === "paragraph") {
		const paragraphChildren = Array.isArray(first.children)
			? [...first.children]
			: [];
		children[0] = {
			...first,
			children: [{ type: "text", value: marker }, ...paragraphChildren],
		};
	} else {
		children.unshift({
			type: "paragraph",
			children: [{ type: "text", value: marker }],
		});
	}
	out.children = children;
	return out;
}

export function normalizeAst(ast: any): AstRoot {
	const normalized = normalize_ast_json(ast) as AstRoot;
	return {
		type: "root",
		children: Array.isArray(normalized?.children) ? normalized.children : [],
	};
}
