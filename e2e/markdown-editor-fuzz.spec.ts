import { expect, test, type Page } from "@playwright/test";
import seedrandom from "seedrandom";
import {
	applyOperationToSimplifiedState,
	buildOperationFailureMessage,
	buildPlainTextMismatchMessage,
	buildSelectionInvariantFailureMessage,
	createSimplifiedState,
	expectedPlainText,
	MARKDOWN_EDITOR_FUZZ_DEFAULT_SEED,
	MARKDOWN_EDITOR_FUZZ_OPERATION_COUNT,
	nextOperation,
	validateSimplifiedSelectionInvariant,
	type FuzzOperation,
	type MarkdownFuzzSnapshot,
} from "../src/extensions/markdown/editor/markdown-editor-fuzz";

const rendererPort = process.env.FLASHTYPE_E2E_RENDERER_PORT ?? "4173";
const rendererUrl = `http://127.0.0.1:${rendererPort}`;

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
			await applyOperationToPage(page, operation);
			applyOperationToSimplifiedState(state, operation);
		} catch (error) {
			const snapshot = await safeSnapshot(page);
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

function assertSnapshotSelectionMatches(
	snapshot: MarkdownFuzzSnapshot,
	state: ReturnType<typeof createSimplifiedState>,
	seed: string,
	index: number,
	operation: FuzzOperation,
): void {
	const reason = validateSimplifiedSelectionInvariant({
		state,
		positionCount: snapshot.positionCount,
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
			positionCount: snapshot.positionCount,
			domSelection: snapshot.domSelection,
			selection: snapshot.selection,
			editorJson: snapshot.editorJson,
		}),
	);
}

async function applyOperationToPage(
	page: Page,
	operation: FuzzOperation,
): Promise<void> {
	switch (operation.kind) {
		case "move":
			await setPageSelection(page, operation.anchor, operation.head);
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

async function setPageSelection(
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

async function safeSnapshot(page: Page): Promise<MarkdownFuzzSnapshot | null> {
	try {
		return await readSnapshot(page);
	} catch {
		return null;
	}
}
