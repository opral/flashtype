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

// These tests drive a real round trip: write a file on disk -> OS watcher ->
// Lix ingest+commit -> renderer observe -> review UI. That first hop can race
// the detector's initial snapshot on a cold launch, so allow a couple retries
// for the inherent I/O timing (the assertions themselves are deterministic).
test.describe.configure({ retries: 2 });

const INITIAL = "# Review\n\nAlpha paragraph.\n\nBeta paragraph.\n";
// One external edit touching both paragraphs -> two granular changes.
const EDIT = "# Review\n\nAlpha v2.\n\nBeta v2.\n";
// Accept the first change, reject the second.
const EXPECTED = "# Review\n\nAlpha v2.\n\nBeta paragraph.\n";

// Open a tracked (Track Changes) folder with the review file already ingested.
// External-write review runs in tracked workspaces, so the folder is seeded as
// one before launch; the file is then opened so its first edit is reviewable.
async function openReviewFile(testInfo: {
	outputPath: (name: string) => string;
}): Promise<{ app: ElectronApplication; page: Page; reviewPath: string }> {
	const dir = testInfo.outputPath("workspace");
	const reviewPath = path.join(dir, "review.md");
	await mkdir(dir, { recursive: true });
	// Seed the Track Changes (.lix) workspace first, then write the file, so the
	// app ingests it fresh with the Markdown plugin active and materializes its
	// block snapshots at a tracked commit (the review's before-side).
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
	// Wait until the external-write detector has snapshotted the initial state, so
	// the first test edit is seen as an edit rather than folded into the baseline.
	await expect(page.locator("html")).toHaveAttribute(
		"data-external-write-detector-armed",
		"true",
		{ timeout: 30_000 },
	);
	return { app, page, reviewPath };
}

test("accepts one block and rejects another on the first external Markdown edit", async ({
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

		// The internal resolution write must not reopen a second review.
		await expect(page.locator(".markdown-review-overlay")).toHaveCount(0);
		await expect(page.getByText("Alpha v2.")).toBeVisible();
	} finally {
		await closeElectronApp(app);
	}
});

// Two sequential single-change writes must fold into one review rather than the
// second dropping the first.
const EDIT_ALPHA = "# Review\n\nAlpha v2.\n\nBeta paragraph.\n";
const EDIT_BOTH = "# Review\n\nAlpha v2.\n\nBeta v2.\n";

test("folds a second external edit into the open review instead of dropping the first", async ({
	browserName: _browserName,
}, testInfo) => {
	let app: ElectronApplication | undefined;
	try {
		const opened = await openReviewFile(testInfo);
		app = opened.app;
		const { page, reviewPath } = opened;

		// One change -> classic controls.
		await writeFile(reviewPath, EDIT_ALPHA);
		const overlay = page.locator(".markdown-review-overlay");
		await expect(overlay).toBeVisible({ timeout: 45_000 });
		await expect(
			page.getByRole("group", { name: "External write review actions" }),
		).toBeVisible();
		await expect(page.getByTestId("markdown-review-stepper")).toHaveCount(0);
		// Let write1's review fully render (its commit + projection settled) before
		// the second write, so the fold computes against fresh history rather than
		// racing the first write's ingest.
		await expect(overlay.getByText("v2.", { exact: false }).first()).toBeVisible({
			timeout: 30_000,
		});

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
		await closeElectronApp(app);
	}
});
