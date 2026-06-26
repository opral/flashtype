import { expect, test } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
	closeElectronApp,
	ensureFilesViewOpenInLeftPanel,
	expectPathMissing,
	launchPackagedElectronApp,
	registerRendererConsoleLogging,
	repoRoot,
	writeStarterFiles,
} from "./electron-test-utils";

const execFileAsync = promisify(execFile);
const appBundlePath = path.join(
	repoRoot,
	"release",
	"mac-arm64",
	"Flashtype.app",
);
const packagedAppExecutablePath = path.join(
	appBundlePath,
	"Contents",
	"MacOS",
	"Flashtype",
);
const packagedInfoPlistPath = path.join(
	appBundlePath,
	"Contents",
	"Info.plist",
);
const unpackedResourcesPath = path.join(
	appBundlePath,
	"Contents",
	"Resources",
	"app.asar.unpacked",
);
const nativeModulePaths = [
	path.join(
		unpackedResourcesPath,
		"node_modules",
		"@lix-js",
		"sdk",
		"lix_js_sdk.node",
	),
	path.join(
		unpackedResourcesPath,
		"submodule",
		"lix",
		"packages",
		"js-sdk",
		"lix_js_sdk.node",
	),
	path.join(
		unpackedResourcesPath,
		"node_modules",
		"node-pty",
		"prebuilds",
		"darwin-arm64",
		"pty.node",
	),
	path.join(
		unpackedResourcesPath,
		"node_modules",
		"node-pty",
		"prebuilds",
		"darwin-arm64",
		"spawn-helper",
	),
];

test.skip(
	process.platform !== "darwin",
	"packaged macOS smoke tests require macOS",
);

test("packaged app includes arm64 native modules", async () => {
	await expectDirectory(appBundlePath);
	await expectFile(packagedAppExecutablePath);

	for (const nativeModulePath of nativeModulePaths) {
		await test.step(`arm64 native module: ${path.relative(repoRoot, nativeModulePath)}`, async () => {
			await expectFile(nativeModulePath);
			const { stdout } = await execFileAsync("file", [nativeModulePath]);

			expect(stdout).toContain("Mach-O");
			expect(stdout).toContain("arm64");
		});
	}
});

test("packaged app declares folder document support", async () => {
	await expectFile(packagedInfoPlistPath);

	const { stdout } = await execFileAsync("/usr/libexec/PlistBuddy", [
		"-c",
		"Print :CFBundleDocumentTypes",
		packagedInfoPlistPath,
	]);

	expect(stdout).toContain("public.folder");
	expect(stdout).toContain("Markdown Document");
});

test("packaged app launches, seeds, and opens files without Vite", async ({
	browserName: _browserName,
}, testInfo) => {
	await expectDirectory(appBundlePath);
	await expectFile(packagedAppExecutablePath);

	const workspaceDir = testInfo.outputPath("workspace");
	let electronApp: ElectronApplication | undefined;
	try {
		await writeStarterFiles(workspaceDir);
		electronApp = await launchPackagedElectronApp({
			executablePath: packagedAppExecutablePath,
			workspaceDir,
		});

		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await expect(page.getByTestId("central-panel-empty-state")).toBeVisible();
		await expectPathMissing(path.join(workspaceDir, ".lix"));
		await ensureFilesViewOpenInLeftPanel(page);

		const firstFile = page.locator('[data-testid^="file-tree-item-"]').first();
		await expect(firstFile).toBeVisible();
		await firstFile.click();
		await expect(firstFile).toHaveAttribute("data-selected", "true");
		await expect(
			page.locator('[data-view-key="flashtype_file"]').first(),
		).toBeVisible();
	} finally {
		await closeElectronApp(electronApp);
	}
});

async function expectDirectory(directoryPath: string): Promise<void> {
	const stats = await stat(directoryPath);
	expect(stats.isDirectory()).toBe(true);
}

async function expectFile(filePath: string): Promise<void> {
	const stats = await stat(filePath);
	expect(stats.isFile()).toBe(true);
}
