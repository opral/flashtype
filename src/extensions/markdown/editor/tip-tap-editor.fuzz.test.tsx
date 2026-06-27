// @vitest-environment jsdom
import { EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { render } from "@testing-library/react";
import seedrandom from "seedrandom";
import { expect, test } from "vitest";
import { buildMarkdownFromEditor } from "./build-markdown-from-editor";
import { createEditor } from "./create-editor";
import {
	applyOperationToSimplifiedState,
	buildOperationFailureMessage,
	buildPlainTextMismatchMessage,
	buildSelectionInvariantFailureMessage,
	createSimplifiedState,
	expectedPlainText,
	MARKDOWN_EDITOR_FUZZ_DEFAULT_SEED,
	MARKDOWN_EDITOR_FUZZ_OPERATION_COUNT,
	nextSimplifiedArrowSelection,
	nextOperation,
	renderPlainTextFromMarkdown,
	setEditorSelectionBySimplifiedOffset,
	simplifiedOffsetPositions,
	simplifiedSelectionFromEditor,
	validateEditorPositionMap,
	validateSimplifiedSelectionInvariant,
	type FuzzOperation,
	type SimplifiedState,
} from "./markdown-editor-fuzz";

test("fuzzes plain-text editor operations through markdown serialization", () => {
	const seed =
		process.env.FLASHTYPE_MARKDOWN_FUZZ_SEED ??
		MARKDOWN_EDITOR_FUZZ_DEFAULT_SEED;
	const rng = seedrandom(seed);
	const state = createSimplifiedState();
	const editor = createEditor({
		lix: {} as any,
		initialMarkdown: "",
		persistState: false,
	});
	const rendered = render(<EditorContent editor={editor} />);

	try {
		for (
			let index = 0;
			index < MARKDOWN_EDITOR_FUZZ_OPERATION_COUNT;
			index += 1
		) {
			const operation = nextOperation(rng, state);
			try {
				applyOperationToEditor(editor, state, operation);
				applyOperationToSimplifiedState(state, operation);
			} catch (error) {
				throw new Error(
					buildOperationFailureMessage({
						seed,
						index,
						operation,
						state,
						editorJson: editor.getJSON(),
						cause: error,
					}),
				);
			}
			assertEditorSelectionMatches(editor, state, seed, index, operation);
			assertMarkdownPlainTextMatches(editor, state, seed, index, operation);
		}
	} finally {
		rendered.unmount();
		editor.destroy();
	}
}, 120_000);

function applyOperationToEditor(
	editor: Editor,
	state: SimplifiedState,
	operation: FuzzOperation,
): void {
	validateEditorPositionMap(editor, state);
	if (operation.kind === "move") {
		setEditorSelectionBySimplifiedOffset(
			editor,
			operation.anchor,
			operation.head,
		);
		return;
	}

	setEditorSelectionBySimplifiedOffset(editor, state.anchor, state.head);

	switch (operation.kind) {
		case "type":
			typeEditorText(editor, operation.value);
			return;
		case "enter":
			sendEditorKey(editor, "Enter");
			return;
		case "shiftEnter":
			sendEditorKey(editor, "Enter", { shift: true });
			return;
		case "left":
			if (!trySendEditorKey(editor, "ArrowLeft")) {
				applyNativeArrowFallbackToEditor(editor, state, "left");
			}
			return;
		case "right":
			if (!trySendEditorKey(editor, "ArrowRight")) {
				applyNativeArrowFallbackToEditor(editor, state, "right");
			}
			return;
	}
}

function applyNativeArrowFallbackToEditor(
	editor: Editor,
	state: SimplifiedState,
	direction: "left" | "right",
): void {
	const next = nextSimplifiedArrowSelection(state, direction);
	setEditorSelectionBySimplifiedOffset(editor, next.anchor, next.head);
}

function typeEditorText(editor: Editor, value: string): void {
	const { from, to } = editor.state.selection;
	let handled = false;
	editor.view.someProp("handleTextInput", (handler: any) => {
		const result = handler(editor.view, from, to, value);
		handled = result || handled;
		return result;
	});
	if (!handled) {
		editor.commands.insertContent(value);
	}
}

function sendEditorKey(
	editor: Editor,
	key: string,
	options: { shift?: boolean } = {},
): void {
	if (trySendEditorKey(editor, key, options)) return;
	throw new Error(`Editor did not handle key: ${key}`);
}

function trySendEditorKey(
	editor: Editor,
	key: string,
	options: { shift?: boolean } = {},
): boolean {
	const event = new KeyboardEvent("keydown", {
		key,
		shiftKey: options.shift ?? false,
		bubbles: true,
		cancelable: true,
	});
	let handled = false;
	editor.view.someProp("handleKeyDown", (handler: any) => {
		const result = handler(editor.view, event);
		handled = result || handled;
		return result;
	});
	return handled;
}

function assertEditorSelectionMatches(
	editor: Editor,
	state: SimplifiedState,
	seed: string,
	index: number,
	operation: FuzzOperation,
): void {
	const positions = simplifiedOffsetPositions(editor);
	const selection = simplifiedSelectionFromEditor(editor);
	const reason = validateSimplifiedSelectionInvariant({
		state,
		positions,
		docSize: editor.state.doc.content.size,
		selection,
	});

	if (!reason) return;

	throw new Error(
		buildSelectionInvariantFailureMessage({
			seed,
			index,
			operation,
			state,
			reason,
			positions,
			docSize: editor.state.doc.content.size,
			selection,
			editorJson: editor.getJSON(),
		}),
	);
}

function assertMarkdownPlainTextMatches(
	editor: Editor,
	state: SimplifiedState,
	seed: string,
	index: number,
	operation: FuzzOperation,
): void {
	const markdown = buildMarkdownFromEditor(editor);
	const expected = expectedPlainText(state);
	const actual = renderPlainTextFromMarkdown(markdown);

	if (actual !== expected) {
		expect(
			actual,
			buildPlainTextMismatchMessage({
				seed,
				index,
				operation,
				state,
				expected,
				actual,
				markdown,
				editorJson: editor.getJSON(),
			}),
		).toBe(expected);
	}
}
