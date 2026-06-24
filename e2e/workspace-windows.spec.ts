import { expect, test, type Page } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import { FsBackend, openLix } from "@lix-js/sdk";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	closeElectronApp,
	expectInstalledPluginArchives,
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

test("relaunch reopens saved directory and transient file workspaces", async ({
	browserName: _browserName,
}, testInfo) => {
	const userDataDir = testInfo.outputPath("user-data");
	const workspaceDir = testInfo.outputPath("directory-workspace");
	const standaloneFileDir = testInfo.outputPath("standalone-files");
	const standaloneFilePath = path.join(standaloneFileDir, "solo.md");

	let electronApp: ElectronApplication | undefined;
	try {
		await writeMarkerFile(workspaceDir, "directory-marker.md");
		await mkdir(standaloneFileDir, { recursive: true });
		await writeFile(standaloneFilePath, "# Solo\n");

		electronApp = await launchDevElectronAppWithArgs(
			[workspaceDir, standaloneFilePath],
			{ userDataDir },
		);
		await pageWithTitle(electronApp, path.basename(workspaceDir));
		await pageWithTitle(electronApp, path.basename(standaloneFileDir));
		await expectWindowCount(electronApp, 2);

		await closeElectronApp(electronApp);
		electronApp = undefined;

		electronApp = await launchDevElectronAppWithArgs([], { userDataDir });
		const directoryPage = await pageWithTitle(
			electronApp,
			path.basename(workspaceDir),
		);
		const filePage = await pageWithTitle(
			electronApp,
			path.basename(standaloneFileDir),
		);
		registerRendererConsoleLogging(directoryPage);
		registerRendererConsoleLogging(filePage);

		await expectWindowCount(electronApp, 2);
		await expect(directoryPage.getByText("directory-marker.md")).toBeVisible();
		await expect(filePage.getByRole("heading", { name: "Solo" })).toBeVisible();
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("relaunch restores saved workspaces with explicit paths deduped last", async ({
	browserName: _browserName,
}, testInfo) => {
	const userDataDir = testInfo.outputPath("user-data");
	const firstWorkspaceDir = testInfo.outputPath("first-workspace");
	const secondWorkspaceDir = testInfo.outputPath("second-workspace");
	const standaloneFileDir = testInfo.outputPath("standalone-files");
	const standaloneFilePath = path.join(standaloneFileDir, "solo.md");

	let electronApp: ElectronApplication | undefined;
	try {
		await writeMarkerFile(firstWorkspaceDir, "first-marker.md");
		await writeMarkerFile(secondWorkspaceDir, "second-marker.md");
		await mkdir(standaloneFileDir, { recursive: true });
		await writeFile(standaloneFilePath, "# Solo\n");

		electronApp = await launchDevElectronAppWithArgs(
			[firstWorkspaceDir, standaloneFilePath],
			{ userDataDir },
		);
		await pageWithTitle(electronApp, path.basename(firstWorkspaceDir));
		await pageWithTitle(electronApp, path.basename(standaloneFileDir));
		await expectWindowCount(electronApp, 2);

		await closeElectronApp(electronApp);
		electronApp = undefined;

		electronApp = await launchDevElectronAppWithArgs(
			[firstWorkspaceDir, secondWorkspaceDir],
			{ userDataDir },
		);
		const firstPage = await pageWithTitle(
			electronApp,
			path.basename(firstWorkspaceDir),
		);
		const secondPage = await pageWithTitle(
			electronApp,
			path.basename(secondWorkspaceDir),
		);
		const filePage = await pageWithTitle(
			electronApp,
			path.basename(standaloneFileDir),
		);
		registerRendererConsoleLogging(firstPage);
		registerRendererConsoleLogging(secondPage);
		registerRendererConsoleLogging(filePage);

		await expectWindowCount(electronApp, 3);
		await expectTitleCount(electronApp, path.basename(firstWorkspaceDir), 1);
		await expectTitleCount(electronApp, path.basename(secondWorkspaceDir), 1);
		await expectTitleCount(electronApp, path.basename(standaloneFileDir), 1);
		await expect(firstPage.getByText("first-marker.md")).toBeVisible();
		await expect(secondPage.getByText("second-marker.md")).toBeVisible();
		await expect(filePage.getByRole("heading", { name: "Solo" })).toBeVisible();
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("closed workspace windows are removed from the relaunch session", async ({
	browserName: _browserName,
}, testInfo) => {
	const userDataDir = testInfo.outputPath("user-data");
	const firstWorkspaceDir = testInfo.outputPath("first-workspace");
	const secondWorkspaceDir = testInfo.outputPath("second-workspace");

	let electronApp: ElectronApplication | undefined;
	try {
		await writeMarkerFile(firstWorkspaceDir, "first-marker.md");
		await writeMarkerFile(secondWorkspaceDir, "second-marker.md");

		electronApp = await launchDevElectronAppWithArgs(
			[firstWorkspaceDir, secondWorkspaceDir],
			{ userDataDir },
		);
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
		await expectWindowCount(electronApp, 2);

		await secondPage.close();
		await expectWindowCount(electronApp, 1);
		await expectWorkspaceSessionPaths(userDataDir, [firstWorkspaceDir]);

		await closeElectronApp(electronApp);
		electronApp = undefined;

		electronApp = await launchDevElectronAppWithArgs([], { userDataDir });
		const restoredPage = await pageWithTitle(
			electronApp,
			path.basename(firstWorkspaceDir),
		);
		registerRendererConsoleLogging(restoredPage);

		await expectWindowCount(electronApp, 1);
		await expectTitleCount(electronApp, path.basename(secondWorkspaceDir), 0);
		await expect(restoredPage.getByText("first-marker.md")).toBeVisible();
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("stale saved workspace paths are skipped on relaunch", async ({
	browserName: _browserName,
}, testInfo) => {
	const userDataDir = testInfo.outputPath("user-data");
	const staleWorkspacePath = testInfo.outputPath("missing-workspace");

	let electronApp: ElectronApplication | undefined;
	try {
		await writeWorkspaceSession(userDataDir, [staleWorkspacePath]);

		electronApp = await launchDevElectronAppWithArgs([], { userDataDir });
		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await expectWindowCount(electronApp, 1);
		await expect(page).toHaveTitle("Flashtype");
		await expect(page.getByText("Open a folder")).toBeVisible();
		await expectWorkspaceSessionPaths(userDataDir, []);
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

test("Track Changes menu toggles workspace .lix storage", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("track-changes-workspace");
	const filePath = path.join(workspaceDir, "marker.md");

	let electronApp: ElectronApplication | undefined;
	try {
		await writeMarkerFile(workspaceDir, "marker.md");

		electronApp = await launchDevElectronAppWithArgs([workspaceDir]);
		const page = await pageWithTitle(electronApp, path.basename(workspaceDir));
		registerRendererConsoleLogging(page);

		await expect(page.getByText("marker.md")).toBeVisible();
		await expectTrackChangesMenuChecked(electronApp, false);
		await expectPathMissing(path.join(workspaceDir, ".lix"));

		await page.evaluate(async () => {
			await window.flashtypeDesktop?.lix.execute({
				sql: "UPDATE lix_file SET data = $1 WHERE path = $2",
				params: [
					new TextEncoder().encode("# Updated while off\n"),
					"/marker.md",
				],
			});
		});
		await expect
			.poll(async () => await readFile(filePath, "utf8"))
			.toBe("# Updated while off\n");
		await expectPathMissing(path.join(workspaceDir, ".lix"));

		await clickTrackChangesMenuItemAndWaitForReload(electronApp, page);
		await expect(page).toHaveTitle(path.basename(workspaceDir));
		await expect(page.getByText("marker.md")).toBeVisible();
		await expectTrackChangesMenuChecked(electronApp, true);
		await expectPathExists(path.join(workspaceDir, ".lix"));
		await expectInstalledPluginArchives(workspaceDir);

		await clickTrackChangesMenuItemAndWaitForReload(electronApp, page);
		await expect(page).toHaveTitle(path.basename(workspaceDir));
		await expect(page.getByText("marker.md")).toBeVisible();
		await expectTrackChangesMenuChecked(electronApp, false);
		await expectPathMissing(path.join(workspaceDir, ".lix"));
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
			filePage.getByRole("heading", { name: "file-marker.md" }),
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

test("macOS open-file events open standalone files as transient workspaces", async ({
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
		const filePage = await pageWithTitle(electronApp, path.basename(directory));
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
		await filePage.evaluate(async () => {
			await window.flashtypeDesktop?.lix.execute({
				sql: "INSERT INTO lix_file (path, data) VALUES ($1, $2)",
				params: ["/generated.md", new TextEncoder().encode("# Generated\n")],
			});
		});
		await expect
			.poll(
				async () =>
					await readFile(path.join(directory, "generated.md"), "utf8"),
			)
			.toBe("# Generated\n");
		await expectPathMissing(path.join(directory, ".lix"));
		await expectPathMissing(path.join(directory, ".lix_system"));
		await filePage.evaluate(async () => {
			await window.flashtypeDesktop?.lix.execute({
				sql: "INSERT INTO lix_file (path, data) VALUES ($1, $2)",
				params: [
					"/.lix/app_data/transient-test.bin",
					new TextEncoder().encode("internal"),
				],
			});
		});
		await expectPathMissing(path.join(directory, ".lix"));
		await expectPathMissing(path.join(directory, ".lix_system"));
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("launching with multiple standalone markdown files creates one grouped transient workspace", async ({
	browserName: _browserName,
}, testInfo) => {
	const firstDirectory = testInfo.outputPath("standalone-markdown-alpha");
	const secondDirectory = testInfo.outputPath("standalone-markdown-beta");
	const groupedWorkspaceDir = path.dirname(firstDirectory);
	const firstPath = path.join(firstDirectory, "alpha.md");
	const secondPath = path.join(secondDirectory, "beta.markdown");
	const siblingPath = path.join(firstDirectory, "sibling.md");

	let electronApp: ElectronApplication | undefined;
	try {
		await mkdir(firstDirectory, { recursive: true });
		await mkdir(secondDirectory, { recursive: true });
		await writeFile(firstPath, "# Alpha\n");
		await writeFile(secondPath, "# Beta\n");
		await writeFile(siblingPath, "# Sibling\n");

		electronApp = await launchDevElectronAppWithArgs([firstPath, secondPath]);
		const groupedPage = await pageWithTitle(
			electronApp,
			path.basename(groupedWorkspaceDir),
		);
		registerRendererConsoleLogging(groupedPage);

		await expectWindowCount(electronApp, 1);
		await expect(
			groupedPage.getByRole("heading", { name: "Alpha" }),
		).toBeVisible();
		await groupedPage
			.getByTestId("file-tree-directory-standalone-markdown-alpha")
			.click();
		await expect(
			groupedPage.getByTestId(
				"file-tree-item-standalone-markdown-alpha-alpha-md",
			),
		).toBeVisible();
		await expect(groupedPage.getByText("sibling.md")).toHaveCount(0);
		await groupedPage
			.getByTestId("file-tree-directory-standalone-markdown-beta")
			.click();
		const betaItem = groupedPage.getByTestId(
			"file-tree-item-standalone-markdown-beta-beta-markdown",
		);
		await expect(betaItem).toBeVisible();
		await betaItem.click();
		await expect(
			groupedPage.getByRole("heading", { name: "Beta" }),
		).toBeVisible();
		await expectPathMissing(path.join(groupedWorkspaceDir, ".lix"));
		await expectPathMissing(path.join(firstDirectory, ".lix"));
		await expectPathMissing(path.join(secondDirectory, ".lix"));
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("macOS open-file events create one transient window per standalone file", async ({
	browserName: _browserName,
}, testInfo) => {
	const firstDirectory = testInfo.outputPath("standalone-open-file-first");
	const secondDirectory = testInfo.outputPath("standalone-open-file-second");
	const firstPath = path.join(firstDirectory, "first.md");
	const secondPath = path.join(secondDirectory, "second.md");

	let electronApp: ElectronApplication | undefined;
	try {
		await mkdir(firstDirectory, { recursive: true });
		await mkdir(secondDirectory, { recursive: true });
		await writeFile(firstPath, "# First\n");
		await writeFile(secondPath, "# Second\n");

		electronApp = await launchDevElectronAppWithArgs([]);
		const firstRunPage = await electronApp.firstWindow();
		registerRendererConsoleLogging(firstRunPage);

		await emitOpenFiles(electronApp, [firstPath, secondPath]);
		const firstPage = await pageWithTitle(
			electronApp,
			path.basename(firstDirectory),
		);
		const secondPage = await pageWithTitle(
			electronApp,
			path.basename(secondDirectory),
		);
		registerRendererConsoleLogging(firstPage);
		registerRendererConsoleLogging(secondPage);

		await expectWindowCount(electronApp, 3);
		await expect(firstRunPage).toHaveTitle("Flashtype");
		await expect(
			firstPage.getByRole("heading", { name: "First" }),
		).toBeVisible();
		await expect(
			secondPage.getByRole("heading", { name: "Second" }),
		).toBeVisible();
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("mixed folder and standalone markdown args create folder and grouped file windows", async ({
	browserName: _browserName,
}, testInfo) => {
	const folderWorkspaceDir = testInfo.outputPath("folder-workspace");
	const firstMarkdownDir = testInfo.outputPath("standalone-mixed-one");
	const secondMarkdownDir = testInfo.outputPath("standalone-mixed-two");
	const groupedMarkdownDir = path.dirname(firstMarkdownDir);
	const firstPath = path.join(firstMarkdownDir, "one.md");
	const secondPath = path.join(secondMarkdownDir, "two.md");

	let electronApp: ElectronApplication | undefined;
	try {
		await writeMarkerFile(folderWorkspaceDir, "folder-marker.md");
		await mkdir(firstMarkdownDir, { recursive: true });
		await mkdir(secondMarkdownDir, { recursive: true });
		await writeFile(firstPath, "# One\n");
		await writeFile(secondPath, "# Two\n");

		electronApp = await launchDevElectronAppWithArgs([
			folderWorkspaceDir,
			firstPath,
			secondPath,
		]);
		const folderPage = await pageWithTitle(
			electronApp,
			path.basename(folderWorkspaceDir),
		);
		const groupedFilePage = await pageWithTitle(
			electronApp,
			path.basename(groupedMarkdownDir),
		);
		registerRendererConsoleLogging(folderPage);
		registerRendererConsoleLogging(groupedFilePage);

		await expectWindowCount(electronApp, 2);
		await expect(folderPage.getByText("folder-marker.md")).toBeVisible();
		await expect(
			groupedFilePage.getByRole("heading", { name: "One" }),
		).toBeVisible();
		await expect(groupedFilePage.getByText("folder-marker.md")).toHaveCount(0);
		await groupedFilePage
			.getByTestId("file-tree-directory-standalone-mixed-two")
			.click();
		const secondItem = groupedFilePage.getByTestId(
			"file-tree-item-standalone-mixed-two-two-md",
		);
		await expect(secondItem).toBeVisible();
		await secondItem.click();
		await expect(
			groupedFilePage.getByRole("heading", { name: "Two" }),
		).toBeVisible();
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("relaunch restores grouped transient file workspace", async ({
	browserName: _browserName,
}, testInfo) => {
	const userDataDir = testInfo.outputPath("user-data");
	const firstDirectory = testInfo.outputPath("restore-markdown-first");
	const secondDirectory = testInfo.outputPath("restore-markdown-second");
	const groupedWorkspaceDir = path.dirname(firstDirectory);
	const firstPath = path.join(firstDirectory, "first.md");
	const secondPath = path.join(secondDirectory, "second.md");

	let electronApp: ElectronApplication | undefined;
	try {
		await mkdir(firstDirectory, { recursive: true });
		await mkdir(secondDirectory, { recursive: true });
		await writeFile(firstPath, "# First\n");
		await writeFile(secondPath, "# Second\n");

		electronApp = await launchDevElectronAppWithArgs([firstPath, secondPath], {
			userDataDir,
		});
		await pageWithTitle(electronApp, path.basename(groupedWorkspaceDir));
		await expectWindowCount(electronApp, 1);

		await closeElectronApp(electronApp);
		electronApp = undefined;

		electronApp = await launchDevElectronAppWithArgs([], { userDataDir });
		const restoredPage = await pageWithTitle(
			electronApp,
			path.basename(groupedWorkspaceDir),
		);
		registerRendererConsoleLogging(restoredPage);

		await expectWindowCount(electronApp, 1);
		await expect(
			restoredPage.getByRole("heading", { name: "First" }),
		).toBeVisible();
		await restoredPage
			.getByTestId("file-tree-directory-restore-markdown-second")
			.click();
		const restoredSecondItem = restoredPage.getByTestId(
			"file-tree-item-restore-markdown-second-second-md",
		);
		await expect(restoredSecondItem).toBeVisible();
		await restoredSecondItem.click();
		await expect(
			restoredPage.getByRole("heading", { name: "Second" }),
		).toBeVisible();
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

async function emitOpenFiles(
	electronApp: ElectronApplication,
	filePaths: string[],
): Promise<void> {
	await electronApp.evaluate(({ app }, openedPaths) => {
		for (const openedPath of openedPaths) {
			app.emit(
				"open-file",
				{
					preventDefault() {},
				},
				openedPath,
			);
		}
	}, filePaths);
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

async function expectTitleCount(
	electronApp: ElectronApplication,
	title: string,
	count: number,
): Promise<void> {
	await expect
		.poll(async () => {
			const pages = await electronApp.windows();
			const titles = await Promise.all(pages.map((page) => page.title()));
			return titles.filter((candidate) => candidate === title).length;
		})
		.toBe(count);
}

async function clickTrackChangesMenuItem(
	electronApp: ElectronApplication,
): Promise<void> {
	await electronApp.evaluate(({ BrowserWindow, Menu }) => {
		const item = Menu.getApplicationMenu()?.getMenuItemById("track-changes");
		if (!item || !item.enabled || typeof item.click !== "function") {
			throw new Error("Track Changes menu item is not available.");
		}
		item.click(
			{ checked: !item.checked } as any,
			BrowserWindow.getFocusedWindow(),
			{} as any,
		);
	});
}

async function clickTrackChangesMenuItemAndWaitForReload(
	electronApp: ElectronApplication,
	page: Page,
): Promise<void> {
	await Promise.all([
		page.waitForNavigation({ waitUntil: "domcontentloaded" }),
		clickTrackChangesMenuItem(electronApp),
	]);
}

async function expectTrackChangesMenuChecked(
	electronApp: ElectronApplication,
	checked: boolean,
): Promise<void> {
	await expect
		.poll(async () =>
			electronApp.evaluate(({ Menu }) => {
				return Menu.getApplicationMenu()?.getMenuItemById("track-changes")
					?.checked;
			}),
		)
		.toBe(checked);
}

async function expectPathExists(filePath: string): Promise<void> {
	await expect
		.poll(async () => {
			try {
				await stat(filePath);
				return true;
			} catch {
				return false;
			}
		})
		.toBe(true);
}

async function expectPathMissing(filePath: string): Promise<void> {
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

async function writeWorkspaceSession(
	userDataDir: string,
	workspacePaths: string[],
): Promise<void> {
	await mkdir(userDataDir, { recursive: true });
	await writeFile(
		workspaceSessionPath(userDataDir),
		`${JSON.stringify(
			{
				version: 4,
				workspaces: workspacePaths.map((workspacePath) => ({
					path: workspacePath,
					openFilePaths: [],
				})),
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
}

async function expectWorkspaceSessionPaths(
	userDataDir: string,
	workspacePaths: string[],
): Promise<void> {
	await expect
		.poll(async () => {
			try {
				const store = JSON.parse(
					await readFile(workspaceSessionPath(userDataDir), "utf8"),
				);
				return Array.isArray(store.workspaces)
					? store.workspaces.map((workspace: any) => workspace.path)
					: null;
			} catch {
				return null;
			}
		})
		.toEqual(workspacePaths);
}

function workspaceSessionPath(userDataDir: string): string {
	return path.join(userDataDir, "workspace-session.json");
}
