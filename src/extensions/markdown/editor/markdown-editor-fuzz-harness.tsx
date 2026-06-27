import { useEffect, useMemo } from "react";
import { EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { buildMarkdownFromEditor } from "./build-markdown-from-editor";
import { createEditor } from "./create-editor";
import {
	renderPlainTextFromMarkdown,
	setEditorSelectionBySimplifiedOffset,
	simplifiedOffsetPositions,
	simplifiedSelectionFromDom,
	simplifiedSelectionFromEditor,
	type MarkdownFuzzSnapshot,
} from "./markdown-editor-fuzz";

export type MarkdownEditorFuzzHarnessApi = {
	setSelection(anchor: number, head: number): void;
	snapshot(): MarkdownFuzzSnapshot;
	destroy(): void;
};

declare global {
	interface Window {
		__flashtypeMarkdownFuzz?: MarkdownEditorFuzzHarnessApi;
	}
}

export function MarkdownEditorFuzzHarness() {
	const editor = useMemo(
		() =>
			createEditor({
				lix: {} as any,
				initialMarkdown: "",
				persistState: false,
			}),
		[],
	);

	useEffect(() => {
		const api = createMarkdownFuzzApi(editor);
		window.__flashtypeMarkdownFuzz = api;
		editor.commands.focus("start");
		editor.view.focus();

		return () => {
			if (window.__flashtypeMarkdownFuzz === api) {
				delete window.__flashtypeMarkdownFuzz;
			}
			api.destroy();
		};
	}, [editor]);

	return (
		<div
			className="min-h-dvh bg-background p-6"
			data-testid="markdown-editor-fuzz-harness"
		>
			<EditorContent
				editor={editor}
				className="tiptap markdown-editor-fuzz-harness"
			/>
		</div>
	);
}

function createMarkdownFuzzApi(editor: Editor): MarkdownEditorFuzzHarnessApi {
	return {
		setSelection(anchor: number, head: number) {
			editor.view.focus();
			setEditorSelectionBySimplifiedOffset(editor, anchor, head);
			editor.view.focus();
		},
		snapshot() {
			const domSelection = simplifiedSelectionFromDom(editor);
			syncEditorSelectionFromDom(editor);
			const markdown = buildMarkdownFromEditor(editor);
			return {
				markdown,
				plainText: renderPlainTextFromMarkdown(markdown),
				editorJson: editor.getJSON(),
				positionCount: simplifiedOffsetPositions(editor).length,
				domSelection,
				selection: simplifiedSelectionFromEditor(editor),
			};
		},
		destroy() {
			if (!editor.isDestroyed) {
				editor.destroy();
			}
		},
	};
}

function syncEditorSelectionFromDom(editor: Editor): void {
	(editor.view as any).domObserver?.flush?.();
}
