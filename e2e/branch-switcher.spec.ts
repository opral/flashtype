import { expect, test, type Page } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import { FsBackend, openLix } from "@lix-js/sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	closeElectronApp,
	ensureFilesViewOpenInLeftPanel,
	expectPathMissing,
	fileTreeFile,
	launchDevElectronApp,
	registerRendererConsoleLogging,
} from "./electron-test-utils";

test("persistent workspace branch switching keeps sidebar and disk on the active branch", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("persistent-branch-workspace");
	const sharedPath = path.join(workspaceDir, "shared.md");
	const draftOnlyPath = path.join(workspaceDir, "draft-only.md");

	let electronApp: ElectronApplication | undefined;
	try {
		await mkdir(workspaceDir, { recursive: true });
		await writeFile(sharedPath, "# Main shared\n", "utf8");
		await writeFile(
			path.join(workspaceDir, "main-only.md"),
			"# Main only\n",
			"utf8",
		);
		await initializeLixWorkspace(workspaceDir);

		electronApp = await launchDevElectronApp(workspaceDir);
		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await ensureFilesViewOpenInLeftPanel(page);
		await expect(fileTreeFile(page, "/shared.md")).toBeVisible();
		await expect(fileTreeFile(page, "/main-only.md")).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Select branch" }),
		).toHaveText(/Current Checkpoint/);

		await createBranchFromUi(page, "draft-ui");
		await expect(
			page.getByRole("button", { name: "Select branch" }),
		).toHaveText(/Current Checkpoint/);

		await switchBranchFromUi(page, "draft-ui");
		await expect(
			page.getByRole("button", { name: "Select branch" }),
		).toHaveText(/draft-ui/);

		await writeDraftBranchState(page);
		await expect(fileTreeFile(page, "/draft-only.md")).toBeVisible();
		await expect(fileTreeFile(page, "/shared.md")).toBeVisible();
		await expectDiskText(sharedPath, "# Draft shared\n");
		await expectDiskText(draftOnlyPath, "# Draft only\n");

		await switchBranchFromUi(page, "Current Checkpoint");
		await expect(
			page.getByRole("button", { name: "Select branch" }),
		).toHaveText(/Current Checkpoint/);
		await expect(fileTreeFile(page, "/shared.md")).toBeVisible();
		await expect(fileTreeFile(page, "/main-only.md")).toBeVisible();
		await expect(fileTreeFile(page, "/draft-only.md")).toHaveCount(0);
		await expectDiskText(sharedPath, "# Main shared\n");
		await expectPathMissing(draftOnlyPath);
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("ephemeral workspace shows enabled branch UI", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("ephemeral-branch-workspace");

	let electronApp: ElectronApplication | undefined;
	try {
		await mkdir(workspaceDir, { recursive: true });
		await writeFile(path.join(workspaceDir, "note.md"), "# Note\n", "utf8");

		electronApp = await launchDevElectronApp(workspaceDir);
		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await ensureFilesViewOpenInLeftPanel(page);
		await expect(fileTreeFile(page, "/note.md")).toBeVisible();
		await expectPathMissing(path.join(workspaceDir, ".lix"));

		const branchTrigger = page.getByRole("button", { name: "Select branch" });
		await expect(branchTrigger).toBeEnabled();
		await expect(branchTrigger).toHaveText(/Current Checkpoint/);
		await branchTrigger.click();
		await expect(
			page.getByRole("menuitem", { name: "Checkpoint" }),
		).toBeVisible();
	} finally {
		await closeElectronApp(electronApp);
	}
});

async function initializeLixWorkspace(workspaceDir: string): Promise<void> {
	const lix = await openLix({
		backend: new FsBackend({ path: workspaceDir, syncAllFiles: true }),
	});
	await lix.close();
}

async function createBranchFromUi(
	page: Page,
	branchName: string,
): Promise<void> {
	await openBranchMenu(page);
	await page.getByRole("menuitem", { name: "Checkpoint" }).click();
	const input = page.getByRole("textbox", { name: "Branch name" });
	await expect(input).toBeVisible();
	await expect(input).toHaveValue("draft-2");
	await input.fill(branchName);
	await input.press("Enter");
	await expect(input).toBeHidden();
	await openBranchMenu(page);
	await expect(page.getByRole("menuitem", { name: branchName })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("menuitem", { name: "Checkpoint" })).toHaveCount(
		0,
	);
}

async function switchBranchFromUi(
	page: Page,
	branchName: string,
): Promise<void> {
	await openBranchMenu(page);
	await page.getByRole("menuitem", { name: branchName }).click();
}

async function openBranchMenu(page: Page): Promise<void> {
	const trigger = page.getByRole("button", { name: "Select branch" });
	await expect(trigger).toBeEnabled();
	await trigger.click();
	await expect(
		page.getByRole("menuitem", { name: "Checkpoint" }),
	).toBeVisible();
}

async function writeDraftBranchState(page: Page): Promise<void> {
	await page.evaluate(async () => {
		const encoder = new TextEncoder();
		await window.flashtypeDesktop?.lix.execute({
			sql: "UPDATE lix_file SET data = $1 WHERE path = $2",
			params: [encoder.encode("# Draft shared\n"), "/shared.md"],
		});
		await window.flashtypeDesktop?.lix.execute({
			sql: "INSERT INTO lix_file (path, data) VALUES ($1, $2)",
			params: ["/draft-only.md", encoder.encode("# Draft only\n")],
		});
	});
}

async function expectDiskText(
	filePath: string,
	expected: string,
): Promise<void> {
	await expect
		.poll(async () => await readFile(filePath, "utf8"))
		.toBe(expected);
}
