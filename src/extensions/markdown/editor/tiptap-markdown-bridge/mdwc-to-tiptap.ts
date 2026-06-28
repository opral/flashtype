// Avoid tight compile-time coupling to mdast types; operate on structural shape

const SPREAD_META_KEY = "__mdwc_spread";
export const EMPTY_MARKDOWN_SCAFFOLD_DATA_KEY = "__flashtype_empty_scaffold";
export const EMPTY_MARKDOWN_PARAGRAPH_DATA_KEY =
	"__flashtype_empty_paragraph";

export type PMMark = {
	type: "bold" | "italic" | "strike" | "code" | "link";
	attrs?: Record<string, any>;
};
export type PMNode = {
	type: string;
	attrs?: Record<string, any>;
	content?: PMNode[];
	text?: string;
	marks?: PMMark[];
};

export type EmptyMarkdownDefaultBlock = "paragraph" | "heading1";

export function astToTiptapDoc(
	ast: any,
	options: { defaultBlock?: EmptyMarkdownDefaultBlock } = {},
): PMNode {
	const children = Array.isArray(ast?.children)
		? ast.children.map(astBlockToPM)
		: [];
	return {
		type: "doc",
		content:
			children.length > 0
				? children
				: [emptyDefaultBlockToPM(options.defaultBlock ?? "paragraph")],
	};
}

function emptyDefaultBlockToPM(
	defaultBlock: EmptyMarkdownDefaultBlock,
): PMNode {
	if (defaultBlock === "heading1") {
		return {
			type: "heading",
			attrs: {
				level: 1,
				data: { [EMPTY_MARKDOWN_SCAFFOLD_DATA_KEY]: true },
			},
		};
	}
	return { type: "paragraph", attrs: { data: {} } };
}

function astBlockToPM(node: any): PMNode {
	switch (node.type) {
		case "paragraph":
			const paragraphData = buildNodeData((node as any).data);
			const paragraphChildren = (node as any).children || [];
			const isEmptyPlaceholder =
				isEmptyParagraphPlaceholder(paragraphChildren);
			const inlineChildren = isHardBreakOnlyParagraphPlaceholder(
				paragraphChildren,
			)
				? paragraphChildren.slice(2)
				: paragraphChildren;
			return {
				type: "paragraph",
				attrs: {
					data: buildNodeData(paragraphData, {
						[EMPTY_MARKDOWN_PARAGRAPH_DATA_KEY]: isEmptyPlaceholder
							? true
							: undefined,
					}),
				},
				content: isEmptyPlaceholder
					? []
					: flattenInline(inlineChildren, []),
			};
		case "heading":
			const headingData = buildNodeData((node as any).data);
			return {
				type: "heading",
				attrs: { level: (node as any).depth, data: headingData },
				content: flattenInline((node as any).children || [], []),
			};
		case "list": {
			const n = node as any;
			const type = n.ordered ? "orderedList" : "bulletList";
			let attrs: any = {
				data: buildNodeData(n.data, {
					[SPREAD_META_KEY]:
						typeof n.spread === "boolean" ? n.spread : undefined,
				}),
			};
			if (n.ordered && n.start != null && n.start !== 1)
				attrs = { ...attrs, start: n.start };

			// Mark bullet lists as task lists if any item has checked set
			if (!n.ordered) {
				const hasTask = Array.isArray(n.children)
					? n.children.some(
							(li: any) => li && (li.checked === true || li.checked === false),
						)
					: false;
				attrs = { ...(attrs || {}), isTaskList: hasTask };
			}

			return { type, attrs, content: (n.children || []).map(astBlockToPM) };
		}
		case "listItem": {
			const n = node as any;
			const hasChecked = n.checked === true || n.checked === false;
			const attrs = {
				data: buildNodeData(n.data, {
					[SPREAD_META_KEY]:
						typeof n.spread === "boolean" ? n.spread : undefined,
				}),
				...(hasChecked ? { checked: n.checked } : {}),
			};
			return {
				type: "listItem",
				attrs,
				content: (n.children || []).map(astBlockToPM),
			};
		}
		case "blockquote": {
			const n = node as any;
			return {
				type: "blockquote",
				attrs: { data: buildNodeData(n.data) },
				content: (n.children || []).map(astBlockToPM),
			};
		}
		case "code": {
			const n = node as any;
			return {
				type: "codeBlock",
				attrs: { language: n.lang ?? null, data: buildNodeData(n.data) },
				content: textContent(n.value || ""),
			};
		}
		case "html": {
			const n = node as any;
			return {
				type: "markdownUnsupported",
				attrs: {
					kind: "html",
					value: n.value ?? "",
					data: buildNodeData(n.data),
				},
			};
		}
		case "yaml": {
			const n = node as any;
			return {
				type: "markdownUnsupported",
				attrs: {
					kind: "yaml",
					value: n.value ?? "",
					data: buildNodeData(n.data),
				},
			};
		}
		case "thematicBreak": {
			const hrData = buildNodeData((node as any).data);
			return { type: "horizontalRule", attrs: { data: hrData } };
		}
		case "table": {
			const n = node as any;
			return {
				type: "table",
				attrs: {
					align: Array.isArray(n.align) ? n.align : [],
					data: buildNodeData(n.data),
				},
				content: (n.children || []).map(astBlockToPM),
			};
		}
		case "tableRow": {
			const n = node as any;
			return {
				type: "tableRow",
				attrs: { data: buildNodeData(n.data) },
				content: (n.children || []).map(astBlockToPM),
			};
		}
		case "tableCell": {
			const n = node as any;
			return {
				type: "tableCell",
				attrs: { data: buildNodeData(n.data) },
				content: flattenInline((n.children || []) as any, []),
			};
		}
		default:
			// Fallback: paragraph of inline content if present
			// @ts-ignore
			if ((node as any).children)
				return {
					type: "paragraph",
					attrs: { data: buildNodeData((node as any).data) },
					content: flattenInline((node as any).children, []),
				};
			return {
				type: "paragraph",
				attrs: { data: buildNodeData((node as any).data) },
				content: textContent(""),
			};
	}
}

function isEmptyParagraphPlaceholder(children: any[]): boolean {
	return (
		children.length === 2 &&
		children[0]?.type === "html" &&
		children[0]?.value === "<span>" &&
		children[1]?.type === "html" &&
		children[1]?.value === "</span>"
	);
}

function isHardBreakOnlyParagraphPlaceholder(children: any[]): boolean {
	return (
		children.length > 2 &&
		children[0]?.type === "html" &&
		children[0]?.value === "<span>" &&
		children[1]?.type === "html" &&
		children[1]?.value === "</span>" &&
		children.slice(2).every(isHtmlHardBreak)
	);
}

function isHtmlHardBreak(node: any): boolean {
	return (
		node?.type === "html" &&
		typeof node.value === "string" &&
		/^<br\s*\/?>$/i.test(node.value)
	);
}

function buildNodeData(
	data: Record<string, any> | null | undefined,
	extras?: Record<string, unknown>,
): Record<string, any> | null {
	const base = data && typeof data === "object" ? { ...data } : {};
	if (extras) {
		for (const [key, value] of Object.entries(extras)) {
			if (value === undefined) continue;
			base[key] = value;
		}
	}
	return Object.keys(base).length > 0 ? base : null;
}

function textContent(str: string): PMNode[] {
	return str ? [{ type: "text", text: str }] : [];
}

function flattenInline(nodes: any[], active: PMMark[]): PMNode[] {
	const out: PMNode[] = [];
	for (const n of nodes) {
		switch (n.type) {
			case "text": {
				const t = (n as any).value;
				if (t)
					out.push({
						type: "text",
						text: t,
						marks: active.length ? [...active] : undefined,
					});
				break;
			}
			case "emphasis":
				out.push(
					...flattenInline(
						(n as any).children || [],
						addMark(active, { type: "italic" }),
					),
				);
				break;
			case "strong":
				out.push(
					...flattenInline(
						(n as any).children || [],
						addMark(active, { type: "bold" }),
					),
				);
				break;
			case "delete":
				out.push(
					...flattenInline(
						(n as any).children || [],
						addMark(active, { type: "strike" }),
					),
				);
				break;
			case "inlineCode":
				out.push({
					type: "text",
					text: (n as any).value || "",
					marks: addMark(active, { type: "code" }),
				});
				break;
			case "link": {
				const ln = n as any;
				const href = ln.url || null;
				const title = ln.title ?? null;
				out.push(
					...flattenInline(
						(ln.children || []) as any,
						addMark(active, {
							type: "link",
							attrs: { href, title, data: ln.data ?? null },
						}),
					),
				);
				break;
			}
			case "image": {
				const im = n as any;
				const src = im.url || null;
				const title = im.title ?? null;
				const alt = im.alt ?? null;
				out.push({
					type: "image",
					attrs: { src, title, alt, data: im.data ?? null },
				} as any);
				break;
			}
			case "break":
				out.push({
					type: "hardBreak",
					attrs: { data: (n as any).data ?? null } as any,
				});
				break;
			case "html": {
				const html = n as any;
				if (isHtmlHardBreak(html)) {
					out.push({
						type: "hardBreak",
						attrs: { data: html.data ?? null } as any,
					});
					break;
				}
				out.push({
					type: "markdownInlineHtml",
					attrs: { value: html.value ?? "", data: html.data ?? null },
				});
				break;
			}
			default:
				// ignore unsupported inline nodes in this minimal pass
				break;
		}
	}
	return out;
}

function addMark(active: PMMark[], mark: PMMark): PMMark[] {
	if (active.find((m) => m.type === mark.type)) return active;
	return [...active, mark];
}
