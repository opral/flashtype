import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { qb, sql } from "@/lib/lix-kysely";
import { useEditorCtx } from "./editor-context";
import { useLix, useQueryTakeFirst } from "@/lib/lix-react";
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

type TipTapEditorContentProps = Omit<TipTapEditorProps, "fileId"> & {
	readonly activeFileId?: string | null;
};

function TipTapEditorContent(props: TipTapEditorContentProps) {
	const activeBranch = useQueryTakeFirst<{ value: string }>((lix) =>
		qb(lix)
			.selectFrom("lix_key_value")
			.where("key", "=", "lix_workspace_branch_id")
			.select(["value"]),
	);
	const activeBranchId = String(activeBranch?.value ?? "");

	if (!props.activeFileId) {
		return (
			<TipTapEditorLoadedContent
				{...props}
				activeBranchId={activeBranchId}
				hasInitialFile={false}
				initialMarkdown=""
			/>
		);
	}

	return (
		<TipTapEditorFileContent
			{...props}
			activeFileId={props.activeFileId}
			activeBranchId={activeBranchId}
		/>
	);
}

function TipTapEditorFileContent({
	activeBranchId,
	activeFileId,
	...props
}: TipTapEditorContentProps & {
	readonly activeBranchId: string;
	readonly activeFileId: string;
}) {
	const initialFile = useQueryTakeFirst(
		(lix) =>
			qb(lix)
				.selectFrom("lix_file")
				.select("data")
				.select(() => [sql<string>`${activeBranchId}`.as("active_branch_id")])
				.where("id", "=", activeFileId),
		{ subscribe: false },
	);
	const initialMarkdown = decodeMarkdownData(initialFile?.data);

	return (
		<TipTapEditorLoadedContent
			{...props}
			activeFileId={activeFileId}
			activeBranchId={activeBranchId}
			hasInitialFile={Boolean(initialFile)}
			initialMarkdown={initialMarkdown}
		/>
	);
}

function TipTapEditorLoadedContent({
	activeFileId,
	activeBranchId,
	className,
	onReady,
	persistDebounceMs,
	focusOnLoad,
	isActiveView = true,
	hasInitialFile,
	initialMarkdown,
}: TipTapEditorContentProps & {
	readonly activeBranchId: string;
	readonly hasInitialFile: boolean;
	readonly initialMarkdown: string;
}) {
	const lix = useLix();
	const { setEditor } = useEditorCtx();
	const PERSIST_DEBOUNCE_MS = persistDebounceMs ?? 500;
	const normalizePersistedMarkdown = (markdown: string): string =>
		markdown.endsWith("\n") ? markdown : `${markdown}\n`;

	const [initialAst, setInitialAst] = useState<any | null>(null);
	const [initialAstLoaded, setInitialAstLoaded] = useState(false);
	const lastInitialAstRef = useRef<string | null>(null);
	const hasAutoFocusedRef = useRef(false);
	const mountedEditorRef = useRef<Editor | null>(null);

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
		});
	}, [
		lix,
		activeFileId,
		PERSIST_DEBOUNCE_MS,
		hasInitialFile,
		initialAst,
		initialAstLoaded,
		initialMarkdown,
	]);

	useEffect(() => {
		mountedEditorRef.current = editor;
		return () => {
			const editorToDestroy = editor;
			mountedEditorRef.current = null;
			queueMicrotask(() => {
				if (mountedEditorRef.current !== editorToDestroy) {
					editorToDestroy?.destroy();
				}
			});
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

	// Custom overlay scrollbar avoids flaky native scrollbar repaint behavior.
	const scrollIdleTimerRef = useRef<number | null>(null);
	const scrollFrameRef = useRef<number | null>(null);
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const scrollThumbRef = useRef<HTMLDivElement | null>(null);
	const setScrollbarVisible = useCallback((visible: boolean) => {
		const thumb = scrollThumbRef.current;
		if (!thumb) return;
		const next = visible ? "true" : "false";
		if (thumb.dataset.visible !== next) {
			thumb.dataset.visible = next;
		}
	}, []);
	const syncScrollbarThumb = useCallback(() => {
		if (scrollFrameRef.current !== null) return;
		scrollFrameRef.current = window.requestAnimationFrame(() => {
			scrollFrameRef.current = null;
			const el = scrollContainerRef.current;
			const thumb = scrollThumbRef.current;
			if (!el || !thumb) return;

			const { clientHeight, scrollHeight, scrollTop } = el;
			if (scrollHeight <= clientHeight) {
				thumb.dataset.scrollable = "false";
				setScrollbarVisible(false);
				return;
			}

			const minThumbHeight = 36;
			const thumbHeight = Math.max(
				minThumbHeight,
				(clientHeight / scrollHeight) * clientHeight,
			);
			const maxThumbTop = clientHeight - thumbHeight;
			const maxScrollTop = scrollHeight - clientHeight;
			const thumbTop =
				maxScrollTop > 0 ? (scrollTop / maxScrollTop) * maxThumbTop : 0;

			thumb.dataset.scrollable = "true";
			thumb.style.height = `${thumbHeight}px`;
			thumb.style.transform = `translate3d(0, ${thumbTop}px, 0)`;
		});
	}, [setScrollbarVisible]);

	useEffect(() => {
		const el = scrollContainerRef.current;
		if (!el) return;

		const supportsScrollEnd = "onscrollend" in window;
		const hideScrollbar = () => {
			if (scrollIdleTimerRef.current !== null) {
				window.clearTimeout(scrollIdleTimerRef.current);
				scrollIdleTimerRef.current = null;
			}
			setScrollbarVisible(false);
		};
		const scheduleFallbackHide = () => {
			if (scrollIdleTimerRef.current !== null) {
				window.clearTimeout(scrollIdleTimerRef.current);
			}
			scrollIdleTimerRef.current = window.setTimeout(hideScrollbar, 450);
		};
		const showScrollbar = () => {
			syncScrollbarThumb();
			setScrollbarVisible(true);
		};
		const handleNativeScroll = () => {
			showScrollbar();
			if (!supportsScrollEnd) {
				scheduleFallbackHide();
			}
		};
		const handlePointerEnter = () => {
			showScrollbar();
		};
		const handlePointerLeave = () => {
			if (el.scrollHeight > el.clientHeight) {
				hideScrollbar();
			}
		};
		const handleWheel = () => {
			showScrollbar();
			if (!supportsScrollEnd) {
				scheduleFallbackHide();
			}
		};

		const resizeObserver = new ResizeObserver(syncScrollbarThumb);
		resizeObserver.observe(el);
		if (el.firstElementChild) {
			resizeObserver.observe(el.firstElementChild);
		}
		syncScrollbarThumb();

		el.addEventListener("scroll", handleNativeScroll, { passive: true });
		el.addEventListener("pointerenter", handlePointerEnter, { passive: true });
		el.addEventListener("pointerleave", handlePointerLeave, { passive: true });
		el.addEventListener("wheel", handleWheel, { passive: true });
		if (supportsScrollEnd) {
			el.addEventListener("scrollend", hideScrollbar, { passive: true });
		}

		return () => {
			resizeObserver.disconnect();
			el.removeEventListener("scroll", handleNativeScroll);
			el.removeEventListener("pointerenter", handlePointerEnter);
			el.removeEventListener("pointerleave", handlePointerLeave);
			el.removeEventListener("wheel", handleWheel);
			if (supportsScrollEnd) {
				el.removeEventListener("scrollend", hideScrollbar);
			}
			if (scrollIdleTimerRef.current !== null) {
				window.clearTimeout(scrollIdleTimerRef.current);
				scrollIdleTimerRef.current = null;
			}
			if (scrollFrameRef.current !== null) {
				window.cancelAnimationFrame(scrollFrameRef.current);
				scrollFrameRef.current = null;
			}
		};
	}, [editor, setScrollbarVisible, syncScrollbarThumb]);

	// Observe markdown file rows and refresh on external changes.
	useEffect(() => {
		if (!activeFileId || !editor) return;
		const events = lix.observe(
			`
				SELECT
					data
				FROM lix_file
				WHERE id = ?
			`,
			[activeFileId],
		);
		let closed = false;
		let sawInitialSnapshot = false;
		const initialObservedMarkdown = normalizePersistedMarkdown(initialMarkdown);

		void (async () => {
			while (!closed) {
				const event = await events.next();
				if (!event || closed) {
					continue;
				}
				const firstRow = event.result.rows[0];
				if (!firstRow) {
					continue;
				}
				const nextMarkdown = normalizePersistedMarkdown(
					decodeMarkdownData(firstRow.get("data")),
				);
				if (!sawInitialSnapshot) {
					sawInitialSnapshot = true;
					if (nextMarkdown === initialObservedMarkdown) {
						continue;
					}
				}
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
	}, [lix, editor, activeFileId, activeBranchId, initialMarkdown]);

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
	}, [lix, activeFileId, activeBranchId, initialAstLoaded]);

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
		<div className={`relative min-h-0 ${className ?? ""}`}>
			<div
				ref={scrollContainerRef}
				className="ph-mask tiptap-container w-full h-full bg-background cursor-text overflow-y-auto"
				data-editor-focused={isEditorFocused ? "true" : "false"}
				onMouseDown={handleSurfacePointerDown}
			>
				<EditorContent
					editor={editor}
					className="tiptap w-full mx-auto"
					data-testid="tiptap-editor"
					key={`${activeBranchId}:${activeFileId ?? "no-file"}`}
				/>
			</div>
			<div
				ref={scrollThumbRef}
				className="tiptap-scrollbar-thumb"
				aria-hidden="true"
			/>
		</div>
	);
}
