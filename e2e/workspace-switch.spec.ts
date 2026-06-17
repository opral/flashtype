import { expect, test } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	closeElectronApp,
	expectInstalledPluginArchives,
	launchDevElectronApp,
	registerRendererConsoleLogging,
} from "./electron-test-utils";

test("switching to an empty workspace closes the previous lix session", async (
	{ browserName: _browserName },
	testInfo,
) => {
	const firstWorkspaceDir = testInfo.outputPath("first-workspace");
	const secondWorkspaceDir = testInfo.outputPath("second-workspace");

	let electronApp: ElectronApplication | undefined;
	try {
		await mkdir(firstWorkspaceDir, { recursive: true });
		await mkdir(secondWorkspaceDir, { recursive: true });
		await writeFile(
			path.join(firstWorkspaceDir, "old-workspace-marker.md"),
			"# Old workspace marker\n",
		);

		electronApp = await launchDevElectronApp(firstWorkspaceDir);
		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await expect(page.getByText("old-workspace-marker.md")).toBeVisible();
		await expectInstalledPluginArchives(firstWorkspaceDir);

		await page.evaluate(async (workspacePath) => {
			await window.flashtypeDesktop?.workspace.open({ path: workspacePath });
			await window.flashtypeDesktop?.lix.close();
		}, secondWorkspaceDir);
		await page.reload({ waitUntil: "domcontentloaded" });

		await expect(page).toHaveTitle(path.basename(secondWorkspaceDir));
		await expect(page.getByText("old-workspace-marker.md")).toHaveCount(0);
		await expect(page.getByText("Start writing")).toBeVisible();
		await expectInstalledPluginArchives(secondWorkspaceDir);
	} finally {
		await closeElectronApp(electronApp);
	}
});
