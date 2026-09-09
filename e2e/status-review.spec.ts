import { expect, test } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchDevElectronApp } from "./electron-test-utils";

test("changed-files status opens review and preserves the Files sidebar", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "flashtype-status-review-"));
	const userDataDir = await mkdtemp(
		path.join(tmpdir(), "flashtype-status-profile-"),
	);
	await writeFile(path.join(root, "note.md"), "# Review me\n");
	const app = await launchDevElectronApp(root, { userDataDir });
	try {
		const page = await app.firstWindow();
		const status = page.getByRole("button", {
			name: /file.* changed since checkpoint\. Review working changes/,
		});
		await expect(status).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByRole("button", { name: "Files panel view menu" }),
		).toBeVisible();
		await status.click();
		await expect(page.locator('[data-review-mode="true"]')).toBeVisible();
		await expect(
			page.getByRole("button", { name: /^Checkpoint(ing…)?$/ }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Files panel view menu" }),
		).toBeVisible();
		await expect(page.getByRole("tree")).toBeVisible();
	} finally {
		await app.close();
		await rm(root, { recursive: true, force: true });
		await rm(userDataDir, { recursive: true, force: true });
	}
});

test("History header switches between active-file and repository history", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "flashtype-history-scope-"));
	const userDataDir = await mkdtemp(
		path.join(tmpdir(), "flashtype-history-profile-"),
	);
	await writeFile(path.join(root, "one.md"), "# One\n");
	await writeFile(path.join(root, "two.md"), "# Two\n");
	const app = await launchDevElectronApp(root, {
		userDataDir,
	});
	try {
		const page = await app.firstWindow();
		await expect(
			page.getByRole("button", { name: /since checkpoint/ }),
		).toBeVisible();
		await page.getByRole("button", { name: "Files", exact: true }).click();
		await expect(
			page.getByLabel("Showing the repository", { exact: true }).first(),
		).toBeVisible();
		await page
			.getByTestId("atelier-view:files-default")
			.getByRole("treeitem", { name: "one.md" })
			.click();
		const fileSwitch = page
			.getByRole("button", {
				name: "Showing this file. Switch to the repository",
			})
			.first();
		await expect(fileSwitch).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByText("No checkpoint includes this file yet.").first(),
		).toBeVisible();
		await fileSwitch.click();
		const repoSwitch = page
			.getByRole("button", {
				name: "Showing the repository. Switch to this file",
			})
			.first();
		await expect(repoSwitch).toBeVisible();
		await expect(
			page.getByText("No checkpoint includes this file yet."),
		).toHaveCount(0);
		await repoSwitch.click();
		await expect(fileSwitch).toBeVisible();
		await expect(
			page.getByText("No checkpoint includes this file yet.").first(),
		).toBeVisible();
	} finally {
		await app.close();
		await rm(root, { recursive: true, force: true });
		await rm(userDataDir, { recursive: true, force: true });
	}
});
