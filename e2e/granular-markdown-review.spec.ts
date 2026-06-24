import { expect, test } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	closeElectronApp,
	ensureFilesViewOpenInLeftPanel,
	expectInstalledPluginArchives,
	launchDevElectronApp,
	registerRendererConsoleLogging,
} from "./electron-test-utils";

const INITIAL = "# Review\n\nAlpha paragraph.\n\nBeta paragraph.\n";
// First external write establishes a real "before" commit (the boot-ingested
// state has no observed commit id, which intentionally falls back to classic).
const V2 = "# Review\n\nAlpha v2.\n\nBeta v2.\n";
// Second external write edits both paragraphs relative to V2 -> two changes.
const V3 = "# Review\n\nAlpha v3.\n\nBeta v3.\n";
// Accept the first change, reject the second: the canonical Lix projection.
const EXPECTED = "# Review\n\nAlpha v3.\n\nBeta v2.\n";

test("accepts one block and rejects another in a granular Markdown review", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("workspace");
	const reviewPath = path.join(workspaceDir, "review.md");

	let electronApp: ElectronApplication | undefined;
	try {
		await mkdir(workspaceDir, { recursive: true });
		await writeFile(reviewPath, INITIAL);
		electronApp = await launchDevElectronApp(workspaceDir);

		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await expect(page.getByTestId("central-panel-empty-state")).toBeVisible();
		await expectInstalledPluginArchives(workspaceDir);
		await ensureFilesViewOpenInLeftPanel(page);

		// Open the file so it is ingested, then change it from outside the app.
		const reviewFile = page.getByTestId("file-tree-item-review-md");
		await expect(reviewFile).toBeVisible();
		await reviewFile.click();
		await expect(page.getByText("/review.md")).toBeVisible();
		// Wait for the initial content to be ingested and committed by Lix.
		await expect(page.getByText("Alpha paragraph.")).toBeVisible();
		await page.waitForTimeout(2500);

		// First external write: opens a review whose before-state is the boot
		// ingest (no observed commit id), so it uses the classic controls. This
		// establishes V2 as a real commit for the next review's before-state.
		await writeFile(reviewPath, V2);
		const overlay = page.locator(".markdown-review-overlay");
		await expect(overlay).toBeVisible({ timeout: 45_000 });
		await page.waitForTimeout(1000);

		// Second external write: edits both paragraphs relative to V2, so the
		// review now has a real before-commit and offers the granular stepper.
		await writeFile(reviewPath, V3);

		// The granular stepper should appear with two changes.
		const stepper = page.getByTestId("markdown-review-stepper");
		await expect(stepper).toBeVisible({ timeout: 45_000 });
		await expect(stepper.getByText("1 of 2", { exact: true })).toBeVisible();

		// Accept the first change, then reject the second; the review auto-applies.
		await stepper.getByRole("button", { name: /Accept/ }).click();
		await expect(stepper.getByText("2 of 2", { exact: true })).toBeVisible();
		await stepper.getByRole("button", { name: /Reject/ }).click();

		// The overlay closes once the mixed result is applied.
		await expect(stepper).toBeHidden({ timeout: 30_000 });

		// The file on disk holds exactly the canonical mixed projection.
		await expect
			.poll(async () => await readFile(reviewPath, "utf8"), {
				timeout: 30_000,
			})
			.toBe(EXPECTED);

		// The internal resolution write must not reopen a second review.
		await page.waitForTimeout(1500);
		await expect(page.getByTestId("markdown-review-stepper")).toHaveCount(0);
	} finally {
		await closeElectronApp(electronApp);
	}
});
