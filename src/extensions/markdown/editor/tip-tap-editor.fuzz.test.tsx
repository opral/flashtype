// @vitest-environment jsdom
import { EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { render } from "@testing-library/react";
import seedrandom from "seedrandom";
import { expect, test } from "vitest";
import { buildMarkdownFromEditor } from "./build-markdown-from-editor";
import { createEditor } from "./create-editor";
import { parseMarkdown } from "./markdown";

const PARAGRAPH_BREAK = "\x1E";
const HARD_BREAK = "\n";
const OPERATION_COUNT = 10_000;
const DEFAULT_SEED = "markdown-editor-plain-text-fuzz-v1";

type SimplifiedState = {
	chars: string[];
	anchor: number;
	head: number;
};

type FuzzOperation =
	| { kind: "type"; value: string }
	| { kind: "enter" }
	| { kind: "shiftEnter" }
	| { kind: "left" }
	| { kind: "right" }
	| { kind: "move"; anchor: number; head: number };

test(
	"fuzzes plain-text editor operations through markdown serialization",
	() => {
		const seed = process.env.FLASHTYPE_MARKDOWN_FUZZ_SEED ?? DEFAULT_SEED;
		const rng = seedrandom(seed);
		const state: SimplifiedState = { chars: [], anchor: 0, head: 0 };
		const editor = createEditor({
			lix: {} as any,
			initialMarkdown: "",
			persistState: false,
		});
		const rendered = render(<EditorContent editor={editor} />);

		try {
			for (let index = 0; index < OPERATION_COUNT; index += 1) {
				const operation = nextOperation(rng, state);
				try {
					applyOperationToEditor(editor, state, operation);
					applyOperationToSimplifiedState(state, operation);
				} catch (error) {
					throw new Error(
						[
							"Markdown editor fuzz operation failed.",
							`seed=${seed}`,
							`operationIndex=${index}`,
							`operation=${JSON.stringify(operation)}`,
							`selection=${state.anchor}:${state.head}`,
							`simplified=${JSON.stringify(state.chars.join(""))}`,
							`doc=${JSON.stringify(editor.getJSON())}`,
							`cause=${error instanceof Error ? error.message : String(error)}`,
						].join("\n"),
					);
				}
				assertMarkdownPlainTextMatches(editor, state, seed, index, operation);
			}
		} finally {
			rendered.unmount();
			editor.destroy();
		}
	},
	120_000,
);

function nextOperation(
	rng: seedrandom.PRNG,
	state: SimplifiedState,
): FuzzOperation {
	const roll = rng();
	if (roll < 0.45) {
		const charCode = "a".charCodeAt(0) + Math.floor(rng() * 26);
		return { kind: "type", value: String.fromCharCode(charCode) };
	}
	if (roll < 0.55) return { kind: "enter" };
	if (roll < 0.65) return { kind: "shiftEnter" };
	if (roll < 0.72) return { kind: "left" };
	if (roll < 0.79) return { kind: "right" };

	const anchor = randomOffset(rng, state);
	const shouldSelectRange = rng() < 0.45 && state.chars.length > 0;
	const head = shouldSelectRange ? randomOffset(rng, state) : anchor;
	return { kind: "move", anchor, head };
}

function randomOffset(rng: seedrandom.PRNG, state: SimplifiedState): number {
	return Math.floor(rng() * (state.chars.length + 1));
}

function applyOperationToEditor(
	editor: Editor,
	state: SimplifiedState,
	operation: FuzzOperation,
): void {
	if (operation.kind === "move") {
		setEditorSelection(editor, operation.anchor, operation.head, state);
		return;
	}

	setEditorSelection(editor, state.anchor, state.head, state);

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
		case "right":
			return;
	}
}

function applyOperationToSimplifiedState(
	state: SimplifiedState,
	operation: FuzzOperation,
): void {
	switch (operation.kind) {
		case "type":
			replaceSelection(state, operation.value);
			return;
		case "enter":
			replaceSelection(state, PARAGRAPH_BREAK);
			return;
		case "shiftEnter":
			replaceSelection(state, HARD_BREAK);
			return;
		case "left": {
			const { from, to } = selectionBounds(state);
			const next = from === to ? Math.max(0, from - 1) : from;
			state.anchor = next;
			state.head = next;
			return;
		}
		case "right": {
			const { from, to } = selectionBounds(state);
			const next = from === to ? Math.min(state.chars.length, to + 1) : to;
			state.anchor = next;
			state.head = next;
			return;
		}
		case "move":
			state.anchor = operation.anchor;
			state.head = operation.head;
			return;
	}
}

function replaceSelection(state: SimplifiedState, value: string): void {
	const { from, to } = selectionBounds(state);
	state.chars.splice(from, to - from, value);
	const next = from + 1;
	state.anchor = next;
	state.head = next;
}

function selectionBounds(state: SimplifiedState): { from: number; to: number } {
	return {
		from: Math.min(state.anchor, state.head),
		to: Math.max(state.anchor, state.head),
	};
}

function setEditorSelection(
	editor: Editor,
	anchorOffset: number,
	headOffset: number,
	state: SimplifiedState,
): void {
	const positions = simplifiedOffsetPositions(editor, state);
	const anchor = positions[anchorOffset];
	const head = positions[headOffset];
	if (anchor == null || head == null) {
		throw new Error(
			`Could not map simplified selection ${anchorOffset}:${headOffset} into editor positions.`,
		);
	}

	const from = Math.min(anchor, head);
	const to = Math.max(anchor, head);
	if (from === to) {
		editor.commands.setTextSelection(from);
	} else {
		editor.commands.setTextSelection({ from, to });
	}
}

function simplifiedOffsetPositions(
	editor: Editor,
	state: SimplifiedState,
): number[] {
	const positions: number[] = [];
	let offset = 0;

	editor.state.doc.forEach((block, blockOffset, blockIndex) => {
		if (blockIndex > 0) {
			offset += 1;
		}

		let position = blockOffset + 1;
		positions[offset] = position;
		block.forEach((inline) => {
			if (inline.isText) {
				const text = inline.text ?? "";
				for (let index = 0; index < text.length; index += 1) {
					position += 1;
					offset += 1;
					positions[offset] = position;
				}
				return;
			}
			if (inline.type.name === "hardBreak") {
				position += inline.nodeSize;
				offset += 1;
				positions[offset] = position;
				return;
			}
			position += inline.nodeSize;
		});
	});

	if (positions.length !== state.chars.length + 1) {
		throw new Error(
			[
				"Editor position map does not match simplified state.",
				`expectedOffsets=${state.chars.length + 1}`,
				`actualOffsets=${positions.length}`,
				`simplified=${JSON.stringify(state.chars.join(""))}`,
				`doc=${JSON.stringify(editor.getJSON())}`,
			].join("\n"),
		);
	}

	return positions;
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
	if (!handled) {
		throw new Error(`Editor did not handle key: ${key}`);
	}
}

function assertMarkdownPlainTextMatches(
	editor: Editor,
	state: SimplifiedState,
	seed: string,
	index: number,
	operation: FuzzOperation,
): void {
	const markdown = buildMarkdownFromEditor(editor);
	const expected = state.chars.join("");
	const actual = renderPlainText(parseMarkdown(markdown));

	if (actual !== expected) {
		expect(actual, failureMessage()).toBe(expected);
	}

	function failureMessage(): string {
		return [
			"Markdown editor plain-text fuzz mismatch.",
			`seed=${seed}`,
			`operationIndex=${index}`,
			`operation=${JSON.stringify(operation)}`,
			`selection=${state.anchor}:${state.head}`,
			`expected=${JSON.stringify(expected)}`,
			`actual=${JSON.stringify(actual)}`,
			`markdown=${JSON.stringify(markdown)}`,
		].join("\n");
	}
}

function renderPlainText(ast: any): string {
	return (ast?.children ?? []).map(renderBlockPlainText).join(PARAGRAPH_BREAK);
}

function renderBlockPlainText(node: any): string {
	if (!node || typeof node !== "object") return "";
	if (
		node.type === "paragraph" &&
		isEmptyParagraphPlaceholder(node.children ?? [])
	) {
		return "";
	}
	if (Array.isArray(node.children)) {
		return node.children.map(renderInlinePlainText).join("");
	}
	return typeof node.value === "string" ? node.value : "";
}

function renderInlinePlainText(node: any): string {
	if (!node || typeof node !== "object") return "";
	if (node.type === "text" || node.type === "inlineCode") {
		return typeof node.value === "string" ? node.value : "";
	}
	if (node.type === "break") return HARD_BREAK;
	if (isHtmlHardBreak(node)) return HARD_BREAK;
	if (Array.isArray(node.children)) {
		return node.children.map(renderInlinePlainText).join("");
	}
	return "";
}

function isHtmlHardBreak(node: any): boolean {
	return (
		node?.type === "html" &&
		typeof node.value === "string" &&
		/^<br\s*\/?>$/i.test(node.value)
	);
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
