import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	closeElectronApp,
	ensureFilesViewOpenInLeftPanel,
	fileTreeFile,
	launchDevElectronApp,
} from "./electron-test-utils";

test("Share shows Lixray teaser and sync request email", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspace = testInfo.outputPath("workspace");
	await mkdir(workspace, { recursive: true });
	const file = path.join(workspace, "share-me.md");
	await writeFile(file, "# Share me\n");
	const app = await launchDevElectronApp(workspace, {
		userDataDir: testInfo.outputPath("profile"),
	});
	try {
		const page = await app.firstWindow();
		const share = page.getByRole("button", { name: "Share", exact: true });
		await expect(share).toBeEnabled({ timeout: 30_000 });
		await ensureFilesViewOpenInLeftPanel(page);
		await fileTreeFile(page, "/share-me.md").click();
		await page.emulateMedia({ colorScheme: "dark" });
		const treeTheme = await page
			.locator("[data-testid='files-view-tree-scroll'] file-tree-container")
			.first()
			.evaluate((element) => ({
				scheme: getComputedStyle(element).colorScheme,
			}));
		expect(treeTheme.scheme).toBe("light");
		await share.click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await expect(
			dialog.getByRole("link", { name: "Open lixray.com" }),
		).toHaveAttribute("href", "https://lixray.com");
		await expect(
			dialog.getByRole("link", { name: "Write an email to samuel@opral.com" }),
		).toHaveAttribute("href", /mailto:samuel@opral.com/);
		await expect(dialog.getByRole("textbox")).toHaveCount(0);
		await dialog.screenshot({ path: testInfo.outputPath("share-teaser.png") });
		await page.keyboard.press("Escape");
		await expect(dialog).not.toBeVisible();
	} finally {
		await closeElectronApp(app);
	}
});
