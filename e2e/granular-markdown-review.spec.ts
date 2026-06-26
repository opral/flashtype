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
	await writeFile(reviewPath, INITIAL);
	seedTrackChangesWorkspace(dir);

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

// FIXME: under the new ephemeral/Track-Changes workspace model, the coalesced
// review still shows the full cumulative diff (the first change is not dropped),
// but it falls back to the classic controls instead of upgrading to the
// per-change stepper. Re-enable once the folded review's granular eligibility is
// re-established against the new Lix SDK's commit/snapshot model.
test.fixme("folds a second external edit into the open review instead of dropping the first", async ({
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
