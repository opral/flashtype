import { Node, Mark, type Extensions, type CommandProps } from "@tiptap/core";
import { createCodeBlockNodeView } from "./mermaid-code-block-node-view";

export type MarkdownImageSrcResolver = (src: string) => string;

// Extend TipTap's command types
declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		horizontalRule: {
			setHorizontalRule: () => ReturnType;
		};
	}
}

// Minimal schema-only nodes and marks for MarkdownWc
function diffAttrs(node: any, mode: "words" | "element" = "words"): any {
	const id = node?.attrs?.data?.id;
	if (typeof id !== "string" || id.length === 0) return {};
	const diffMode =
		node?.attrs?.data?.diffMode === "words" ||
		node?.attrs?.data?.diffMode === "element"
			? node.attrs.data.diffMode
			: mode;
	return {
		"data-diff-key": id,
		"data-diff-mode": diffMode,
		"data-diff-show-when-removed": "true",
	};
}

export function markdownWcNodes(
	options: { readonly resolveImageSrc?: MarkdownImageSrcResolver } = {},
): Extensions {
	const resolveImageSrc = options.resolveImageSrc;
	return [
		// doc
		Node.create({ name: "doc", topNode: true, content: "block+" }),
		// text
		Node.create({ name: "text", group: "inline" }),
		// paragraph
		Node.create({
			name: "paragraph",
			group: "block",
			content: "inline*",
			addAttributes() {
				return { data: { default: null } };
			},
			renderHTML({ node }) {
				return ["p", diffAttrs(node), 0];
			},
		}),
		// heading
		Node.create({
			name: "heading",
			group: "block",
			content: "inline*",
			addAttributes() {
				return { level: { default: 1 }, data: { default: null } };
			},
			renderHTML({ node }) {
				const level = (node as any).attrs?.level || 1;
				return ["h" + level, diffAttrs(node), 0];
			},
		}),
		// lists
		Node.create({
			name: "bulletList",
			group: "block",
			content: "listItem+",
			addAttributes() {
				return { isTaskList: { default: false }, data: { default: null } };
			},
			renderHTML({ node }) {
				// Match serializeToHtml default: plain <ul>
				return ["ul", diffAttrs(node, "element"), 0];
			},
		}),
		Node.create({
			name: "orderedList",
			group: "block",
			content: "listItem+",
			addAttributes() {
				return { start: { default: 1 }, data: { default: null } };
			},
			renderHTML({ node }) {
				const attrs: any = {};
				const start = (node as any).attrs?.start;
				if (start && start !== 1) attrs.start = start;
				return ["ol", { ...attrs, ...diffAttrs(node, "element") }, 0];
			},
		}),
		// table
		Node.create({
			name: "table",
			group: "block",
			content: "tableRow+",
			addAttributes() {
				return { align: { default: [] }, data: { default: null } };
			},
			renderHTML({ node }) {
				return ["table", diffAttrs(node, "element"), ["tbody", 0]];
			},
		}),
		Node.create({
			name: "tableRow",
			content: "tableCell+",
			addAttributes() {
				return { data: { default: null } };
			},
			renderHTML({ node }) {
				return ["tr", diffAttrs(node, "element"), 0];
			},
		}),
		Node.create({
			name: "tableCell",
			content: "inline*",
			addAttributes() {
				return { data: { default: null } };
			},
			renderHTML({ node }) {
				return ["td", diffAttrs(node), 0];
			},
		}),
		Node.create({
			name: "listItem",
			group: "block",
			content: "paragraph block*",
			defining: true,
			addAttributes() {
				return { checked: { default: null }, data: { default: null } };
			},
			renderHTML({ node }) {
				const isTask =
					node.attrs.checked === true || node.attrs.checked === false;
				const attrs = diffAttrs(node, "element");
				if (!isTask) return ["li", attrs, ["div", 0]];
				return [
					"li",
					{
						...attrs,
						"data-task": node.attrs.checked ? "x" : " ",
					},
					[
						"input",
						{
							type: "checkbox",
							checked: node.attrs.checked ? "checked" : undefined,
							disabled: "true",
						},
					],
					["div", 0],
				];
			},
			addNodeView() {
				return ({ node, editor, getPos }) => {
					const dom = document.createElement("li");
					const isTask =
						node.attrs.checked === true || node.attrs.checked === false;
					let input: HTMLInputElement | null = null;
					const content = document.createElement("div");
					if (isTask) {
						dom.setAttribute("data-task", node.attrs.checked ? "x" : " ");
						input = document.createElement("input");
						input.type = "checkbox";
						input.checked = node.attrs.checked === true;
						input.addEventListener("mousedown", (e) => {
							// Prevent focusing the checkbox from moving the caret unexpectedly
							e.preventDefault();
						});
						input.addEventListener("change", () => {
							const pos = typeof getPos === "function" ? getPos() : null;
							if (pos == null) return;
							const tr = editor.view.state.tr.setNodeMarkup(pos, undefined, {
								...node.attrs,
								checked: !node.attrs.checked,
							});
							editor.view.dispatch(tr);
						});
						dom.appendChild(input);
					}
					for (const [key, value] of Object.entries(
						diffAttrs(node, "element"),
					)) {
						dom.setAttribute(key, String(value));
					}
					dom.appendChild(content);
					return {
						dom,
						contentDOM: content,
						update: (newNode) => {
							if (newNode.type.name !== "listItem") return false;
							const wasTask = isTask;
							const isNowTask =
								newNode.attrs.checked === true ||
								newNode.attrs.checked === false;
							// If task-state toggled between task/non-task, recreate
							if (wasTask !== isNowTask) return false;
							if (isNowTask) {
								if (input) input.checked = newNode.attrs.checked === true;
								dom.setAttribute(
									"data-task",
									newNode.attrs.checked ? "x" : " ",
								);
							}
							// Update attrs reference
							// @ts-ignore - node is captured; we can't reassign but it's fine for event handlers
							node = newNode;
							return true;
						},
					};
				};
			},
		}),
		// blockquote
		Node.create({
			name: "blockquote",
			group: "block",
			content: "block+",
			defining: true,
			addAttributes() {
				return { data: { default: null } };
			},
			renderHTML({ node }) {
				return ["blockquote", diffAttrs(node, "element"), 0];
			},
		}),
		// code block
		Node.create({
			name: "codeBlock",
			group: "block",
			content: "text*",
			marks: "",
			defining: true,
			code: true,
			addAttributes() {
				return { language: { default: null }, data: { default: null } };
			},
			renderHTML({ node }) {
				const lang = (node as any).attrs?.language ?? null;
				const codeAttrs: any = diffAttrs(node);
				if (lang) codeAttrs.class = `language-${lang}`;
				return ["pre", ["code", codeAttrs, 0]];
			},
			addNodeView() {
				return ({ node, editor, getPos }) =>
					createCodeBlockNodeView({
						node,
						editor,
						view: editor.view,
						getPos,
						diffAttrs: diffAttrs(node),
					});
			},
		}),
		// horizontal rule
		Node.create({
			name: "horizontalRule",
			group: "block",
			addAttributes() {
				return { data: { default: null } };
			},
			renderHTML({ node }) {
				return ["hr", diffAttrs(node, "element")];
			},
			addCommands() {
				const nodeName = this.name;
				return {
					setHorizontalRule:
						() =>
						({ commands }: CommandProps) => {
							return commands.insertContent({ type: nodeName });
						},
				};
			},
		}),
		// Unsupported blocks (html, yaml, etc.)
		Node.create({
			name: "markdownUnsupported",
			group: "block",
			atom: true,
			selectable: true,
			defining: true,
			addAttributes() {
				return {
					kind: { default: "html" },
					value: { default: "" },
					data: { default: null },
				};
			},
			renderHTML({ node }) {
				const kind = (node as any).attrs?.kind ?? "unsupported";
				const label =
					kind === "yaml"
						? "YAML frontmatter (read only)"
						: "HTML block (read only)";
				const value = (node as any).attrs?.value ?? "";
				return [
					"div",
					{
						"data-markdown-wc-unsupported": kind,
						class: "markdown-wc-unsupported-block",
						...diffAttrs(node, "element"),
					},
					["strong", label],
					["pre", ["code", value]],
				];
			},
		}),
		// Inline HTML placeholder
		Node.create({
			name: "markdownInlineHtml",
			group: "inline",
			inline: true,
			atom: true,
			selectable: true,
			addAttributes() {
				return {
					value: { default: "" },
					data: { default: null },
				};
			},
			renderHTML({ node }) {
				return [
					"span",
					{
						"data-markdown-inline-html": "true",
						class: "markdown-wc-inline-html",
						...diffAttrs(node, "element"),
					},
					["code", (node as any).attrs?.value ?? ""],
				];
			},
		}),
		// hard break
		Node.create({
			name: "hardBreak",
			group: "inline",
			inline: true,
			selectable: false,
			addAttributes() {
				return { data: { default: null } };
			},
			renderHTML({ node }) {
				return ["br", diffAttrs(node, "element")];
			},
		}),
		// marks
		Mark.create({
			name: "bold",
			renderHTML() {
				return ["strong", 0];
			},
		}),
		Mark.create({
			name: "italic",
			renderHTML() {
				return ["em", 0];
			},
		}),
		Mark.create({
			name: "strike",
			renderHTML() {
				return ["s", 0];
			},
		}),
		Mark.create({
			name: "code",
			renderHTML() {
				return ["code", 0];
			},
		}),
		Mark.create({
			name: "link",
			// Don't extend the link when typing at its edges — matches how links
			// behave in other editors (you type *out* of a link, not into it).
			inclusive: false,
			addAttributes() {
				return {
					href: {
						default: null,
						parseHTML: (el: any) => el.getAttribute("href"),
					},
					title: {
						default: null,
						parseHTML: (el: any) => el.getAttribute("title"),
					},
					data: { default: null },
				};
			},
			parseHTML() {
				return [{ tag: "a[href]" }];
			},
			renderHTML({ mark }) {
				const attrs: any = {};
				const href = (mark as any).attrs?.href;
				if (href) attrs.href = href;
				const title = (mark as any).attrs?.title;
				if (title) attrs.title = title;
				return ["a", attrs, 0];
			},
		}),
		// image (inline)
		Node.create({
			name: "image",
			group: "inline",
			inline: true,
			atom: true,
			addAttributes() {
				return {
					src: { default: null },
					alt: { default: null },
					title: { default: null },
					data: { default: null },
				};
			},
			renderHTML({ node }) {
				const attrs: any = {};
				const src = (node as any).attrs?.src;
				if (typeof src === "string" && src.length > 0) {
					attrs.src = resolveRenderedImageSrc(src, resolveImageSrc);
				}
				const alt = (node as any).attrs?.alt;
				if (alt) attrs.alt = alt;
				const title = (node as any).attrs?.title;
				if (title) attrs.title = title;
				return ["img", { ...attrs, ...diffAttrs(node, "element") }];
			},
		}),
	];
}

function resolveRenderedImageSrc(
	src: string,
	resolveImageSrc: MarkdownImageSrcResolver | undefined,
): string {
	if (!resolveImageSrc) {
		return src;
	}
	try {
		return resolveImageSrc(src);
	} catch {
		return src;
	}
}
