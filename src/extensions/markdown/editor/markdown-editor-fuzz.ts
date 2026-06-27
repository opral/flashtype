import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { parseMarkdown } from "./markdown";

export const MARKDOWN_EDITOR_FUZZ_PARAGRAPH_BREAK = "\x1E";
export const MARKDOWN_EDITOR_FUZZ_HARD_BREAK = "\n";
export const MARKDOWN_EDITOR_FUZZ_OPERATION_COUNT = 10_000;
export const MARKDOWN_EDITOR_FUZZ_DEFAULT_SEED =
	"markdown-editor-plain-text-fuzz-v1";

export type SimplifiedState = {
	chars: string[];
	anchor: number;
	head: number;
};

export type SimplifiedSelection = {
	anchor: number;
	head: number;
	rawAnchor: number;
	rawHead: number;
};

export type FuzzOperation =
	| { kind: "type"; value: string }
	| { kind: "enter" }
	| { kind: "shiftEnter" }
	| { kind: "left" }
	| { kind: "right" }
	| { kind: "move"; anchor: number; head: number };

export type MarkdownFuzzSnapshot = {
	markdown: string;
	plainText: string;
	editorJson: unknown;
	positionCount: number;
	domSelection: SimplifiedSelection | null;
	selection: SimplifiedSelection | null;
};

type RandomSource = () => number;
type ArrowDirection = "left" | "right";

export function createSimplifiedState(): SimplifiedState {
	return { chars: [], anchor: 0, head: 0 };
}

export function nextOperation(
	rng: RandomSource,
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

function randomOffset(rng: RandomSource, state: SimplifiedState): number {
	return Math.floor(rng() * (state.chars.length + 1));
}

export function applyOperationToSimplifiedState(
	state: SimplifiedState,
	operation: FuzzOperation,
): void {
	switch (operation.kind) {
		case "type":
			replaceSelection(state, operation.value);
			return;
		case "enter":
			replaceSelection(state, MARKDOWN_EDITOR_FUZZ_PARAGRAPH_BREAK);
			return;
		case "shiftEnter":
			replaceSelection(state, MARKDOWN_EDITOR_FUZZ_HARD_BREAK);
			return;
		case "left": {
			const next = nextSimplifiedArrowSelection(state, "left");
			state.anchor = next.anchor;
			state.head = next.head;
			return;
		}
		case "right": {
			const next = nextSimplifiedArrowSelection(state, "right");
			state.anchor = next.anchor;
			state.head = next.head;
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

export function selectionBounds(state: SimplifiedState): {
	from: number;
	to: number;
} {
	return {
		from: Math.min(state.anchor, state.head),
		to: Math.max(state.anchor, state.head),
	};
}

export function nextSimplifiedArrowSelection(
	state: SimplifiedState,
	direction: ArrowDirection,
): { anchor: number; head: number } {
	const { from, to } = selectionBounds(state);
	if (from !== to) {
		const next = direction === "left" ? from : to;
		return { anchor: next, head: next };
	}

	const next =
		direction === "left"
			? Math.max(0, from - 1)
			: Math.min(state.chars.length, to + 1);
	return { anchor: next, head: next };
}

export function expectedPlainText(state: SimplifiedState): string {
	return state.chars.join("");
}

export function renderPlainTextFromMarkdown(markdown: string): string {
	return renderPlainText(parseMarkdown(markdown));
}

export function renderPlainText(ast: any): string {
	return (ast?.children ?? [])
		.map(renderBlockPlainText)
		.join(MARKDOWN_EDITOR_FUZZ_PARAGRAPH_BREAK);
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
	if (node.type === "break") return MARKDOWN_EDITOR_FUZZ_HARD_BREAK;
	if (isHtmlHardBreak(node)) return MARKDOWN_EDITOR_FUZZ_HARD_BREAK;
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

export function setEditorSelectionBySimplifiedOffset(
	editor: Editor,
	anchorOffset: number,
	headOffset: number,
): void {
	const positions = simplifiedOffsetPositions(editor);
	const anchor = positions[anchorOffset];
	const head = positions[headOffset];
	if (anchor == null || head == null) {
		throw new Error(
			`Could not map simplified selection ${anchorOffset}:${headOffset} into editor positions.`,
		);
	}

	editor.view.dispatch(
		editor.state.tr.setSelection(
			TextSelection.create(editor.state.doc, anchor, head),
		),
	);
}

export function simplifiedOffsetPositions(editor: Editor): number[] {
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

	return positions;
}

export function simplifiedSelectionFromEditor(
	editor: Editor,
): MarkdownFuzzSnapshot["selection"] {
	const { anchor: rawAnchor, head: rawHead } = editor.state.selection as any;
	return simplifiedSelectionFromRawPositions(editor, rawAnchor, rawHead);
}

export function simplifiedSelectionFromDom(
	editor: Editor,
): MarkdownFuzzSnapshot["domSelection"] {
	const view = editor.view as any;
	const domSelection = view.domSelectionRange?.();
	if (
		!domSelection?.anchorNode ||
		!domSelection?.focusNode ||
		!isNodeInsideEditor(editor.view.dom, domSelection.anchorNode) ||
		!isNodeInsideEditor(editor.view.dom, domSelection.focusNode)
	) {
		return null;
	}

	const rawAnchor = view.docView?.posFromDOM?.(
		domSelection.anchorNode,
		domSelection.anchorOffset,
		1,
	);
	const rawHead = view.docView?.posFromDOM?.(
		domSelection.focusNode,
		domSelection.focusOffset,
		1,
	);
	if (
		typeof rawAnchor !== "number" ||
		typeof rawHead !== "number" ||
		rawAnchor < 0 ||
		rawHead < 0
	) {
		return null;
	}

	return simplifiedSelectionFromRawPositions(editor, rawAnchor, rawHead);
}

function isNodeInsideEditor(editorDom: HTMLElement, node: Node): boolean {
	const element = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
	return Boolean(element && editorDom.contains(element));
}

function simplifiedSelectionFromRawPositions(
	editor: Editor,
	rawAnchor: number,
	rawHead: number,
): SimplifiedSelection | null {
	const positions = simplifiedOffsetPositions(editor);
	const anchor = positions.indexOf(rawAnchor);
	const head = positions.indexOf(rawHead);
	if (anchor < 0 || head < 0) {
		return null;
	}
	return { anchor, head, rawAnchor, rawHead };
}

export function validateEditorPositionMap(
	editor: Editor,
	state: SimplifiedState,
): void {
	const positions = simplifiedOffsetPositions(editor);
	if (positions.length === state.chars.length + 1) return;

	throw new Error(
		[
			"Editor position map does not match simplified state.",
			`expectedOffsets=${state.chars.length + 1}`,
			`actualOffsets=${positions.length}`,
			`simplified=${JSON.stringify(expectedPlainText(state))}`,
			`doc=${JSON.stringify(editor.getJSON())}`,
		].join("\n"),
	);
}

export function validateSimplifiedSelectionInvariant(args: {
	state: SimplifiedState;
	positionCount: number;
	domSelection?: MarkdownFuzzSnapshot["domSelection"];
	selection: MarkdownFuzzSnapshot["selection"];
}): string | null {
	const expectedPositionCount = args.state.chars.length + 1;
	if (args.positionCount !== expectedPositionCount) {
		return [
			"Editor position map does not match simplified state.",
			`expectedOffsets=${expectedPositionCount}`,
			`actualOffsets=${args.positionCount}`,
		].join("\n");
	}

	if (args.domSelection !== undefined) {
		const domReason = validateSelectionMatchesState(
			"DOM selection",
			args.domSelection,
			args.state,
		);
		if (domReason) return domReason;
	}

	const editorReason = validateSelectionMatchesState(
		"Editor selection",
		args.selection,
		args.state,
	);
	if (editorReason) return editorReason;

	if (
		args.domSelection &&
		args.selection &&
		(args.domSelection.anchor !== args.selection.anchor ||
			args.domSelection.head !== args.selection.head)
	) {
		return [
			"DOM selection and editor selection do not agree.",
			`domSelection=${formatSelection(args.domSelection)}`,
			`editorSelection=${formatSelection(args.selection)}`,
		].join("\n");
	}

	return null;
}

function validateSelectionMatchesState(
	label: string,
	selection: SimplifiedSelection | null,
	state: SimplifiedState,
): string | null {
	if (!selection) {
		return `${label} does not map to a simplified offset.`;
	}

	if (selection.anchor !== state.anchor || selection.head !== state.head) {
		return [
			`${label} does not match simplified state.`,
			`expectedSelection=${state.anchor}:${state.head}`,
			`actualSelection=${selection.anchor}:${selection.head}`,
			`rawSelection=${selection.rawAnchor}:${selection.rawHead}`,
		].join("\n");
	}

	return null;
}

function formatSelection(selection: SimplifiedSelection | null): string {
	return selection
		? `${selection.anchor}:${selection.head} (${selection.rawAnchor}:${selection.rawHead})`
		: "<unmapped>";
}

export function buildSelectionInvariantFailureMessage(args: {
	seed: string;
	index: number;
	operation: FuzzOperation;
	state: SimplifiedState;
	reason: string;
	positionCount: number;
	domSelection?: MarkdownFuzzSnapshot["domSelection"];
	selection: MarkdownFuzzSnapshot["selection"];
	editorJson?: unknown;
}): string {
	return [
		"Markdown editor selection fuzz invariant failed.",
		`seed=${args.seed}`,
		`operationIndex=${args.index}`,
		`operation=${JSON.stringify(args.operation)}`,
		`expectedSelection=${args.state.anchor}:${args.state.head}`,
		args.domSelection === undefined
			? null
			: `domSelection=${formatSelection(args.domSelection)}`,
		`editorSelection=${formatSelection(args.selection)}`,
		`positionCount=${args.positionCount}`,
		`simplified=${JSON.stringify(expectedPlainText(args.state))}`,
		`reason=${args.reason}`,
		args.editorJson === undefined
			? null
			: `doc=${JSON.stringify(args.editorJson)}`,
	]
		.filter((line): line is string => line != null)
		.join("\n");
}

export function buildOperationFailureMessage(args: {
	seed: string;
	index: number;
	operation: FuzzOperation;
	state: SimplifiedState;
	editorJson?: unknown;
	cause: unknown;
}): string {
	return [
		"Markdown editor fuzz operation failed.",
		`seed=${args.seed}`,
		`operationIndex=${args.index}`,
		`operation=${JSON.stringify(args.operation)}`,
		`selection=${args.state.anchor}:${args.state.head}`,
		`simplified=${JSON.stringify(expectedPlainText(args.state))}`,
		args.editorJson === undefined
			? null
			: `doc=${JSON.stringify(args.editorJson)}`,
		`cause=${
			args.cause instanceof Error ? args.cause.message : String(args.cause)
		}`,
	]
		.filter((line): line is string => line != null)
		.join("\n");
}

export function buildPlainTextMismatchMessage(args: {
	seed: string;
	index: number;
	operation: FuzzOperation;
	state: SimplifiedState;
	expected: string;
	actual: string;
	markdown: string;
	editorJson?: unknown;
}): string {
	return [
		"Markdown editor plain-text fuzz mismatch.",
		`seed=${args.seed}`,
		`operationIndex=${args.index}`,
		`operation=${JSON.stringify(args.operation)}`,
		`selection=${args.state.anchor}:${args.state.head}`,
		`expected=${JSON.stringify(args.expected)}`,
		`actual=${JSON.stringify(args.actual)}`,
		`markdown=${JSON.stringify(args.markdown)}`,
		args.editorJson === undefined
			? null
			: `doc=${JSON.stringify(args.editorJson)}`,
	]
		.filter((line): line is string => line != null)
		.join("\n");
}
