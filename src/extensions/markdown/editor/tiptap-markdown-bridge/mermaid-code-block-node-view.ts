import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView, NodeView } from "@tiptap/pm/view";
import {
	getMermaidRenderTheme,
	onMermaidThemeChange,
	renderMermaidDiagram,
} from "./mermaid-render";

type DiffAttrs = Record<string, string>;
type MermaidTheme = ReturnType<typeof getMermaidRenderTheme>;

export function createCodeBlockNodeView(options: {
	readonly node: ProseMirrorNode;
	readonly editor: Editor;
	readonly view: EditorView;
	readonly getPos: () => number | undefined;
	readonly diffAttrs: DiffAttrs;
}): NodeView {
	const { node, editor, view, getPos, diffAttrs } = options;
	const language = node.attrs?.language ?? null;

	if (language !== "mermaid") {
		return createPlainCodeBlockNodeView(node, diffAttrs);
	}

	return createMermaidCodeBlockNodeView({
		node,
		editor,
		view,
		getPos,
		diffAttrs,
	});
}

function createPlainCodeBlockNodeView(
	node: ProseMirrorNode,
	diffAttrs: DiffAttrs,
): NodeView {
	const pre = document.createElement("pre");
	const code = document.createElement("code");
	const language = node.attrs?.language ?? null;
	if (language) {
		code.className = `language-${language}`;
	}
	for (const [key, value] of Object.entries(diffAttrs)) {
		code.setAttribute(key, value);
	}
	pre.appendChild(code);
	return {
		dom: pre,
		contentDOM: code,
	};
}

function createMermaidCodeBlockNodeView(options: {
	readonly node: ProseMirrorNode;
	readonly editor: Editor;
	readonly view: EditorView;
	readonly getPos: () => number | undefined;
	readonly diffAttrs: DiffAttrs;
}): NodeView {
	const { editor, view, getPos, diffAttrs } = options;
	let currentNode = options.node;

	const dom = document.createElement("div");
	dom.className = "markdown-mermaid-block";
	for (const [key, value] of Object.entries(diffAttrs)) {
		dom.setAttribute(key, value);
	}

	const preview = document.createElement("div");
	preview.className = "markdown-mermaid-preview";

	const srDescription = document.createElement("span");
	srDescription.className = "markdown-mermaid-sr-description";

	const error = document.createElement("div");
	error.className = "markdown-mermaid-error";
	error.hidden = true;

	const pre = document.createElement("pre");
	pre.className = "markdown-mermaid-source";
	const code = document.createElement("code");
	code.className = "language-mermaid";
	pre.appendChild(code);

	dom.appendChild(preview);
	dom.appendChild(srDescription);
	dom.appendChild(error);
	dom.appendChild(pre);

	let lastRenderedSource = "";
	let lastRenderedTheme: MermaidTheme | null = null;
	let renderDebounceTimer: number | null = null;
	let renderInFlight = false;
	let renderScheduledAfterFlight = false;
	let destroyed = false;
	let showingSource =
		editor.isFocused && isNodeSelected(view, getPos, currentNode);

	function getSourceText(): string {
		return code.textContent || currentNode.textContent;
	}

	function previewIsCurrent(source: string): boolean {
		return (
			source === lastRenderedSource &&
			lastRenderedTheme === getMermaidRenderTheme() &&
			preview.querySelector("svg") !== null
		);
	}

	function scheduleRenderPreview(): void {
		if (showingSource) return;
		if (renderInFlight) {
			renderScheduledAfterFlight = true;
			return;
		}
		if (renderDebounceTimer !== null) {
			window.clearTimeout(renderDebounceTimer);
		}
		renderDebounceTimer = window.setTimeout(() => {
			renderDebounceTimer = null;
			void renderPreview();
		}, 50);
	}

	function syncAccessibility(source: string): void {
		preview.setAttribute("aria-hidden", showingSource ? "true" : "false");
		srDescription.textContent = source;
		srDescription.hidden = showingSource || !source.trim();
	}

	function setViewMode(editing: boolean): void {
		showingSource = editing;
		dom.dataset.editing = editing ? "true" : "false";
		error.hidden = editing || error.textContent === "";
		syncAccessibility(getSourceText());
		if (!editing) {
			scheduleRenderPreview();
		}
	}

	async function renderPreview(): Promise<void> {
		if (destroyed || showingSource) return;
		if (renderInFlight) {
			renderScheduledAfterFlight = true;
			return;
		}

		const source = getSourceText();
		if (previewIsCurrent(source)) {
			return;
		}
		if (!source.trim()) {
			preview.replaceChildren();
			error.hidden = true;
			error.textContent = "";
			lastRenderedSource = "";
			lastRenderedTheme = null;
			syncAccessibility(source);
			return;
		}

		renderInFlight = true;
		const renderTheme = getMermaidRenderTheme();
		try {
			await renderMermaidDiagram(source, preview);
			if (destroyed || showingSource) return;
			error.hidden = true;
			error.textContent = "";
			lastRenderedSource = source;
			lastRenderedTheme = renderTheme;
			syncAccessibility(source);
			if (renderTheme !== getMermaidRenderTheme()) {
				renderScheduledAfterFlight = true;
			}
		} catch (cause) {
			if (destroyed || showingSource) return;
			preview.replaceChildren();
			error.hidden = false;
			error.textContent = formatMermaidError(cause);
		} finally {
			renderInFlight = false;
			if (renderScheduledAfterFlight) {
				renderScheduledAfterFlight = false;
				scheduleRenderPreview();
			}
		}
	}

	setViewMode(showingSource);

	const syncViewMode = () => {
		const selected =
			editor.isFocused && isNodeSelected(view, getPos, currentNode);
		if (selected !== showingSource) {
			setViewMode(selected);
		}
	};
	editor.on("selectionUpdate", syncViewMode);
	editor.on("blur", syncViewMode);

	const unsubscribeThemeChange = onMermaidThemeChange(() => {
		if (destroyed || showingSource) return;
		scheduleRenderPreview();
	});

	return {
		dom,
		contentDOM: code,
		ignoreMutation(mutation) {
			const target = mutation.target;
			if (!(target instanceof Node)) {
				return true;
			}
			return !code.contains(target);
		},
		update(updatedNode) {
			if (updatedNode.type.name !== "codeBlock") return false;
			if ((updatedNode.attrs?.language ?? null) !== "mermaid") {
				return false;
			}

			currentNode = updatedNode;
			syncAccessibility(updatedNode.textContent);
			const selected =
				editor.isFocused && isNodeSelected(view, getPos, updatedNode);
			if (selected !== showingSource) {
				setViewMode(selected);
			} else if (
				!selected &&
				!previewIsCurrent(updatedNode.textContent)
			) {
				scheduleRenderPreview();
			}
			return true;
		},
		selectNode() {
			setViewMode(true);
		},
		deselectNode() {
			setViewMode(false);
		},
		destroy() {
			destroyed = true;
			unsubscribeThemeChange();
			if (renderDebounceTimer !== null) {
				window.clearTimeout(renderDebounceTimer);
				renderDebounceTimer = null;
			}
			editor.off("selectionUpdate", syncViewMode);
			editor.off("blur", syncViewMode);
		},
	};
}

function isNodeSelected(
	view: EditorView,
	getPos: () => number | undefined,
	node: ProseMirrorNode,
): boolean {
	const pos = getPos();
	if (pos == null) return false;
	const { from, to } = view.state.selection;
	return from >= pos && to <= pos + node.nodeSize;
}

function formatMermaidError(cause: unknown): string {
	if (cause instanceof Error) return cause.message;
	return String(cause);
}
