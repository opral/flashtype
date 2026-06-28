import { expect, test, type Page } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import seedrandom from "seedrandom";
import {
	closeElectronApp,
	ensureFilesViewOpenInLeftPanel,
	fileTreeFile,
	fileTreeFiles,
	launchDevElectronApp,
	registerRendererConsoleLogging,
	writeStarterFiles,
} from "./electron-test-utils";

const clickCount = 50;
const deleteShortcut =
	process.platform === "darwin" ? "Meta+Backspace" : "Control+Backspace";

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
		await ensureFilesViewOpenInLeftPanel(page);

		const fileItems = fileTreeFiles(page);
		await expect(fileItems.first()).toBeVisible();
		const csvFile = fileTreeFile(page, "/metrics.csv");
		await csvFile.click();
		await expect(csvFile).toHaveAttribute("data-item-selected", "true");
		await expect(
			page.locator('[data-active="true"][data-view-key="flashtype_csv"]'),
		).toBeVisible();
		await expect(page.getByText("/metrics.csv")).toBeVisible();
		await expectCsvGridCanvasToRender(page);

		for (let index = 0; index < clickCount; index += 1) {
			const fileCount = await fileItems.count();
			expect(fileCount).toBeGreaterThan(0);

			const fileIndex = Math.floor(rng() * fileCount);
			const delayMs = Math.floor(rng() * 1001);
			const file = fileItems.nth(fileIndex);
			const treePath = await file.getAttribute("data-item-path");

			await test.step(`click ${index + 1}/${clickCount}: file index ${fileIndex}, delay ${delayMs}ms`, async () => {
				await file.click();
				await expect(file).toHaveAttribute("data-item-selected", "true");
				await expect(
					page
						.locator(
							'[data-panel-side="central"][data-active="true"][data-view-key="flashtype_file"]:visible, [data-panel-side="central"][data-active="true"][data-view-key="flashtype_csv"]:visible',
						)
						.first(),
				).toBeVisible();
				if (treePath === "metrics.csv") {
					await expectCsvGridCanvasToRender(page);
				}
				await page.waitForTimeout(delayMs);
			});
		}
	} finally {
		await closeElectronApp(electronApp);
	}
});

async function expectCsvGridCanvasToRender(page: Page): Promise<void> {
	const canvas = page
		.locator('[data-active="true"][data-view-key="flashtype_csv"] canvas')
		.first();
	await expect(canvas).toBeVisible();
	await expect
		.poll(async () => {
			return await canvas.evaluate((element) => {
				const canvasElement = element as HTMLCanvasElement;
				const context = canvasElement.getContext("2d");
				if (
					!context ||
					canvasElement.width === 0 ||
					canvasElement.height === 0
				) {
					return 0;
				}
				const width = Math.min(canvasElement.width, 500);
				const height = Math.min(canvasElement.height, 300);
				const pixels = context.getImageData(0, 0, width, height).data;
				let nonWhitePixels = 0;
				for (let index = 0; index < pixels.length; index += 4) {
					const red = pixels[index] ?? 255;
					const green = pixels[index + 1] ?? 255;
					const blue = pixels[index + 2] ?? 255;
					const alpha = pixels[index + 3] ?? 0;
					if (alpha > 0 && (red < 245 || green < 245 || blue < 245)) {
						nonWhitePixels += 1;
					}
				}
				return nonWhitePixels;
			});
		})
		.toBeGreaterThan(100);
}

test("deleting the active file closes the central file view", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("workspace-delete-active-file");

	let electronApp: ElectronApplication | undefined;
	try {
		await writeStarterFiles(workspaceDir);
		electronApp = await launchDevElectronApp(workspaceDir);

		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await expect(page.getByTestId("central-panel-empty-state")).toBeVisible();
		await ensureFilesViewOpenInLeftPanel(page);

		const file = fileTreeFile(page, "/welcome.md");
		await expect(file).toBeVisible();
		await file.click();
		await expect(file).toHaveAttribute("data-item-selected", "true");
		await expect(
			page.locator('[data-active="true"][data-view-key="flashtype_file"]'),
		).toBeVisible();

		await file.click();
		await page.keyboard.press(deleteShortcut);

		await expect(file).toHaveCount(0);
		await expect(
			page.locator('[data-active="true"][data-view-key="flashtype_file"]'),
		).toHaveCount(0);
		await expect(page.getByTestId("central-panel-empty-state")).toBeVisible();
	} finally {
		await closeElectronApp(electronApp);
	}
});
