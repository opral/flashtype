import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { qb } from "@lix-js/kysely";
import { useEditorCtx } from "./editor-context";
import { useLix, useQueryTakeFirst } from "@lix-js/react-utils";
import { useKeyValue } from "@/hooks/key-value/use-key-value";
import { createEditor } from "./create-editor";
import { assembleMdAst } from "./assemble-md-ast";
import { astToTiptapDoc } from "./tiptap-markdown-bridge";
import { parseMarkdown, serializeAst } from "./markdown-rust";
import { tiptapDocToAst } from "./tiptap-markdown-bridge";
import { decodeMarkdownData } from "./decode-markdown-data";

type TipTapEditorProps = {
	fileId?: string | null;
	className?: string;
	onReady?: (editor: Editor) => void;
	persistDebounceMs?: number;
	focusOnLoad?: boolean;
	isActiveView?: boolean;
};

/**
 * Rich text editor for Markdown files backed by the Lix store.
 *
 * Loads the active file lazily, keeps the ProseMirror instance in sync with
 * remote changes, and persists edits via the collaborative Lix writer.
 *
 * @example
 * <TipTapEditor
 *   fileId="file-123"
 *   className="grow"
 *   onReady={(editor) => editor.commands.focus()}
 *   focusOnLoad
 * />
 */
export function TipTapEditor({
	fileId,
	className,
	onReady,
	persistDebounceMs,
	focusOnLoad,
	isActiveView = true,
}: TipTapEditorProps) {
	if (fileId) {
		return (
			<TipTapEditorContent
				activeFileId={fileId}
				className={className}
				onReady={onReady}
				persistDebounceMs={persistDebounceMs}
				focusOnLoad={focusOnLoad}
				isActiveView={isActiveView}
			/>
		);
	}

	return (
		<TipTapEditorWithActiveKey
			className={className}
			onReady={onReady}
			persistDebounceMs={persistDebounceMs}
			focusOnLoad={focusOnLoad}
			isActiveView={isActiveView}
		/>
	);
}

function TipTapEditorWithActiveKey(props: Omit<TipTapEditorProps, "fileId">) {
	const [activeFileId] = useKeyValue("flashtype_active_file_id");
	return (
		<TipTapEditorContent
			{...props}
			activeFileId={typeof activeFileId === "string" ? activeFileId : null}
		/>
	);
}

function TipTapEditorContent({
	activeFileId,
	className,
	onReady,
	persistDebounceMs,
	focusOnLoad,
	isActiveView = true,
}: Omit<TipTapEditorProps, "fileId"> & {
	readonly activeFileId?: string | null;
}) {
	const lix = useLix();
	const initialFile = useQueryTakeFirst(
		(lix) =>
			qb(lix)
				.selectFrom("lix_file")
				.select("data")
				.where("id", "=", activeFileId ?? ""),
		{ subscribe: false },
	);
	const hasInitialFile = Boolean(initialFile);
	const initialMarkdown = useMemo(() => {
		return decodeMarkdownData(initialFile?.data);
	}, [initialFile]);

	const { setEditor } = useEditorCtx();

	const PERSIST_DEBOUNCE_MS = persistDebounceMs ?? 500;
	const writerKey = "flashtype_tiptap_editor";
	const normalizePersistedMarkdown = (markdown: string): string =>
		markdown.endsWith("\n") ? markdown : `${markdown}\n`;

	const [initialAst, setInitialAst] = useState<any | null>(null);
	const [initialAstLoaded, setInitialAstLoaded] = useState(false);
	const lastInitialAstRef = useRef<string | null>(null);
	const hasAutoFocusedRef = useRef(false);

	const editor = useMemo(() => {
		if (!activeFileId || !hasInitialFile || !initialAstLoaded) return null;
		// Prefer assembled AST from the current file bytes so initialization stays deterministic.
		const hasAstSnapshot =
			Array.isArray(initialAst?.children) && initialAst.children.length > 0;
		return createEditor({
			lix,
			initialMarkdown,
			contentAst: hasAstSnapshot ? initialAst : undefined,
			fileId: activeFileId,
			persistDebounceMs: PERSIST_DEBOUNCE_MS,
			writerKey,
		});
	}, [
		lix,
		activeFileId,
		PERSIST_DEBOUNCE_MS,
		writerKey,
		hasInitialFile,
		initialAst,
		initialAstLoaded,
		initialMarkdown,
	]);

	useEffect(() => {
		return () => {
			editor?.destroy();
		};
	}, [editor]);

	const [isEditorFocused, setIsEditorFocused] = useState(false);

	useEffect(() => {
		if (!editor) return;
		const syncFocus = () => setIsEditorFocused(editor.isFocused);
		syncFocus();
		editor.on("focus", syncFocus);
		editor.on("blur", syncFocus);
		return () => {
			editor.off("focus", syncFocus);
			editor.off("blur", syncFocus);
		};
	}, [editor]);

	const handleSurfacePointerDown = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			if (!editor) return;
			const target = event.target as HTMLElement | null;
			const insideContent = target?.closest(".ProseMirror");
			if (insideContent) return;
			event.preventDefault();
			if (editor.isEmpty) {
				editor.commands.focus("start");
			} else {
				editor.commands.focus("end");
			}
		},
		[editor],
	);

	// Observe markdown file rows and refresh on external changes.
	useEffect(() => {
		if (!activeFileId || !editor) return;
		const events = lix.observe({
			sql: `
				SELECT
					data
				FROM lix_file
				WHERE id = ?
			`,
			params: [activeFileId],
		});
		let closed = false;

		void (async () => {
			while (!closed) {
				const event = await events.next();
				if (!event || closed) {
					continue;
				}
				const firstRow = Array.isArray(event.rows?.rows?.[0])
					? event.rows.rows[0]
					: null;
				if (!firstRow) {
					continue;
				}
				const nextMarkdown = normalizePersistedMarkdown(
					decodeMarkdownData(firstRow[0]),
				);
				const currentMarkdownAst = tiptapDocToAst(
					editor.getJSON() as any,
				) as any;
				const currentMarkdown = normalizePersistedMarkdown(
					serializeAst({
						type: "root",
						children: Array.isArray(currentMarkdownAst?.children)
							? currentMarkdownAst.children
							: [],
					}),
				);
				if (currentMarkdown === nextMarkdown) {
					continue;
				}
				const ast = parseMarkdown(nextMarkdown) as any;
				editor.commands.setContent(astToTiptapDoc(ast), {
					emitUpdate: false,
				});
			}
		})();

		return () => {
			closed = true;
			events.close();
		};
	}, [lix, editor, activeFileId, writerKey]);

	useEffect(() => {
		hasAutoFocusedRef.current = false;
	}, [activeFileId]);

	useEffect(() => {
		if (!editor) return;
		if (!focusOnLoad) return;
		if (!isActiveView) return;
		if (hasAutoFocusedRef.current) return;
		editor.commands.focus("end");
		hasAutoFocusedRef.current = true;
	}, [editor, focusOnLoad, isActiveView, activeFileId]);

	useEffect(() => {
		let cancelled = false;
		if (!activeFileId) {
			setInitialAst(null);
			setInitialAstLoaded(true);
			lastInitialAstRef.current = null;
			return;
		}
		(async () => {
			const ast = await assembleMdAst({ lix, fileId: activeFileId });
			if (cancelled) return;
			const serialized = JSON.stringify(ast);
			if (serialized === lastInitialAstRef.current && initialAstLoaded) return;
			lastInitialAstRef.current = serialized;
			setInitialAstLoaded(false);
			setInitialAst(ast);
			setInitialAstLoaded(true);
		})();
		return () => {
			cancelled = true;
		};
	}, [lix, activeFileId, initialAstLoaded]);

	useEffect(() => {
		if (!editor) return;
		setEditor(editor);
		onReady?.(editor);
	}, [editor, setEditor, onReady]);

	if (!activeFileId) {
		return (
			<div className={className ?? undefined}>
				<div className="flex h-full min-h-[200px] items-center justify-center bg-background px-3 py-12">
					<p className="text-sm text-muted-foreground">
						Select a file to start writing.
					</p>
				</div>
			</div>
		);
	}

	if (!editor) {
		return (
			<div className={className ?? undefined}>
				<div className="w-full bg-background px-3 py-12">
					<div className="mx-auto h-48 w-full max-w-5xl animate-pulse rounded-md bg-muted" />
				</div>
			</div>
		);
	}

	return (
		<div className={`min-h-0 ${className ?? ""}`}>
			<div
				className="tiptap-container w-full h-full bg-background py-0 cursor-text overflow-y-auto"
				data-editor-focused={isEditorFocused ? "true" : "false"}
				onMouseDown={handleSurfacePointerDown}
			>
				<EditorContent
					editor={editor}
					className="tiptap w-full max-w-5xl mx-auto"
					data-testid="tiptap-editor"
					key={activeFileId ?? "no-file"}
				/>
			</div>
		</div>
	);
}
