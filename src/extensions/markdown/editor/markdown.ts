import { fromMarkdown } from "mdast-util-from-markdown";
import {
	frontmatterFromMarkdown,
	frontmatterToMarkdown,
} from "mdast-util-frontmatter";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { defaultHandlers, toMarkdown } from "mdast-util-to-markdown";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfm } from "micromark-extension-gfm";

type AstRoot = {
	type: "root";
	children: any[];
};

export function parseMarkdown(markdown: string): AstRoot {
	return normalizeAst(
		resolveReferences(
			fromMarkdown(markdown, {
				extensions: [gfm(), frontmatter(["yaml"])],
				mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(["yaml"])],
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
	return normalizeSerializedMarkdown(
		toMarkdown(prepareAstForMarkdown(ast), {
			extensions: [
				gfmToMarkdown(),
				taskListItemToMarkdown(),
				frontmatterToMarkdown(["yaml"]),
			],
			bullet: "-",
			listItemIndent: "one",
			rule: "-",
			ruleRepetition: 3,
			ruleSpaces: false,
			emphasis: "_",
			strong: "*",
			fence: "`",
			fences: true,
		}),
	);
}

function taskListItemToMarkdown(): any {
	return {
		handlers: {
			listItem: taskListItemWithEmptyMarker,
		},
	};
}

function taskListItemWithEmptyMarker(
	node: any,
	parent: any,
	state: any,
	info: any,
): string {
	const checkable = typeof node.checked === "boolean";
	if (!checkable) {
		return defaultHandlers.listItem(node, parent, state, info);
	}

	const checkbox = `[${node.checked ? "x" : " "}] `;
	const tracker = state.createTracker(info);
	tracker.move(checkbox);
	const value = defaultHandlers.listItem(node, parent, state, {
		...info,
		...tracker.current(),
	});
	const marked = value.replace(
		/^((?:[*+-]|\d+\.)(?:[\r\n]| {1,3}))/,
		`$1${checkbox}`,
	);
	return marked === value
		? value.replace(/^([*+-]|\d+\.)$/, `$1 ${checkbox}`)
		: marked;
}

function prepareAstForMarkdown(value: any): any {
	if (Array.isArray(value)) {
		return value.map(prepareAstForMarkdown);
	}
	if (!value || typeof value !== "object") {
		return value;
	}

	const out: Record<string, any> = {};
	for (const [key, child] of Object.entries(value)) {
		out[key] = prepareAstForMarkdown(child);
	}
	if (
		(out.type === "list" || out.type === "listItem") &&
		typeof out.spread !== "boolean"
	) {
		out.spread = false;
	}
	if (isInlineContainer(out) && Array.isArray(out.children)) {
		out.children = trimInlineBoundaryWhitespace(out.children);
	}
	return out;
}

function isInlineContainer(node: Record<string, any>): boolean {
	return (
		node.type === "paragraph" ||
		node.type === "heading" ||
		node.type === "tableCell"
	);
}

function trimInlineBoundaryWhitespace(children: any[]): any[] {
	const out = [...children];
	trimInlineStart(out);
	trimInlineEnd(out);
	return out.filter((child) => !isEmptyInline(child));
}

function trimInlineStart(children: any[]): void {
	for (const child of children) {
		if (trimInlineNodeStart(child)) return;
	}
}

function trimInlineEnd(children: any[]): void {
	for (let index = children.length - 1; index >= 0; index -= 1) {
		if (trimInlineNodeEnd(children[index])) return;
	}
}

function trimInlineNodeStart(node: any): boolean {
	if (!node || typeof node !== "object") return true;
	if (node.type === "text") {
		node.value =
			typeof node.value === "string" ? node.value.replace(/^[\t ]+/g, "") : "";
		return node.value.length > 0;
	}
	if (canTrimInlineChildren(node)) {
		trimInlineStart(node.children);
		return !isEmptyInline(node);
	}
	return true;
}

function trimInlineNodeEnd(node: any): boolean {
	if (!node || typeof node !== "object") return true;
	if (node.type === "text") {
		node.value =
			typeof node.value === "string" ? node.value.replace(/[\t ]+$/g, "") : "";
		return node.value.length > 0;
	}
	if (canTrimInlineChildren(node)) {
		trimInlineEnd(node.children);
		return !isEmptyInline(node);
	}
	return true;
}

function canTrimInlineChildren(node: any): boolean {
	return (
		(node.type === "emphasis" ||
			node.type === "strong" ||
			node.type === "delete" ||
			node.type === "link") &&
		Array.isArray(node.children)
	);
}

function isEmptyInline(node: any): boolean {
	if (!node || typeof node !== "object") return false;
	if (node.type === "text") return !node.value;
	if (canTrimInlineChildren(node)) return node.children.every(isEmptyInline);
	return false;
}

function normalizeSerializedMarkdown(markdown: string): string {
	const normalized = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const withoutTrailingNewlines = normalized.replace(/\n+$/g, "");
	return withoutTrailingNewlines.length > 0
		? `${withoutTrailingNewlines}\n`
		: "";
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
