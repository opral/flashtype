import { expect, test } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import seedrandom from "seedrandom";
import {
	closeElectronApp,
	ensureFilesViewOpenInLeftPanel,
	expectInstalledPluginArchives,
	launchDevElectronApp,
	registerRendererConsoleLogging,
	writeStarterFiles,
} from "./electron-test-utils";

const clickCount = 100;

test("left files panel survives a seeded random file click tour", async ({
	browserName: _browserName,
}, testInfo) => {
	const rng = seedrandom(testInfo.repeatEachIndex.toString());
	const workspaceDir = testInfo.outputPath("workspace");

	let electronApp: ElectronApplication | undefined;
	try {
		await writeStarterFiles(workspaceDir);
		electronApp = await launchDevElectronApp(workspaceDir);

		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await expect(page.getByTestId("central-panel-empty-state")).toBeVisible();
		await expectInstalledPluginArchives(workspaceDir);
		await ensureFilesViewOpenInLeftPanel(page);

		const fileItems = page.locator('[data-testid^="file-tree-item-"]');
		await expect(fileItems.first()).toBeVisible();
		const csvFile = page.getByTestId("file-tree-item-metrics-csv");
		await csvFile.click();
		await expect(csvFile).toHaveAttribute("data-selected", "true");
		await expect(
			page.locator('[data-active="true"][data-view-key="flashtype_csv"]'),
		).toBeVisible();
		await expect(page.getByText("/metrics.csv")).toBeVisible();
		await expect(page.getByText("metric", { exact: true })).toBeVisible();
		await expect(page.getByText("value", { exact: true })).toBeVisible();
		await expect(page.getByText("signups", { exact: true })).toBeVisible();
		await expect(page.getByText("42", { exact: true })).toBeVisible();

		for (let index = 0; index < clickCount; index += 1) {
			const fileCount = await fileItems.count();
			expect(fileCount).toBeGreaterThan(0);

			const fileIndex = Math.floor(rng() * fileCount);
			const delayMs = Math.floor(rng() * 1001);
			const file = fileItems.nth(fileIndex);
			const testId = await file.getAttribute("data-testid");
			const expectedViewKind =
				testId === "file-tree-item-metrics-csv"
					? "flashtype_csv"
					: "flashtype_file";

			await test.step(`click ${index + 1}/${clickCount}: file index ${fileIndex}, delay ${delayMs}ms`, async () => {
				await file.click();
				await expect(file).toHaveAttribute("data-selected", "true");
				await expect(
					page
						.locator(
							`[data-active="true"][data-view-key="${expectedViewKind}"]:visible`,
						)
						.first(),
				).toBeVisible();
				await page.waitForTimeout(delayMs);
			});
		}
	} finally {
		await closeElectronApp(electronApp);
	}
});
