import { expect, test, type Page } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import {
	closeElectronApp,
	ensureFilesViewOpenInLeftPanel,
	fileTreeDirectory,
	launchDevElectronApp,
	registerRendererConsoleLogging,
} from "./electron-test-utils";

test("New folder is persisted in Lix and materialized in the workspace", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("workspace");
	await mkdir(workspaceDir, { recursive: true });

	let electronApp: ElectronApplication | undefined;
	try {
		electronApp = await launchDevElectronApp(workspaceDir);
		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);
		await ensureFilesViewOpenInLeftPanel(page);
		await page.getByRole("button", { name: "New", exact: true }).click();
		await page.getByRole("menuitem", { name: "New folder" }).click();
		const input = page.locator("[data-item-rename-input]");
		await expect(input).toBeVisible();
		await expect(input).toHaveValue("new-folder");
		await input.press("Enter");

		const folder = fileTreeDirectory(page, "/new-folder");
		await expect(folder).toBeVisible();
		await expect
			.poll(async () =>
				page.evaluate(async () => {
					const result = await window.flashtypeDesktop!.lix.execute({
						sql: "SELECT path FROM lix_directory WHERE path = $1",
						params: ["/new-folder"],
					});
					return result.rows;
				}),
			)
			.toEqual([["/new-folder"]]);
		await expect
			.poll(async () =>
				stat(path.join(workspaceDir, "new-folder"))
					.then((metadata) => metadata.isDirectory())
					.catch(() => false),
			)
			.toBe(true);

		// The new folder becomes the current selection, so another create goes
		// inside it. Accept that name unchanged to check the selected-folder path.
		await page.getByRole("button", { name: "New", exact: true }).click();
		await page.getByRole("menuitem", { name: "New folder" }).click();
		const nestedInput = page.locator("[data-item-rename-input]");
		await expect(nestedInput).toBeVisible();
		await expect(nestedInput).toHaveValue("new-folder");
		await nestedInput.press("Enter");
		await expect(
			fileTreeDirectory(page, "/new-folder/new-folder"),
		).toBeVisible();
		await expect
			.poll(async () =>
				page.evaluate(async () => {
					const result = await window.flashtypeDesktop!.lix.execute({
						sql: "SELECT path FROM lix_directory WHERE path = $1",
						params: ["/new-folder/new-folder"],
					});
					return result.rows;
				}),
			)
			.toEqual([["/new-folder/new-folder"]]);
		await expect
			.poll(async () =>
				stat(path.join(workspaceDir, "new-folder", "new-folder"))
					.then((metadata) => metadata.isDirectory())
					.catch(() => false),
			)
			.toBe(true);

		// Clear the selected destination to return to root. Because `/new-folder`
		// already exists there, the root-level default must be suffixed.
		await page
			.locator("aside")
			.first()
			.locator('file-tree-container[aria-label="Files"]')
			.click();
		await page.getByRole("button", { name: "New", exact: true }).click();
		await page.getByRole("menuitem", { name: "New folder" }).click();
		const rootInput = page.locator("[data-item-rename-input]");
		await expect(rootInput).toBeVisible();
		await expect(rootInput).toHaveValue("new-folder-2");
		await rootInput.press("Enter");
		await expect(fileTreeDirectory(page, "/new-folder-2")).toBeVisible();
		await expect
			.poll(async () =>
				page.evaluate(async () => {
					const result = await window.flashtypeDesktop!.lix.execute({
						sql: "SELECT path FROM lix_directory WHERE path = $1",
						params: ["/new-folder-2"],
					});
					return result.rows;
				}),
			)
			.toEqual([["/new-folder-2"]]);
		await expect
			.poll(async () =>
				stat(path.join(workspaceDir, "new-folder-2"))
					.then((metadata) => metadata.isDirectory())
					.catch(() => false),
			)
			.toBe(true);
	} finally {
		await closeElectronApp(electronApp);
	}
});
