import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	closeElectronApp,
	launchDevElectronAppWithArgs,
} from "./electron-test-utils";

test("Share explains private sync and requires repository initialization before publishing", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspace = testInfo.outputPath("workspace");
	await mkdir(workspace, { recursive: true });
	const file = path.join(workspace, "share-me.md");
	await writeFile(file, "# Share me\n");
	const app = await launchDevElectronAppWithArgs([file], {
		userDataDir: testInfo.outputPath("profile"),
	});
	try {
		const page = await app.firstWindow();
		const share = page.getByRole("button", { name: "Share", exact: true });
		await expect(share).toBeEnabled({ timeout: 30_000 });
		await share.click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await expect(
			dialog.getByText(/including its history, will sync privately/),
		).toBeVisible();
		await expect(
			dialog.getByRole("button", { name: "Initialize repository" }),
		).toBeVisible();
		await expect(
			dialog.getByRole("button", { name: "Publish file", exact: true }),
		).toHaveCount(0);
		await dialog.getByRole("button", { name: "Initialize repository" }).click();
		await expect(page.getByRole("dialog")).toBeVisible({ timeout: 30_000 });
		await expect(page.getByLabel("API token", { exact: true })).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Save token", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Sign in to Lixray" }),
		).toHaveCount(0);
		await page.keyboard.press("Escape");
		await expect(dialog).not.toBeVisible();
	} finally {
		await closeElectronApp(app);
	}
});
