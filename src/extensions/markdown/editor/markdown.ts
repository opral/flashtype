import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfm } from "micromark-extension-gfm";
import { math } from "micromark-extension-math";

type AstRoot = {
	type: "root";
	children: any[];
};

export function parseMarkdown(markdown: string): AstRoot {
	return normalizeAst(
		resolveReferences(
			fromMarkdown(markdown, {
				extensions: [gfm(), frontmatter(["yaml"]), math()],
				mdastExtensions: [
					gfmFromMarkdown(),
					frontmatterFromMarkdown(["yaml"]),
					mathFromMarkdown(),
				],
			}),
		),
	);
}

function resolveReferences(ast: any): any {
	const definitions = new Map<string, any>();
	for (const child of Array.isArray(ast?.children) ? ast.children : []) {
		if (child?.type === "definition" && typeof child.identifier === "string") {
			definitions.set(normalizeIdentifier(child.identifier), child);
		}
	}

	const resolve = (node: any): any => {
		if (!node || typeof node !== "object") {
			return node;
		}
		if (Array.isArray(node)) {
			return node.map(resolve);
		}
		if (node.type === "definition") {
			return null;
		}

		const children = Array.isArray(node.children)
			? node.children.map(resolve).filter(Boolean)
			: undefined;
		if (node.type === "linkReference" && typeof node.identifier === "string") {
			const definition = definitions.get(normalizeIdentifier(node.identifier));
			if (definition) {
				return {
					type: "link",
					url: definition.url,
					title: definition.title ?? null,
					children: children ?? [],
				};
			}
		}
		if (node.type === "imageReference" && typeof node.identifier === "string") {
			const definition = definitions.get(normalizeIdentifier(node.identifier));
			if (definition) {
				return {
					type: "image",
					url: definition.url,
					title: definition.title ?? null,
					alt: node.alt ?? null,
				};
			}
		}

		return {
			...node,
			...(children ? { children } : {}),
		};
	};

	return resolve(ast);
}

function normalizeIdentifier(identifier: string): string {
	return identifier.toLowerCase();
}

export function serializeAst(ast: any): string {
	const children = Array.isArray(ast?.children)
		? ast.children.map(prepareTaskListMarkers)
		: [];
	const renderedBlocks = children
		.map(renderBlock)
		.filter((text: string) => text.length > 0);
	const output = renderedBlocks.join("\n\n");
	return output.length > 0 ? `${output}\n` : "";
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
	return asRoot(normalizeValue(ast));
}

function normalizeValue(value: any): any {
	if (value === undefined) {
		return null;
	}
	if (typeof value === "string") {
		return normalizeText(value);
	}
	if (Array.isArray(value)) {
		return value.map(normalizeValue);
	}
	if (!value || typeof value !== "object") {
		return value;
	}

	const out: Record<string, any> = {};
	for (const [key, child] of Object.entries(value)) {
		if (key === "position") continue;
		out[key] = normalizeValue(child);
	}
	return out;
}

function normalizeText(input: string): string {
	const normalizedNewlines = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	return isAscii(normalizedNewlines)
		? normalizedNewlines
		: normalizedNewlines.normalize("NFC");
}

function isAscii(input: string): boolean {
	for (let index = 0; index < input.length; index++) {
		if (input.charCodeAt(index) > 0x7f) return false;
	}
	return true;
}

function asRoot(ast: any): AstRoot {
	return {
		type: "root",
		children: Array.isArray(ast?.children) ? ast.children : [],
	};
}

function renderBlock(node: any): string {
	switch (nodeType(node)) {
		case "paragraph":
			return renderInlineChildren(node);
		case "heading": {
			const depth = clampInteger(node.depth, 1, 6, 1);
			return `${"#".repeat(depth)} ${renderInlineChildren(node)}`;
		}
		case "code": {
			const value = stringValue(node.value);
			const lang = stringValue(node.lang);
			const meta = stringValue(node.meta);
			const fence = fenceFor(value);
			if (!lang && !meta) {
				return `${fence}\n${value}\n${fence}`;
			}
			if (!meta) {
				return `${fence}${lang}\n${value}\n${fence}`;
			}
			return `${fence}${lang} ${meta}\n${value}\n${fence}`;
		}
		case "blockquote": {
			const children = arrayValue(node.children, "blockquote.children");
			return children
				.map(renderBlock)
				.map((child) =>
					child
						.split("\n")
						.map((line) => (line.length === 0 ? ">" : `> ${line}`))
						.join("\n"),
				)
				.join("\n>\n");
		}
		case "list":
			return renderList(node);
		case "thematicBreak":
			return "---";
		case "table":
			return renderTable(node);
		case "html":
			return stringValue(node.value);
		case "yaml":
			return `---\n${stringValue(node.value).replace(/^\n+|\n+$/g, "")}\n---`;
		default:
			throw new Error(`unsupported block node type '${nodeType(node)}'`);
	}
}

function renderList(node: any): string {
	const ordered = node.ordered === true;
	let number = typeof node.start === "number" ? node.start : 1;
	const items = arrayValue(node.children, "list.children");
	const lines: string[] = [];

	for (const item of items) {
		if (nodeType(item) !== "listItem") {
			throw new Error("list.children must contain listItem nodes");
		}
		const marker = ordered ? `${number++}. ` : "- ";
		const rendered = renderListItem(item);
		const [first = "", ...rest] = rendered.split("\n");
		lines.push(`${marker}${first}`);
		for (const line of rest) {
			lines.push(`  ${line}`);
		}
	}

	return lines.join("\n");
}

function renderListItem(node: any): string {
	const children = arrayValue(node.children, "listItem.children");
	if (children.length === 0) {
		return "";
	}
	return children
		.map((child) =>
			nodeType(child) === "paragraph"
				? renderInlineChildren(child)
				: renderBlock(child),
		)
		.join("\n");
}

function renderTable(node: any): string {
	const rows = arrayValue(node.children, "table.children");
	if (rows.length === 0) {
		return "";
	}

	const headerCells = tableCells(rows[0]);
	const header = `| ${headerCells.join(" | ")} |`;
	const separator = `| ${headerCells.map(() => "-").join(" | ")} |`;
	const body = rows.slice(1).map((row) => `| ${tableCells(row).join(" | ")} |`);
	return [header, separator, ...body].join("\n");
}

function tableCells(row: any): string[] {
	if (nodeType(row) !== "tableRow") {
		throw new Error("table.children must contain tableRow nodes");
	}
	return arrayValue(row.children, "tableRow.children").map((cell) => {
		if (nodeType(cell) !== "tableCell") {
			throw new Error("tableRow.children must contain tableCell nodes");
		}
		return renderInlineChildren(cell);
	});
}

function renderInlineChildren(node: any): string {
	const children = Array.isArray(node?.children) ? node.children : [];
	return children.map(renderInline).join("");
}

function renderInline(node: any): string {
	switch (nodeType(node)) {
		case "text":
			return stringValue(node.value);
		case "emphasis":
			return `_${renderInlineChildren(node)}_`;
		case "strong":
			return `**${renderInlineChildren(node)}**`;
		case "delete":
			return `~~${renderInlineChildren(node)}~~`;
		case "inlineCode":
			return renderInlineCode(stringValue(node.value));
		case "link": {
			const label = renderInlineChildren(node);
			const url = stringValue(node.url);
			const title = stringValue(node.title);
			return title ? `[${label}](${url} "${title}")` : `[${label}](${url})`;
		}
		case "image": {
			const alt = stringValue(node.alt);
			const url = stringValue(node.url);
			const title = stringValue(node.title);
			return title ? `![${alt}](${url} "${title}")` : `![${alt}](${url})`;
		}
		case "break":
			return "\\\n";
		case "html":
			return stringValue(node.value);
		default:
			throw new Error(`unsupported inline node type '${nodeType(node)}'`);
	}
}

function renderInlineCode(value: string): string {
	let fenceSize = 1;
	while (value.includes("`".repeat(fenceSize))) {
		fenceSize += 1;
	}
	const fence = "`".repeat(fenceSize);
	return `${fence}${value}${fence}`;
}

function fenceFor(value: string): string {
	let fenceSize = 3;
	while (value.includes("`".repeat(fenceSize))) {
		fenceSize += 1;
	}
	return "`".repeat(fenceSize);
}

function nodeType(node: any): string {
	if (typeof node?.type !== "string") {
		throw new Error("AST node is missing string field 'type'");
	}
	return node.type;
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function arrayValue(value: unknown, name: string): any[] {
	if (!Array.isArray(value)) {
		throw new Error(`${name} must be an array`);
	}
	return value;
}

function clampInteger(
	value: unknown,
	min: number,
	max: number,
	fallback: number,
): number {
	const number = typeof value === "number" ? Math.trunc(value) : fallback;
	return Math.min(max, Math.max(min, number));
}
