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
// A single external edit changes both paragraphs -> two granular changes. The
// app establishes a tracked baseline for the file at ingest, so even this very
// first external write offers the per-change stepper (no warm-up write needed).
const EDIT = "# Review\n\nAlpha v2.\n\nBeta v2.\n";
// Accept the first change, reject the second: the canonical mixed projection.
const EXPECTED = "# Review\n\nAlpha v2.\n\nBeta paragraph.\n";

test("accepts one block and rejects another on the first external Markdown edit", async ({
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

		// Open the file so it is ingested and rendered; this also confirms the
		// workspace baseline had a chance to materialize before the external edit.
		const reviewFile = page.getByTestId("file-tree-item-review-md");
		await expect(reviewFile).toBeVisible();
		await reviewFile.click();
		await expect(page.getByText("/review.md")).toBeVisible();
		await expect(page.getByText("Alpha paragraph.")).toBeVisible();

		// The single external write that triggers the review.
		await writeFile(reviewPath, EDIT);

		// The granular stepper appears with two changes — no warm-up write.
		const overlay = page.locator(".markdown-review-overlay");
		await expect(overlay).toBeVisible({ timeout: 45_000 });
		const stepper = page.getByTestId("markdown-review-stepper");
		await expect(stepper).toBeVisible({ timeout: 45_000 });
		await expect(stepper.getByText("1 of 2", { exact: true })).toBeVisible();

		// Accept the first change, then reject the second; the review auto-applies.
		await stepper.getByRole("button", { name: /Accept/ }).click();
		await expect(stepper.getByText("2 of 2", { exact: true })).toBeVisible();
		await stepper.getByRole("button", { name: /Reject/ }).click();

		// The overlay closes once the mixed result is applied.
		await expect(overlay).toBeHidden({ timeout: 30_000 });

		// The file on disk holds exactly the canonical mixed projection.
		await expect
			.poll(async () => await readFile(reviewPath, "utf8"), {
				timeout: 30_000,
			})
			.toBe(EXPECTED);

		// The internal resolution write is suppressed, so no second review opens:
		// the overlay stays gone and the editor is interactive again.
		await expect(page.locator(".markdown-review-overlay")).toHaveCount(0);
		await expect(page.getByText("Alpha v2.")).toBeVisible();
	} finally {
		await closeElectronApp(electronApp);
	}
});
