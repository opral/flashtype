import { Editor } from "@tiptap/core";
import History from "@tiptap/extension-history";
import Placeholder from "@tiptap/extension-placeholder";
import type { Lix } from "@/lib/lix-types";
import { MarkdownWc, astToTiptapDoc } from "./tiptap-markdown-bridge";
import type { EmptyMarkdownDefaultBlock } from "./tiptap-markdown-bridge";
import { parseMarkdown, serializeAst } from "./markdown";
import { handlePaste as defaultHandlePaste } from "./handle-paste";
import { SlashCommandsExtension } from "./extensions/slash-commands";
import { TableNavigationExtension } from "./extensions/table-navigation";
import { upsertMarkdownFile } from "./upsert-markdown-file";
import {
	buildNormalizedMarkdownFromEditor,
	normalizePersistedMarkdown,
} from "./build-markdown-from-editor";

type CreateEditorArgs = {
	lix: Lix;
	initialMarkdown?: string;
	contentAst?: any;
	onCreate?: (args: { editor: Editor }) => void;
	onUpdate?: (args: { editor: Editor }) => void | false;
	editorProps?: any;
	editable?: boolean;
	fileId?: string;
	defaultBlock?: EmptyMarkdownDefaultBlock;
	persistDebounceMs?: number;
	persistState?: boolean;
	resolveImageSrc?: (src: string) => string;
	originKey?: string;
};

export const createMarkdownEditorOriginKey = (): string => {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return `flashtype.markdown-editor:${crypto.randomUUID()}`;
	}
	return `flashtype.markdown-editor:${Date.now().toString(36)}${Math.random()
		.toString(36)
		.slice(2)}`;
};

function flushEditorViewDomObserver(view: any): void {
	view?.domObserver?.flush?.();
}

function isSelectionNavigationKey(event: KeyboardEvent): boolean {
	return (
		event.key === "ArrowLeft" ||
		event.key === "ArrowRight" ||
		event.key === "ArrowUp" ||
		event.key === "ArrowDown" ||
		event.key === "Home" ||
		event.key === "End" ||
		event.key === "PageUp" ||
		event.key === "PageDown"
	);
}

function externalLinkUrlFromClick(event: MouseEvent): string | null {
	if (event.button !== 0) {
		return null;
	}
	const target =
		event.target instanceof Element ? event.target.closest("a[href]") : null;
	if (!(target instanceof HTMLAnchorElement)) {
		return null;
	}
	const href = target.getAttribute("href")?.trim();
	if (!href) {
		return null;
	}
	const protocolMatch = href.match(/^([a-zA-Z][a-zA-Z\d+.-]*):/);
	const protocol = protocolMatch?.[1]?.toLowerCase();
	if (protocol === "http" || protocol === "https" || protocol === "mailto") {
		return target.href;
	}
	return null;
}

function openExternalLink(url: string): void {
	const openExternal = window.flashtypeDesktop?.app?.openExternal;
	if (openExternal) {
		void openExternal({ url });
		return;
	}
	window.open(url, "_blank", "noopener,noreferrer");
}

function handleExternalLinkClick(event: MouseEvent): void {
	const url = externalLinkUrlFromClick(event);
	if (!url) {
		return;
	}
	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation();
	openExternalLink(url);
}

// Plain TipTap Editor factory (no React). Useful for unit/integration tests.
export function createEditor(args: CreateEditorArgs): Editor {
	const {
		lix,
		initialMarkdown,
		contentAst,
		onCreate,
		onUpdate,
		editorProps,
		editable = true,
		fileId,
		defaultBlock,
		persistDebounceMs,
		persistState = true,
		resolveImageSrc,
		originKey = createMarkdownEditorOriginKey(),
	} = args;

	const ast = contentAst ?? (parseMarkdown(initialMarkdown ?? "") as any);

	let persistStateTimer: any = null;
	let persistRunning = false;
	let persistQueued = false;
	let persistPromise: Promise<void> | null = null;
	let destroyed = false;
	let editorInstance: Editor | null = null;
	let currentEditor: Editor | null = null;
	let cleanupExternalLinkClick: (() => void) | null = null;
	let lastPersistedMarkdown = normalizePersistedMarkdown(
		initialMarkdown ?? serializeAst(ast as any),
	);
	const persistDebounceMsResolved = persistDebounceMs ?? 0;
	const persistOnce = async (editor: Editor) => {
		const markdown = buildNormalizedMarkdownFromEditor(editor);
		if (markdown === lastPersistedMarkdown) return;
		await upsertMarkdownFile({
			lix,
			fileId: fileId!,
			markdown,
			createIfMissing: false,
			originKey,
		});
		lastPersistedMarkdown = markdown;
	};
	const runPersist = (editor: Editor): Promise<void> => {
		if (!fileId || !persistState) return Promise.resolve();
		if (persistRunning) {
			persistQueued = true;
			return persistPromise ?? Promise.resolve();
		}
		persistRunning = true;
		persistPromise = (async () => {
			try {
				do {
					persistQueued = false;
					await persistOnce(editor);
				} while (persistQueued && !destroyed);
			} finally {
				persistRunning = false;
				persistPromise = null;
			}
		})();
		return persistPromise;
	};

	const placeholderConfig: any = {
		placeholder: ({ node }: { node: any }) => {
			if (node.childCount !== 0) return "";
			if (node.type.name === "heading" && node.attrs?.level === 1) {
				return "Heading 1";
			}
			return node.type.name === "paragraph" ? "Start typing..." : "";
		},
		showOnlyWhenEditable: true,
		includeChildren: true,
		shouldShow: ({ editor, node }: { editor: Editor; node: any }) =>
			editor.isFocused &&
			(node.type.name === "paragraph" ||
				(node.type.name === "heading" && node.attrs?.level === 1)) &&
			node.childCount === 0,
	};

	const markdownExtensions = MarkdownWc({ resolveImageSrc }) as any[];

	editorInstance = new Editor({
		extensions: [
			...markdownExtensions,
			History.configure({
				depth: 200,
				newGroupDelay: 500,
			}),
			Placeholder.configure(placeholderConfig),
			SlashCommandsExtension.configure({
				onStateChange: () => {},
			}),
			TableNavigationExtension,
		],
		editable,
		content: astToTiptapDoc(ast, { defaultBlock }) as any,
		onCreate: ({ editor }) => {
			currentEditor = editor as Editor;
			lastPersistedMarkdown = buildNormalizedMarkdownFromEditor(editor);
			onCreate?.({ editor });
		},
		onUpdate: ({ editor }) => {
			if (destroyed) return;
			if (onUpdate?.({ editor }) === false) return;
			if (!fileId || !persistState) return;
			const scheduleRun = () => {
				if (destroyed) return;
				if (persistDebounceMsResolved <= 0) {
					void runPersist(editor);
					return;
				}
				if (persistStateTimer) clearTimeout(persistStateTimer);
				persistStateTimer = setTimeout(() => {
					persistStateTimer = null;
					if (destroyed) return;
					void runPersist(editor);
				}, persistDebounceMsResolved);
			};
			scheduleRun();
		},
		onDestroy: () => {
			cleanupExternalLinkClick?.();
			cleanupExternalLinkClick = null;
			persistQueued = false;
			if (persistStateTimer) {
				clearTimeout(persistStateTimer);
				persistStateTimer = null;
			}
			const editorToPersist = currentEditor ?? editorInstance;
			if (editorToPersist && fileId && persistState) {
				if (persistRunning) {
					persistQueued = true;
				}
				void runPersist(editorToPersist).finally(() => {
					destroyed = true;
					currentEditor = null;
				});
			} else {
				destroyed = true;
				currentEditor = null;
			}
		},
		editorProps: {
			handlePaste: async (_view: any, event: ClipboardEvent) => {
				if (!currentEditor) return false;
				return await defaultHandlePaste({
					editor: currentEditor as any,
					event,
				});
			},
			...editorProps,
			handleDOMEvents: {
				...(editorProps?.handleDOMEvents ?? {}),
				keyup: (view: any, event: KeyboardEvent) => {
					if (isSelectionNavigationKey(event)) {
						flushEditorViewDomObserver(view);
					}
					const handleKeyUp = editorProps?.handleDOMEvents?.keyup;
					return typeof handleKeyUp === "function"
						? handleKeyUp(view, event)
						: false;
				},
			},
		},
	});
	const editorDom = editorInstance.view.dom;
	editorDom.addEventListener("click", handleExternalLinkClick, {
		capture: true,
	});
	cleanupExternalLinkClick = () => {
		editorDom.removeEventListener("click", handleExternalLinkClick, {
			capture: true,
		});
	};
	currentEditor = editorInstance;
	return editorInstance;
}

// React useEditor config builder. TipTapEditor should use this to keep a single source.
