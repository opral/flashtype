import { expect, test, type Page } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import seedrandom from "seedrandom";
import {
	applyOperationToSimplifiedState,
	buildOperationFailureMessage,
	buildPlainTextMismatchMessage,
	buildSelectionInvariantFailureMessage,
	createSimplifiedState,
	expectedPlainText,
	MARKDOWN_EDITOR_FUZZ_DEFAULT_SEED,
	MARKDOWN_EDITOR_FUZZ_HARD_BREAK,
	MARKDOWN_EDITOR_FUZZ_OPERATION_COUNT,
	MARKDOWN_EDITOR_FUZZ_PARAGRAPH_BREAK,
	nextOperation,
	renderPlainTextFromMarkdown,
	validateSimplifiedSelectionInvariant,
	type FuzzOperation,
	type MarkdownFuzzSnapshot,
	type SimplifiedSelection,
	type SimplifiedState,
} from "../src/extensions/markdown/editor/markdown-editor-fuzz";
import {
	closeElectronApp,
	ensureFilesViewOpenInLeftPanel,
	fileTreeFile,
	launchDevElectronApp,
	registerRendererConsoleLogging,
} from "./electron-test-utils";

const rendererPort = process.env.FLASHTYPE_E2E_RENDERER_PORT ?? "4173";
const rendererUrl = `http://127.0.0.1:${rendererPort}`;
const uiFuzzFilePath = "/fuzz.md";

test.setTimeout(600_000);

test("fuzzes markdown editor plain text in a real browser", async ({
	page,
}) => {
	const seed =
		process.env.FLASHTYPE_MARKDOWN_FUZZ_SEED ??
		MARKDOWN_EDITOR_FUZZ_DEFAULT_SEED;
	const rng = seedrandom(seed);
	const state = createSimplifiedState();

	await page.goto(`${rendererUrl}/?e2e=markdown-editor-fuzz`);
	await expect(page.getByTestId("markdown-editor-fuzz-harness")).toBeVisible();
	await page.waitForFunction(() =>
		Boolean((window as any).__flashtypeMarkdownFuzz),
	);

	for (
		let index = 0;
		index < MARKDOWN_EDITOR_FUZZ_OPERATION_COUNT;
		index += 1
	) {
		const operation = nextOperation(rng, state);
		try {
			await applyOperationToHarnessPage(page, operation);
			applyOperationToSimplifiedState(state, operation);
		} catch (error) {
			const snapshot = await safeHarnessSnapshot(page);
			throw new Error(
				buildOperationFailureMessage({
					seed,
					index,
					operation,
					state,
					editorJson: snapshot?.editorJson,
					cause: error,
				}),
			);
		}

		const snapshot = await readSnapshot(page);
		assertSnapshotSelectionMatches(snapshot, state, seed, index, operation);
		const expected = expectedPlainText(state);
		if (snapshot.plainText !== expected) {
			throw new Error(
				buildPlainTextMismatchMessage({
					seed,
					index,
					operation,
					state,
					expected,
					actual: snapshot.plainText,
					markdown: snapshot.markdown,
					editorJson: snapshot.editorJson,
				}),
			);
		}
	}
});

test("fuzzes markdown editor plain text through the Flashtype UI", async ({
	browserName: _browserName,
}, testInfo) => {
	const operationCount = 300;
	const seed = testInfo.repeatEachIndex;
	const rng = seedrandom(seed.toString());
	const state = createSimplifiedState();
	const workspaceDir = testInfo.outputPath("workspace-ui-fuzz");
	const fuzzFile = path.join(workspaceDir, "fuzz.md");

	let electronApp: ElectronApplication | undefined;
	try {
		await mkdir(workspaceDir, { recursive: true });
		await writeFile(fuzzFile, "", "utf8");
		electronApp = await launchDevElectronApp(workspaceDir);

		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await expect(page.getByTestId("central-panel-empty-state")).toBeVisible();
		await ensureFilesViewOpenInLeftPanel(page);
		const file = fileTreeFile(page, uiFuzzFilePath);
		await expect(file).toBeVisible();
		await file.click();
		await expect(file).toHaveAttribute("data-item-selected", "true");

		const editor = page.locator('[data-testid="tiptap-editor"] .ProseMirror');
		await expect(editor).toBeVisible();
		await editor.click();
		await installUiFuzzDomHelpers(page);
		await setUiEditorSelection(page, 0, 0);

		for (let index = 0; index < operationCount; index += 1) {
			const operation = nextOperation(rng, state);
			try {
				await applyOperationToUiPage(page, operation);
				applyOperationToSimplifiedState(state, operation);
				const delayMs = Math.floor(rng() * (1000 + 1));
				await page.waitForTimeout(delayMs);
			} catch (error) {
				const snapshot = await safeUiSnapshot(page);
				throw new Error(
					buildUiOperationFailureMessage({
						seed: seed,
						index,
						operation,
						state,
						snapshot,
						cause: error,
					}),
				);
			}

			const snapshot = await readUiSnapshot(page);
			assertUiSnapshotSelectionMatches(snapshot, state, seed, index, operation);
			const expected = expectedPlainText(state);
			if (snapshot.plainText !== expected) {
				throw new Error(
					buildUiPlainTextMismatchMessage({
						seed: seed,
						index,
						operation,
						state,
						expected,
						actual: snapshot.plainText,
						snapshot,
					}),
				);
			}
		}

		const finalPlainText = expectedPlainText(state);
		await expect
			.poll(async () => {
				const markdown = await readPersistedMarkdown(page, uiFuzzFilePath);
				return markdown == null ? null : renderPlainTextFromMarkdown(markdown);
			})
			.toBe(finalPlainText);

		const persistedMarkdown = await readPersistedMarkdown(page, uiFuzzFilePath);
		expect(persistedMarkdown).not.toBeNull();
		await expect
			.poll(async () => await readFile(fuzzFile, "utf8"))
			.toBe(persistedMarkdown);
	} finally {
		await closeElectronApp(electronApp);
	}
});

function assertSnapshotSelectionMatches(
	snapshot: MarkdownFuzzSnapshot,
	state: SimplifiedState,
	seed: number,
	index: number,
	operation: FuzzOperation,
): void {
	const reason = validateSimplifiedSelectionInvariant({
		state,
		positions: snapshot.positions,
		docSize: snapshot.docSize,
		domSelection: snapshot.domSelection,
		selection: snapshot.selection,
	});

	if (!reason) return;

	throw new Error(
		buildSelectionInvariantFailureMessage({
			seed,
			index,
			operation,
			state,
			reason,
			positions: snapshot.positions,
			docSize: snapshot.docSize,
			domSelection: snapshot.domSelection,
			selection: snapshot.selection,
			editorJson: snapshot.editorJson,
		}),
	);
}

async function applyOperationToHarnessPage(
	page: Page,
	operation: FuzzOperation,
): Promise<void> {
	switch (operation.kind) {
		case "move":
			await setHarnessPageSelection(page, operation.anchor, operation.head);
			return;
		case "type":
			await page.keyboard.type(operation.value);
			return;
		case "enter":
			await page.keyboard.press("Enter");
			return;
		case "shiftEnter":
			await page.keyboard.press("Shift+Enter");
			return;
		case "left":
			await page.keyboard.press("ArrowLeft");
			return;
		case "right":
			await page.keyboard.press("ArrowRight");
			return;
	}
}

async function applyOperationToUiPage(
	page: Page,
	operation: FuzzOperation,
): Promise<void> {
	switch (operation.kind) {
		case "move":
			await setUiEditorSelection(page, operation.anchor, operation.head);
			return;
		case "type":
			await page.keyboard.type(operation.value);
			return;
		case "enter":
			await page.keyboard.press("Enter");
			return;
		case "shiftEnter":
			await page.keyboard.press("Shift+Enter");
			return;
		case "left":
			await page.keyboard.press("ArrowLeft");
			return;
		case "right":
			await page.keyboard.press("ArrowRight");
			return;
	}
}

async function setHarnessPageSelection(
	page: Page,
	anchor: number,
	head: number,
): Promise<void> {
	await page.evaluate(
		({ anchor, head }) => {
			(window as any).__flashtypeMarkdownFuzz.setSelection(anchor, head);
		},
		{ anchor, head },
	);
}

async function readSnapshot(page: Page): Promise<MarkdownFuzzSnapshot> {
	return await page.evaluate(() => {
		const api = (window as any).__flashtypeMarkdownFuzz;
		if (!api) throw new Error("Markdown fuzz harness API is not available.");
		return api.snapshot();
	});
}

async function safeHarnessSnapshot(
	page: Page,
): Promise<MarkdownFuzzSnapshot | null> {
	try {
		return await readSnapshot(page);
	} catch {
		return null;
	}
}

type UiMarkdownFuzzSnapshot = {
	plainText: string;
	selection: SimplifiedSelection | null;
	editorText: string;
	editorHtml: string;
};

async function setUiEditorSelection(
	page: Page,
	anchor: number,
	head: number,
): Promise<void> {
	await page.evaluate(
		({ anchor, head }) => {
			const api = (window as any).__flashtypeUiMarkdownFuzz;
			if (!api) throw new Error("Markdown UI fuzz DOM API is not installed.");
			api.setSelection(anchor, head);
		},
		{ anchor, head },
	);
}

async function readUiSnapshot(page: Page): Promise<UiMarkdownFuzzSnapshot> {
	return await page.evaluate(() => {
		const api = (window as any).__flashtypeUiMarkdownFuzz;
		if (!api) throw new Error("Markdown UI fuzz DOM API is not installed.");
		return api.snapshot();
	});
}

async function safeUiSnapshot(
	page: Page,
): Promise<UiMarkdownFuzzSnapshot | null> {
	try {
		return await readUiSnapshot(page);
	} catch {
		return null;
	}
}

async function readPersistedMarkdown(
	page: Page,
	filePath: string,
): Promise<string | null> {
	return await page.evaluate(async (pathToFind) => {
		const queryResult = await window.flashtypeDesktop?.lix.execute({
			sql: "SELECT data FROM lix_file WHERE path = $1",
			params: [pathToFind],
		});
		const value = queryResult?.rows?.[0]?.[0];
		if (value == null) return null;
		if (value instanceof Uint8Array) {
			return new TextDecoder().decode(value);
		}
		if (value instanceof ArrayBuffer) {
			return new TextDecoder().decode(new Uint8Array(value));
		}
		if (Array.isArray(value)) {
			return new TextDecoder().decode(new Uint8Array(value as number[]));
		}
		if (typeof value === "string") return value;
		return null;
	}, filePath);
}

function markdownUiFuzzOperationCount(): number {
	const raw = process.env.FLASHTYPE_MARKDOWN_UI_FUZZ_OPERATION_COUNT;
	if (!raw) return MARKDOWN_EDITOR_FUZZ_OPERATION_COUNT;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0
		? parsed
		: MARKDOWN_EDITOR_FUZZ_OPERATION_COUNT;
}

function buildUiOperationFailureMessage(args: {
	seed: number;
	index: number;
	operation: FuzzOperation;
	state: SimplifiedState;
	snapshot: UiMarkdownFuzzSnapshot | null;
	cause: unknown;
}): string {
	return [
		"Markdown editor UI fuzz operation failed.",
		`seed=${args.seed}`,
		`operationIndex=${args.index}`,
		`operation=${JSON.stringify(args.operation)}`,
		`selection=${args.state.anchor}:${args.state.head}`,
		`simplified=${JSON.stringify(expectedPlainText(args.state))}`,
		args.snapshot ? formatUiSnapshot(args.snapshot) : null,
		`cause=${
			args.cause instanceof Error ? args.cause.message : String(args.cause)
		}`,
	]
		.filter((line): line is string => line != null)
		.join("\n");
}

function buildUiPlainTextMismatchMessage(args: {
	seed: number;
	index: number;
	operation: FuzzOperation;
	state: SimplifiedState;
	expected: string;
	actual: string;
	snapshot: UiMarkdownFuzzSnapshot;
}): string {
	return [
		"Markdown editor UI plain-text fuzz mismatch.",
		`seed=${args.seed}`,
		`operationIndex=${args.index}`,
		`operation=${JSON.stringify(args.operation)}`,
		`selection=${args.state.anchor}:${args.state.head}`,
		`expected=${JSON.stringify(args.expected)}`,
		`actual=${JSON.stringify(args.actual)}`,
		formatUiSnapshot(args.snapshot),
	].join("\n");
}

function assertUiSnapshotSelectionMatches(
	snapshot: UiMarkdownFuzzSnapshot,
	state: SimplifiedState,
	seed: number,
	index: number,
	operation: FuzzOperation,
): void {
	if (
		snapshot.selection &&
		snapshot.selection.anchor === state.anchor &&
		snapshot.selection.head === state.head
	) {
		return;
	}

	throw new Error(
		buildUiSelectionMismatchMessage({
			seed,
			index,
			operation,
			state,
			snapshot,
		}),
	);
}

function buildUiSelectionMismatchMessage(args: {
	seed: number;
	index: number;
	operation: FuzzOperation;
	state: SimplifiedState;
	snapshot: UiMarkdownFuzzSnapshot;
}): string {
	return [
		"Markdown editor UI selection fuzz mismatch.",
		`seed=${args.seed}`,
		`operationIndex=${args.index}`,
		`operation=${JSON.stringify(args.operation)}`,
		`expectedSelection=${args.state.anchor}:${args.state.head}`,
		formatUiSnapshot(args.snapshot),
		`simplified=${JSON.stringify(expectedPlainText(args.state))}`,
	].join("\n");
}

function formatUiSnapshot(snapshot: UiMarkdownFuzzSnapshot): string {
	return [
		`snapshotSelection=${formatUiSelection(snapshot.selection)}`,
		`editorText=${JSON.stringify(snapshot.editorText)}`,
		`editorHtml=${JSON.stringify(snapshot.editorHtml)}`,
	].join("\n");
}

function formatUiSelection(selection: SimplifiedSelection | null): string {
	return selection
		? `${selection.anchor}:${selection.head} (${selection.rawAnchor}:${selection.rawHead})`
		: "<unmapped>";
}

async function installUiFuzzDomHelpers(page: Page): Promise<void> {
	await page.evaluate(
		({ hardBreak, paragraphBreak }) => {
			(window as any).__flashtypeUiMarkdownFuzz = {
				setSelection(anchor: number, head: number) {
					const editor = requireProseMirrorEditor();
					const map = buildSimplifiedDomMap(editor);
					const anchorPoint = map.positions[anchor];
					const headPoint = map.positions[head];
					if (!anchorPoint || !headPoint) {
						throw new Error(
							`Could not map simplified selection ${anchor}:${head} into editor DOM positions.`,
						);
					}

					editor.focus({ preventScroll: true });
					const selection = window.getSelection();
					if (!selection) {
						throw new Error("Window selection is not available.");
					}
					selection.removeAllRanges();
					if (typeof selection.setBaseAndExtent === "function") {
						selection.setBaseAndExtent(
							anchorPoint.node,
							anchorPoint.offset,
							headPoint.node,
							headPoint.offset,
						);
					} else {
						const range = document.createRange();
						if (anchor <= head) {
							range.setStart(anchorPoint.node, anchorPoint.offset);
							range.setEnd(headPoint.node, headPoint.offset);
						} else {
							range.setStart(headPoint.node, headPoint.offset);
							range.setEnd(anchorPoint.node, anchorPoint.offset);
						}
						selection.addRange(range);
					}
					editor.dispatchEvent(new Event("selectionchange", { bubbles: true }));
				},
				snapshot() {
					const editor = requireProseMirrorEditor();
					const map = buildSimplifiedDomMap(editor);
					return {
						plainText: map.plainText,
						selection: simplifiedSelectionFromWindow(editor),
						editorText: editor.textContent ?? "",
						editorHtml: editor.innerHTML,
					};
				},
			};

			function requireProseMirrorEditor(): HTMLElement {
				const editor = document.querySelector(
					'[data-testid="tiptap-editor"] .ProseMirror',
				);
				if (!(editor instanceof HTMLElement)) {
					throw new Error("Active ProseMirror editor is not available.");
				}
				return editor;
			}

			function buildSimplifiedDomMap(editor: HTMLElement): {
				plainText: string;
				positions: Array<{ node: Node; offset: number } | undefined>;
			} {
				const positions: Array<{ node: Node; offset: number } | undefined> = [];
				const chunks: string[] = [];
				let offset = 0;

				const blocks = Array.from(editor.children);
				if (blocks.length === 0) {
					positions[0] = { node: editor, offset: 0 };
					return { plainText: "", positions };
				}

				blocks.forEach((block, blockIndex) => {
					if (blockIndex > 0) {
						offset += 1;
						chunks.push(paragraphBreak);
					}
					positions[offset] = startPointForBlock(block);
					visitInlineDom(block, (unit, point) => {
						chunks.push(unit);
						offset += 1;
						positions[offset] = point;
					});
				});

				return { plainText: chunks.join(""), positions };
			}

			function startPointForBlock(block: Element): {
				node: Node;
				offset: number;
			} {
				return { node: block, offset: 0 };
			}

			function visitInlineDom(
				node: Node,
				visit: (
					unit: string,
					pointAfterUnit: { node: Node; offset: number },
				) => void,
			): void {
				if (node.nodeType === Node.TEXT_NODE) {
					const text = node.textContent ?? "";
					for (let index = 0; index < text.length; index += 1) {
						visit(text[index] ?? "", { node, offset: index + 1 });
					}
					return;
				}

				if (!(node instanceof Element)) return;
				if (node.tagName === "BR") {
					if (!node.classList.contains("ProseMirror-trailingBreak")) {
						const parent = node.parentNode;
						visit(hardBreak, {
							node: parent ?? node,
							offset: parent ? childOffset(node) + 1 : 0,
						});
					}
					return;
				}

				for (const child of Array.from(node.childNodes)) {
					visitInlineDom(child, visit);
				}
			}

			function simplifiedSelectionFromWindow(
				editor: HTMLElement,
			): SimplifiedSelection | null {
				const selection = window.getSelection();
				if (
					!selection?.anchorNode ||
					!selection.focusNode ||
					!editor.contains(selection.anchorNode) ||
					!editor.contains(selection.focusNode)
				) {
					return null;
				}

				const anchor = simplifiedOffsetFromDomPoint(
					editor,
					selection.anchorNode,
					selection.anchorOffset,
				);
				const head = simplifiedOffsetFromDomPoint(
					editor,
					selection.focusNode,
					selection.focusOffset,
				);
				if (anchor == null || head == null) return null;
				return {
					anchor,
					head,
					rawAnchor: anchor,
					rawHead: head,
				};
			}

			function simplifiedOffsetFromDomPoint(
				editor: HTMLElement,
				targetNode: Node,
				targetOffset: number,
			): number | null {
				if (targetNode === editor && targetOffset === 0) return 0;
				const blocks = Array.from(editor.children);
				let offset = 0;

				for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
					const block = blocks[blockIndex]!;
					if (blockIndex > 0) {
						offset += 1;
					}
					if (targetNode === block && targetOffset === 0) return offset;
					const resolved = offsetFromInlineDomPoint(
						block,
						targetNode,
						targetOffset,
						offset,
					);
					if (resolved.found) return resolved.offset;
					offset = resolved.offset;
					if (targetNode === block && targetOffset >= block.childNodes.length) {
						return offset;
					}
				}

				if (targetNode === editor && targetOffset >= editor.childNodes.length) {
					return offset;
				}
				return null;
			}

			function offsetFromInlineDomPoint(
				node: Node,
				targetNode: Node,
				targetOffset: number,
				startOffset: number,
			): { found: boolean; offset: number } {
				let offset = startOffset;

				if (node.nodeType === Node.TEXT_NODE) {
					const textLength = node.textContent?.length ?? 0;
					if (node === targetNode) {
						return {
							found: true,
							offset: offset + Math.max(0, Math.min(targetOffset, textLength)),
						};
					}
					return { found: false, offset: offset + textLength };
				}

				if (!(node instanceof Element)) {
					return { found: false, offset };
				}

				if (node.tagName === "BR") {
					return {
						found: false,
						offset: node.classList.contains("ProseMirror-trailingBreak")
							? offset
							: offset + 1,
					};
				}

				const children = Array.from(node.childNodes);
				if (node === targetNode && targetOffset === 0) {
					return { found: true, offset };
				}

				for (let index = 0; index < children.length; index += 1) {
					if (node === targetNode && targetOffset === index) {
						return { found: true, offset };
					}
					const child = children[index]!;
					const childResult = offsetFromInlineDomPoint(
						child,
						targetNode,
						targetOffset,
						offset,
					);
					if (childResult.found) return childResult;
					offset = childResult.offset;
					if (node === targetNode && targetOffset === index + 1) {
						return { found: true, offset };
					}
				}

				if (node === targetNode && targetOffset >= children.length) {
					return { found: true, offset };
				}
				return { found: false, offset };
			}

			function childOffset(node: Node): number {
				const parent = node.parentNode;
				return parent ? Array.from(parent.childNodes).indexOf(node) : 0;
			}
		},
		{
			hardBreak: MARKDOWN_EDITOR_FUZZ_HARD_BREAK,
			paragraphBreak: MARKDOWN_EDITOR_FUZZ_PARAGRAPH_BREAK,
		},
	);
}
