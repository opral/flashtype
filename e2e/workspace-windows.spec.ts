import { expect, test, type Page } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import { FsBackend, openLix } from "@lix-js/sdk";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	closeElectronApp,
	launchDevElectronAppWithArgs,
	registerRendererConsoleLogging,
} from "./electron-test-utils";

test("launching with multiple workspace args creates independent windows", async ({
	browserName: _browserName,
}, testInfo) => {
	const firstWorkspaceDir = testInfo.outputPath("first-workspace");
	const secondWorkspaceDir = testInfo.outputPath("second-workspace");

	let electronApp: ElectronApplication | undefined;
	try {
		await writeMarkerFile(firstWorkspaceDir, "first-marker.md");
		await writeMarkerFile(secondWorkspaceDir, "second-marker.md");

		electronApp = await launchDevElectronAppWithArgs([
			firstWorkspaceDir,
			secondWorkspaceDir,
		]);

		const firstPage = await pageWithTitle(
			electronApp,
			path.basename(firstWorkspaceDir),
		);
		const secondPage = await pageWithTitle(
			electronApp,
			path.basename(secondWorkspaceDir),
		);
		registerRendererConsoleLogging(firstPage);
		registerRendererConsoleLogging(secondPage);

		await expect(firstPage.getByText("first-marker.md")).toBeVisible();
		await expect(firstPage.getByText("second-marker.md")).toHaveCount(0);
		await expect(secondPage.getByText("second-marker.md")).toBeVisible();
		await expect(secondPage.getByText("first-marker.md")).toHaveCount(0);
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("opening a folder from an existing workspace creates a new window", async ({
	browserName: _browserName,
}, testInfo) => {
	const firstWorkspaceDir = testInfo.outputPath("first-workspace");
	const secondWorkspaceDir = testInfo.outputPath("second-workspace");

	let electronApp: ElectronApplication | undefined;
	try {
		await writeMarkerFile(firstWorkspaceDir, "first-marker.md");
		await writeMarkerFile(secondWorkspaceDir, "second-marker.md");

		electronApp = await launchDevElectronAppWithArgs([firstWorkspaceDir]);
		const firstPage = await pageWithTitle(
			electronApp,
			path.basename(firstWorkspaceDir),
		);
		registerRendererConsoleLogging(firstPage);

		await firstPage.evaluate(async (workspacePath) => {
			await window.flashtypeDesktop?.workspace.openInNewWindow({
				path: workspacePath,
			});
		}, secondWorkspaceDir);

		const secondPage = await pageWithTitle(
			electronApp,
			path.basename(secondWorkspaceDir),
		);
		registerRendererConsoleLogging(secondPage);

		await expectWindowCount(electronApp, 2);
		await expect(firstPage).toHaveTitle(path.basename(firstWorkspaceDir));
		await expect(firstPage.getByText("first-marker.md")).toBeVisible();
		await expect(firstPage.getByText("second-marker.md")).toHaveCount(0);
		await expect(secondPage.getByText("second-marker.md")).toBeVisible();
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("opening a folder from first run reuses the empty window", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("workspace");

	let electronApp: ElectronApplication | undefined;
	try {
		await writeMarkerFile(workspaceDir, "marker.md");

		electronApp = await launchDevElectronAppWithArgs([]);
		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await expect(page.getByText("Open a folder")).toBeVisible();
		await page.evaluate(async (workspacePath) => {
			await window.flashtypeDesktop?.workspace.open({ path: workspacePath });
		}, workspaceDir);
		await page.reload({ waitUntil: "domcontentloaded" });

		await expectWindowCount(electronApp, 1);
		await expect(page).toHaveTitle(path.basename(workspaceDir));
		await expect(page.getByText("marker.md")).toBeVisible();
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("macOS open-file events create workspace windows for folders and files", async ({
	browserName: _browserName,
}, testInfo) => {
	const folderWorkspaceDir = testInfo.outputPath("folder-workspace");
	const fileWorkspaceDir = testInfo.outputPath("file-workspace");
	const filePath = path.join(fileWorkspaceDir, "docs", "file-marker.md");

	let electronApp: ElectronApplication | undefined;
	try {
		await writeMarkerFile(folderWorkspaceDir, "folder-marker.md");
		await writeMarkerFile(
			fileWorkspaceDir,
			path.join("docs", "file-marker.md"),
		);
		await initializeLixWorkspace(fileWorkspaceDir);

		electronApp = await launchDevElectronAppWithArgs([]);
		const firstRunPage = await electronApp.firstWindow();
		registerRendererConsoleLogging(firstRunPage);

		await emitOpenFile(electronApp, folderWorkspaceDir);
		const folderPage = await pageWithTitle(
			electronApp,
			path.basename(folderWorkspaceDir),
		);
		registerRendererConsoleLogging(folderPage);

		await emitOpenFile(electronApp, filePath);
		const filePage = await pageWithTitle(
			electronApp,
			path.basename(fileWorkspaceDir),
		);
		registerRendererConsoleLogging(filePage);

		await expectWindowCount(electronApp, 3);
		await expect(firstRunPage).toHaveTitle("Flashtype");
		await expect(folderPage.getByText("folder-marker.md")).toBeVisible();
		await expect(
			filePage.getByRole("heading", { name: "docs/file-marker.md" }),
		).toBeVisible();
		await expect(
			filePage
				.locator('[data-view-key="flashtype_file"][data-active="true"]')
				.first(),
		).toBeVisible();
		await expect(filePage.getByTestId("central-panel-empty-state")).toHaveCount(
			0,
		);
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("macOS open-file events open standalone files as ephemeral single-file workspaces", async ({
	browserName: _browserName,
}, testInfo) => {
	const directory = testInfo.outputPath("standalone-files");
	const filePath = path.join(directory, "solo.md");
	const siblingPath = path.join(directory, "sibling.md");

	let electronApp: ElectronApplication | undefined;
	try {
		await mkdir(directory, { recursive: true });
		await writeFile(filePath, "# Solo\n");
		await writeFile(siblingPath, "# Sibling\n");

		electronApp = await launchDevElectronAppWithArgs([]);
		const firstRunPage = await electronApp.firstWindow();
		registerRendererConsoleLogging(firstRunPage);

		await emitOpenFile(electronApp, filePath);
		const filePage = await pageWithTitle(electronApp, "solo.md");
		registerRendererConsoleLogging(filePage);

		await expectWindowCount(electronApp, 2);
		await expect(firstRunPage).toHaveTitle("Flashtype");
		await expect(
			filePage
				.locator('[data-view-key="flashtype_file"][data-active="true"]')
				.first(),
		).toBeVisible();
		await expect(filePage.getByRole("heading", { name: "Solo" })).toBeVisible();
		await expect(filePage.getByText("sibling.md")).toHaveCount(0);
		await expectPathMissing(path.join(directory, ".lix"));
		await expectPathMissing(path.join(directory, ".lix_system"));

		await filePage.evaluate(async () => {
			await window.flashtypeDesktop?.lix.execute({
				sql: "UPDATE lix_file SET data = $1 WHERE path = $2",
				params: [new TextEncoder().encode("# Updated\n"), "/solo.md"],
			});
		});

		await expect
			.poll(async () => await readFile(filePath, "utf8"))
			.toBe("# Updated\n");
		expect(await readFile(siblingPath, "utf8")).toBe("# Sibling\n");
		await expectPathMissing(path.join(directory, ".lix"));
		await expectPathMissing(path.join(directory, ".lix_system"));
	} finally {
		await closeElectronApp(electronApp);
	}
});

async function writeMarkerFile(
	workspaceDir: string,
	fileName: string,
): Promise<void> {
	const filePath = path.join(workspaceDir, fileName);
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, `# ${fileName}\n`);
}

async function initializeLixWorkspace(workspaceDir: string): Promise<void> {
	const lix = await openLix({ backend: new FsBackend({ path: workspaceDir }) });
	await lix.close();
}

async function emitOpenFile(
	electronApp: ElectronApplication,
	filePath: string,
): Promise<void> {
	await electronApp.evaluate(({ app }, openedPath) => {
		app.emit(
			"open-file",
			{
				preventDefault() {},
			},
			openedPath,
		);
	}, filePath);
}

async function pageWithTitle(
	electronApp: ElectronApplication,
	title: string,
): Promise<Page> {
	await expect
		.poll(async () => {
			const pages = await electronApp.windows();
			return await Promise.all(pages.map((page) => page.title()));
		})
		.toContain(title);

	const pages = await electronApp.windows();
	for (const page of pages) {
		if ((await page.title()) === title) {
			return page;
		}
	}
	throw new Error(`Window with title ${title} was not found.`);
}

async function expectWindowCount(
	electronApp: ElectronApplication,
	count: number,
): Promise<void> {
	await expect
		.poll(async () => (await electronApp.windows()).length)
		.toBe(count);
}

async function expectPathMissing(filePath: string): Promise<void> {
	try {
		await stat(filePath);
		throw new Error(`${filePath} exists`);
	} catch (error) {
		expect(error).toMatchObject({ code: "ENOENT" });
	}
}
