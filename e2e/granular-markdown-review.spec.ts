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
	waitForWorkspaceReady,
} from "./electron-test-utils";

const INITIAL = "# Review\n\nAlpha paragraph.\n\nBeta paragraph.\n";
// One external edit touching both paragraphs -> two granular changes.
const EDIT = "# Review\n\nAlpha v2.\n\nBeta v2.\n";
// Accept the first change, reject the second.
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

		await waitForWorkspaceReady(page);
		await expectInstalledPluginArchives(workspaceDir);
		await ensureFilesViewOpenInLeftPanel(page);

		// Open the file first so its baseline is established before the edit.
		const reviewFile = page.getByTestId("file-tree-item-review-md");
		await expect(reviewFile).toBeVisible();
		await reviewFile.click();
		await expect(page.getByText("/review.md")).toBeVisible();
		await expect(page.getByText("Alpha paragraph.")).toBeVisible();

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
			.poll(async () => await readFile(reviewPath, "utf8"), {
				timeout: 30_000,
			})
			.toBe(EXPECTED);

		// The internal resolution write must not reopen a second review.
		await expect(page.locator(".markdown-review-overlay")).toHaveCount(0);
		await expect(page.getByText("Alpha v2.")).toBeVisible();
	} finally {
		await closeElectronApp(electronApp);
	}
});

// Two sequential single-change writes must fold into one review rather than the
// second dropping the first.
const EDIT_ALPHA = "# Review\n\nAlpha v2.\n\nBeta paragraph.\n";
const EDIT_BOTH = "# Review\n\nAlpha v2.\n\nBeta v2.\n";

test("folds a second external edit into the open review instead of dropping the first", async ({
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

		await waitForWorkspaceReady(page);
		await expectInstalledPluginArchives(workspaceDir);
		await ensureFilesViewOpenInLeftPanel(page);

		const reviewFile = page.getByTestId("file-tree-item-review-md");
		await expect(reviewFile).toBeVisible();
		await reviewFile.click();
		await expect(page.getByText("/review.md")).toBeVisible();
		await expect(page.getByText("Alpha paragraph.")).toBeVisible();

		// One change -> classic controls.
		await writeFile(reviewPath, EDIT_ALPHA);
		const overlay = page.locator(".markdown-review-overlay");
		await expect(overlay).toBeVisible({ timeout: 45_000 });
		await expect(
			page.getByRole("group", { name: "External write review actions" }),
		).toBeVisible();
		await expect(page.getByTestId("markdown-review-stepper")).toHaveCount(0);

		// Folds into the open review -> cumulative two-change stepper.
		await writeFile(reviewPath, EDIT_BOTH);
		const stepper = page.getByTestId("markdown-review-stepper");
		await expect(stepper).toBeVisible({ timeout: 45_000 });
		await expect(stepper.getByText("1 of 2", { exact: true })).toBeVisible();

		await stepper.getByRole("button", { name: /Accept/ }).click();
		await expect(stepper.getByText("2 of 2", { exact: true })).toBeVisible();
		await stepper.getByRole("button", { name: /Reject/ }).click();

		await expect(overlay).toBeHidden({ timeout: 30_000 });
		await expect
			.poll(async () => await readFile(reviewPath, "utf8"), { timeout: 30_000 })
			.toBe(EDIT_ALPHA);
		await expect(page.locator(".markdown-review-overlay")).toHaveCount(0);
	} finally {
		await closeElectronApp(electronApp);
	}
});
