import { expect, test, type Page } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";
import seedrandom from "seedrandom";

const repoRoot = path.resolve(import.meta.dirname, "..");
const rendererUrl = "http://127.0.0.1:4173";
const clickCount = 100;
const electronCloseTimeoutMs = 5_000;

test("left files panel survives a seeded random file click tour", async (_, testInfo) => {
	const rng = seedrandom(testInfo.repeatEachIndex.toString());
	const workspaceDir = testInfo.outputPath("workspace");

	let electronApp: ElectronApplication | undefined;
	try {
		electronApp = await electron.launch({
			cwd: repoRoot,
			args: ["./electron/main.mjs", workspaceDir],
			env: {
				...process.env,
				VITE_DEV_SERVER_URL: rendererUrl,
			},
		});

		const page = await electronApp.firstWindow();
		page.on("console", (message) => {
			if (message.type() === "error") {
				console.error(`[renderer] ${message.text()}`);
			}
		});

		await expect(page.getByTestId("landing-screen")).toBeVisible();
		await ensureFilesViewOpenInLeftPanel(page);
		await seedStarterFiles(page);
		await expectMaterializedSeedFiles(workspaceDir);

		const fileItems = page.locator('[data-testid^="file-tree-item-"]');
		await expect(fileItems.first()).toBeVisible();

		for (let index = 0; index < clickCount; index += 1) {
			const fileCount = await fileItems.count();
			expect(fileCount).toBeGreaterThan(0);

			const fileIndex = Math.floor(rng() * fileCount);
			const delayMs = Math.floor(rng() * 1001);
			const file = fileItems.nth(fileIndex);

			await test.step(`click ${index + 1}/${clickCount}: file index ${fileIndex}, delay ${delayMs}ms`, async () => {
				await file.click();
				await expect(file).toHaveAttribute("data-selected", "true");
				await expect(
					page.locator('[data-view-key="flashtype_file"]').first(),
				).toBeVisible();
				await page.waitForTimeout(delayMs);
			});
		}
	} finally {
		await closeElectronApp(electronApp);
	}
});

async function ensureFilesViewOpenInLeftPanel(page: Page): Promise<void> {
	const leftPanel = page.locator("aside").first();
	const filesTab = leftPanel
		.locator('[data-view-key="flashtype_files"]')
		.first();

	if ((await panelSize(filesTab)) <= 1) {
		await page.getByLabel("Toggle left panel").click();
	}

	await expect.poll(() => panelSize(filesTab)).toBeGreaterThan(1);
	await expect(filesTab).toBeVisible();
	await filesTab.click();
	await expect(filesTab).toHaveAttribute("data-focused", "true");
}

async function panelSize(
	locator: ReturnType<Page["locator"]>,
): Promise<number> {
	const rawSize = await locator.evaluate((element) => {
		return element
			.closest("[data-panel-size]")
			?.getAttribute("data-panel-size");
	});
	return Number(rawSize ?? 0);
}

async function seedStarterFiles(page: Page): Promise<void> {
	const seedButton = page.getByLabel("Seed starter files");
	await expect(seedButton).toBeVisible();
	await seedButton.click();
	await expect(seedButton).toBeEnabled();
}

async function expectMaterializedSeedFiles(
	workspaceDir: string,
): Promise<void> {
	await expect
		.poll(() => readTextFile(path.join(workspaceDir, "welcome.md")))
		.toContain("Welcome to Opral's repository.");
	await expect
		.poll(() =>
			readTextFile(path.join(workspaceDir, "notes", "meeting-notes.md")),
		)
		.toContain("Team Meeting");
}

async function readTextFile(filePath: string): Promise<string> {
	try {
		return await readFile(filePath, "utf8");
	} catch {
		return "";
	}
}

async function closeElectronApp(
	electronApp: ElectronApplication | undefined,
): Promise<void> {
	if (!electronApp) return;

	const childProcess = electronApp.process();
	let closeError: unknown;
	const closePromise = electronApp.close().catch((error: unknown) => {
		closeError = error;
	});

	const closeResult = await raceWithTimeout(
		closePromise,
		electronCloseTimeoutMs,
	);
	if (closeResult === "completed") {
		if (closeError) {
			console.warn("[e2e] Electron close failed", closeError);
		}
		return;
	}

	console.warn(
		`[e2e] Electron did not close within ${electronCloseTimeoutMs}ms; killing process`,
	);
	await killElectronProcess(childProcess);
}

async function raceWithTimeout(
	promise: Promise<void>,
	ms: number,
): Promise<"completed" | "timed-out"> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise.then(() => "completed" as const),
			new Promise<"timed-out">((resolve) => {
				timeoutId = setTimeout(() => resolve("timed-out"), ms);
			}),
		]);
	} finally {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
		}
	}
}

function onceProcessExit(
	childProcess: ReturnType<ElectronApplication["process"]>,
): Promise<void> {
	if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		childProcess.once("exit", () => resolve());
	});
}

async function killElectronProcess(
	childProcess: ReturnType<ElectronApplication["process"]>,
): Promise<void> {
	if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
		return;
	}

	childProcess.kill("SIGTERM");
	const termResult = await raceWithTimeout(
		onceProcessExit(childProcess),
		electronCloseTimeoutMs,
	);
	if (termResult === "completed") {
		return;
	}

	console.warn(
		`[e2e] Electron did not exit after SIGTERM within ${electronCloseTimeoutMs}ms; sending SIGKILL`,
	);
	childProcess.kill("SIGKILL");
	const killResult = await raceWithTimeout(
		onceProcessExit(childProcess),
		electronCloseTimeoutMs,
	);
	if (killResult === "timed-out") {
		console.warn("[e2e] Electron process did not report exit after SIGKILL");
	}
}
