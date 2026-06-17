import { Editor } from "@tiptap/core";
import History from "@tiptap/extension-history";
import Placeholder from "@tiptap/extension-placeholder";
import type { Lix } from "@/lib/lix-types";
import {
	MarkdownWc,
	astToTiptapDoc,
	tiptapDocToAst,
} from "./tiptap-markdown-bridge";
import { parseMarkdown, serializeAst } from "./markdown-rust";
import { handlePaste as defaultHandlePaste } from "./handle-paste";
import { SlashCommandsExtension } from "./extensions/slash-commands";
import { TableNavigationExtension } from "./extensions/table-navigation";
import { upsertMarkdownFile } from "./upsert-markdown-file";

type CreateEditorArgs = {
	lix: Lix;
	initialMarkdown?: string;
	contentAst?: any;
	onCreate?: (args: { editor: Editor }) => void;
	onUpdate?: (args: { editor: Editor }) => void | false;
	editorProps?: any;
	editable?: boolean;
	fileId?: string;
	persistDebounceMs?: number;
	persistState?: boolean;
};

const createNodeId = (): string => {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID().replaceAll("-", "").slice(0, 10);
	}
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(
		0,
		10,
	);
};

const normalizePersistedMarkdown = (markdown: string): string =>
	markdown.endsWith("\n") ? markdown : `${markdown}\n`;

function ensureTopLevelIds(children: any[]): void {
	const seen = new Set<string>();
	for (const node of children) {
		node.data = node.data || {};
		let id = (node.data.id ?? "") as string;
		if (!id || seen.has(id)) {
			do {
				id = createNodeId();
			} while (seen.has(id));
			node.data.id = id;
		}
		seen.add(id);
	}
}

function markdownFromEditorAst(editor: Editor): string {
	const ast = tiptapDocToAst(editor.getJSON() as any) as any;
	const children: any[] = Array.isArray(ast?.children) ? ast.children : [];
	ensureTopLevelIds(children);
	return serializeAst({ type: "root", children } as any);
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
		persistDebounceMs,
		persistState = true,
	} = args;

	const ast = contentAst ?? (parseMarkdown(initialMarkdown ?? "") as any);

	let persistStateTimer: any = null;
	let persistRunning = false;
	let persistQueued = false;
	let currentEditor: Editor | null = null;
	let lastPersistedMarkdown = normalizePersistedMarkdown(
		initialMarkdown ?? serializeAst(ast as any),
	);
	const persistDebounceMsResolved = persistDebounceMs ?? 0;

	const placeholderConfig: any = {
		placeholder: ({ node }: { node: any }) =>
			node.type.name === "paragraph" && node.childCount === 0
				? "Start typing..."
				: "",
		showOnlyWhenEditable: true,
		includeChildren: true,
		shouldShow: ({ editor, node }: { editor: Editor; node: any }) =>
			editor.isFocused &&
			node.type.name === "paragraph" &&
			node.childCount === 0,
	};

	const markdownExtensions = MarkdownWc({}) as any[];

	return new Editor({
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
		content: astToTiptapDoc(ast) as any,
		onCreate: ({ editor }) => {
			currentEditor = editor as Editor;
			lastPersistedMarkdown = normalizePersistedMarkdown(
				markdownFromEditorAst(editor),
			);
			onCreate?.({ editor });
		},
		onUpdate: ({ editor }) => {
			if (onUpdate?.({ editor }) === false) return;
			if (!fileId || !persistState) return;
			const scheduleRun = () => {
				if (persistDebounceMsResolved <= 0) {
					void run();
					return;
				}
				if (persistStateTimer) clearTimeout(persistStateTimer);
				persistStateTimer = setTimeout(() => {
					persistStateTimer = null;
					void run();
				}, persistDebounceMsResolved);
			};
			const run = async () => {
				if (persistRunning) {
					persistQueued = true;
					return;
				}
				persistRunning = true;
				try {
					const markdown = normalizePersistedMarkdown(
						markdownFromEditorAst(editor),
					);
					if (markdown === lastPersistedMarkdown) return;
					await upsertMarkdownFile({
						lix,
						fileId,
						markdown,
					});
					lastPersistedMarkdown = markdown;
				} finally {
					persistRunning = false;
					if (persistQueued) {
						persistQueued = false;
						scheduleRun();
					}
				}
			};
			scheduleRun();
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
		},
	});
}

// React useEditor config builder. TipTapEditor should use this to keep a single source.
