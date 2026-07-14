import { expect, type Locator, type Page } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const repoRoot = path.resolve(import.meta.dirname, "..");

const rendererPort = process.env.FLASHTYPE_E2E_RENDERER_PORT ?? "4174";
const rendererUrl = `http://127.0.0.1:${rendererPort}`;
const electronCloseTimeoutMs = 5_000;
export const devElectronHeadless = process.env.FLASHTYPE_HEADLESS ?? "1";

export async function launchDevElectronApp(
	workspaceDir: string,
	options: LaunchDevElectronAppOptions = {},
): Promise<ElectronApplication> {
	return await launchDevElectronAppWithArgs([workspaceDir], options);
}

type LaunchDevElectronAppOptions = {
	env?: NodeJS.ProcessEnv;
	userDataDir?: string;
};

export async function launchDevElectronAppWithArgs(
	workspaceDirs: string[],
	options: LaunchDevElectronAppOptions = {},
): Promise<ElectronApplication> {
	const userDataDir =
		options.userDataDir ??
		path.join(tmpdir(), "flashtype-e2e-user-data", randomUUID());
	return await electron.launch({
		cwd: repoRoot,
		args: [
			`--user-data-dir=${userDataDir}`,
			"./electron/main.mjs",
			...workspaceDirs,
		],
		env: {
			...process.env,
			FLASHTYPE_HEADLESS: devElectronHeadless,
			VITE_DEV_SERVER_URL: rendererUrl,
			...options.env,
		},
	});
}

export async function launchPackagedElectronApp({
	executablePath,
	workspaceDir,
}: {
	executablePath: string;
	workspaceDir: string;
}): Promise<ElectronApplication> {
	const env = { ...process.env };
	delete env.VITE_DEV_SERVER_URL;
	delete env.FLASHTYPE_HEADLESS;
	env.FLASHTYPE_DISABLE_AUTO_UPDATE = "1";

	return await electron.launch({
		cwd: repoRoot,
		executablePath,
		args: [workspaceDir],
		env,
	});
}

export function registerRendererConsoleLogging(page: Page): void {
	page.on("console", (message) => {
		if (message.type() === "error") {
			console.error(`[renderer] ${message.text()}`);
		}
	});
}

export async function ensureFilesViewOpenInLeftPanel(
	page: Page,
): Promise<void> {
	await waitForWorkspaceReady(page);
	const leftPanel = page.locator("aside").first();
	const filesTab = leftPanel.locator('[data-view-key="atelier_files"]').first();
	const leftPanelToggle = page.getByLabel("Toggle left panel").first();

	await expect(leftPanelToggle).toBeVisible();
	if ((await leftPanelToggle.getAttribute("aria-pressed")) !== "true") {
		await leftPanelToggle.click();
	}

	await expect(leftPanelToggle).toHaveAttribute("aria-pressed", "true");
	await expect(filesTab).toBeVisible();
	await filesTab.click();
	await expect(filesTab).toHaveAttribute("data-focused", "true");
}

export async function ensureHistoryViewOpenInLeftPanel(
	page: Page,
): Promise<void> {
	await waitForWorkspaceReady(page);
	const leftPanel = page.locator("aside").first();
	let historyTab = leftPanel
		.locator('[data-view-key="atelier_history"]')
		.first();
	const leftPanelToggle = page.getByLabel("Toggle left panel").first();

	if ((await historyTab.count()) === 0) {
		await expect(leftPanelToggle).toBeVisible();
		if ((await leftPanelToggle.getAttribute("aria-pressed")) !== "true") {
			await leftPanelToggle.click();
		}
		await expect(leftPanelToggle).toHaveAttribute("aria-pressed", "true");
		const addViewButton = leftPanel.getByLabel("Add view").first();
		await expect(addViewButton).toBeVisible();
		await addViewButton.click();
		await page.getByRole("menuitem", { name: "History", exact: true }).click();
		historyTab = leftPanel.locator('[data-view-key="atelier_history"]').first();
	}

	await expect(leftPanelToggle).toBeVisible();
	if ((await leftPanelToggle.getAttribute("aria-pressed")) !== "true") {
		await leftPanelToggle.click();
	}

	await expect(leftPanelToggle).toHaveAttribute("aria-pressed", "true");
	await expect(historyTab).toBeVisible();
	await historyTab.click();
	await expect(historyTab).toHaveAttribute("data-focused", "true");
}

async function waitForWorkspaceReady(page: Page): Promise<void> {
	await expect(page.locator(".atelier-panel-group")).toBeVisible();
	await expect(page.getByLabel("Flashtype loading")).toHaveCount(0);
}

export function fileTreeFiles(page: Page): Locator {
	return page.locator(
		'[data-type="item"][data-item-type="file"][data-item-path]',
	);
}

export function fileTreeFile(page: Page, appPath: string): Locator {
	return page.locator(fileTreeItemSelector(appPath, "file"));
}

export function fileTreeDirectory(page: Page, appPath: string): Locator {
	return page.locator(fileTreeItemSelector(appPath, "folder"));
}

function fileTreeItemSelector(
	appPath: string,
	itemType: "file" | "folder",
): string {
	const treePath =
		itemType === "folder"
			? appDirectoryPathToTreePath(appPath)
			: appFilePathToTreePath(appPath);
	return `[data-type="item"][data-item-type="${itemType}"][data-item-path=${cssString(treePath)}]`;
}

function appFilePathToTreePath(appPath: string): string {
	const withoutLeadingSlash = appPath.startsWith("/")
		? appPath.slice(1)
		: appPath;
	return withoutLeadingSlash.endsWith("/")
		? withoutLeadingSlash.slice(0, -1)
		: withoutLeadingSlash;
}

function appDirectoryPathToTreePath(appPath: string): string {
	const filePath = appFilePathToTreePath(appPath);
	return filePath === "" ? "" : `${filePath}/`;
}

function cssString(value: string): string {
	return JSON.stringify(value);
}

/**
 * Writes starter markdown files into the workspace folder before launch.
 * The workspace is a plain folder on disk; the app ingests whatever it finds.
 */
export async function writeStarterFiles(workspaceDir: string): Promise<void> {
	await mkdir(path.join(workspaceDir, "notes"), { recursive: true });
	await writeFile(
		path.join(workspaceDir, "welcome.md"),
		"# Welcome\n\nStarter file for e2e tests.\n",
	);
	await writeFile(
		path.join(workspaceDir, "changelog.md"),
		"# Changelog\n\n- initial entry\n",
	);
	await writeFile(
		path.join(workspaceDir, "metrics.csv"),
		"metric,value\nsignups,42\n",
	);
	await writeFile(
		path.join(workspaceDir, "notes", "meeting-notes.md"),
		"# Team Meeting\n\n- agenda item\n",
	);
}

export async function expectInstalledPluginArchives(
	workspaceDir: string,
): Promise<void> {
	await expect
		.poll(() =>
			readBinaryFile(
				path.join(workspaceDir, ".lix", "plugins", "plugin_md_v2.lixplugin"),
			),
		)
		.toBeGreaterThan(0);
	await expect
		.poll(() =>
			readBinaryFile(
				path.join(workspaceDir, ".lix", "plugins", "plugin_csv.lixplugin"),
			),
		)
		.toBeGreaterThan(0);
}

export async function expectPathMissing(filePath: string): Promise<void> {
	await expect
		.poll(async () => {
			try {
				await stat(filePath);
				return false;
			} catch (error) {
				expect(error).toMatchObject({ code: "ENOENT" });
				return true;
			}
		})
		.toBe(true);
}

export async function closeElectronApp(
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

async function readBinaryFile(filePath: string): Promise<number> {
	try {
		return (await readFile(filePath)).byteLength;
	} catch {
		return 0;
	}
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
