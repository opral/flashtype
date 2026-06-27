import { expect, test } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import type { Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	closeElectronApp,
	ensureFilesViewOpenInLeftPanel,
	launchDevElectronApp,
	registerRendererConsoleLogging,
	seedTrackChangesWorkspace,
} from "./electron-test-utils";

const INITIAL = "# Review\n\nAlpha paragraph.\n\nBeta paragraph.\n";
// One agent turn touching both paragraphs -> two granular changes.
const EDIT = "# Review\n\nAlpha v2.\n\nBeta v2.\n";
// Accept the first change, reject the second.
const EXPECTED = "# Review\n\nAlpha v2.\n\nBeta paragraph.\n";

// Open a tracked (Track Changes) folder with the review file already ingested.
async function openReviewFile(testInfo: {
	outputPath: (name: string) => string;
}): Promise<{ app: ElectronApplication; page: Page; reviewPath: string }> {
	const dir = testInfo.outputPath("workspace");
	const reviewPath = path.join(dir, "review.md");
	await mkdir(dir, { recursive: true });
	seedTrackChangesWorkspace(dir);
	await writeFile(reviewPath, INITIAL);

	const app = await launchDevElectronApp(dir);
	const page = await app.firstWindow();
	registerRendererConsoleLogging(page);
	await expect(page.getByTestId("central-panel-empty-state")).toBeVisible({
		timeout: 45_000,
	});
	await ensureFilesViewOpenInLeftPanel(page);
	await page.getByTestId("file-tree-item-review-md").click();
	await expect(page.getByText("Alpha paragraph.")).toBeVisible({
		timeout: 30_000,
	});
	return { app, page, reviewPath };
}

// TODO(agent-turn-review): upstream replaced the renderer-side external-write
// detector with an agent-turn commit-range model, where a review only appears
// after an agent (Claude/Codex) turn records a before/after commit range. Like
// upstream's own `agent-review.spec.ts`, exercising that end to end needs a fake
// agent helper. The granular decision layer itself (planner, per-change stepper,
// projection contract, atomic apply) is covered by the unit suites; re-enable
// these once an agent-turn fixture is available in E2E.
test.skip("accepts one block and rejects another on the first agent-turn Markdown edit", async ({
	browserName: _browserName,
}, testInfo) => {
	let app: ElectronApplication | undefined;
	try {
		const opened = await openReviewFile(testInfo);
		app = opened.app;
		const { page, reviewPath } = opened;

		await writeFile(reviewPath, EDIT);

		const overlay = page.locator(".markdown-review-overlay");
		await expect(overlay).toBeVisible({ timeout: 45_000 });
		const stepper = page.getByTestId("markdown-review-stepper");
		await expect(stepper).toBeVisible({ timeout: 45_000 });
		await expect(stepper.getByText("1 of 2", { exact: true })).toBeVisible();

		await stepper.getByRole("button", { name: /Accept/ }).click();
		await expect(stepper.getByText("2 of 2", { exact: true })).toBeVisible();
		await stepper.getByRole("button", { name: /Reject/ }).click();

		await expect(overlay).toBeHidden({ timeout: 30_000 });
		await expect
			.poll(async () => await readFile(reviewPath, "utf8"), { timeout: 30_000 })
			.toBe(EXPECTED);
		await expect(page.locator(".markdown-review-overlay")).toHaveCount(0);
		await expect(page.getByText("Alpha v2.")).toBeVisible();
	} finally {
		await closeElectronApp(app);
	}
});
