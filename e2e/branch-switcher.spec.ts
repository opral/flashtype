import { expect, test, type Page } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import { FsBackend, openLix } from "@lix-js/sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	closeElectronApp,
	ensureFilesViewOpenInLeftPanel,
	ensureHistoryViewOpenInLeftPanel,
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
		await ensureHistoryViewOpenInLeftPanel(page);
		await expectCurrentCheckpointActive(page);

		await createCheckpointFromUi(page);
		await expectCurrentCheckpointActive(page);

		await switchBranchFromUi(page, "Naming checkpoint...");
		await expectCheckpointActive(page, "Naming checkpoint...");

		await ensureFilesViewOpenInLeftPanel(page);
		await writeDraftBranchState(page);
		await expect(fileTreeFile(page, "/draft-only.md")).toBeVisible();
		await expect(fileTreeFile(page, "/shared.md")).toBeVisible();
		await expectDiskText(sharedPath, "# Draft shared\n");
		await expectDiskText(draftOnlyPath, "# Draft only\n");

		await switchBranchFromUi(page, "Current Checkpoint");
		await expectCurrentCheckpointActive(page);
		await ensureFilesViewOpenInLeftPanel(page);
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

		await ensureHistoryViewOpenInLeftPanel(page);
		await expectCurrentCheckpointActive(page);
		await expect(
			page.getByRole("button", { name: "Create checkpoint" }),
		).toBeVisible();
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("checkpoint row click opens a read-only diff against the previous visible checkpoint", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("checkpoint-diff-workspace");

	let electronApp: ElectronApplication | undefined;
	try {
		await mkdir(workspaceDir, { recursive: true });
		await writeFile(path.join(workspaceDir, "seed.md"), "# Seed\n", "utf8");
		await initializeLixWorkspace(workspaceDir);

		electronApp = await launchDevElectronApp(workspaceDir);
		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		const setup = await createCheckpointDiffBranches(page);

		await ensureHistoryViewOpenInLeftPanel(page);
		await expect
			.poll(async () => await checkpointRowLabels(page))
			.toEqual(["a-previous", "b-target", "Current Checkpoint"]);

		const targetCheckpoint = page.getByRole("button", {
			name: "b-target",
			exact: true,
		});
		await targetCheckpoint.click();
		await expect(targetCheckpoint).toHaveAttribute("data-selected", "true");
		await expect(targetCheckpoint).not.toHaveAttribute("aria-current", "true");
		await expect
			.poll(async () => await activeBranchIdFromUi(page))
			.toBe(setup.activeBranchId);

		await expect(page.locator(".markdown-review-overlay")).toBeVisible();
		await expect(
			page.locator(".markdown-review-overlay [data-diff-status]").first(),
		).toBeVisible();
		await expect(page.getByText("Added only in target")).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Keep", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Undo", exact: true }),
		).toHaveCount(0);

		await ensureFilesViewOpenInLeftPanel(page);
		for (const filePath of ["/added.md", "/removed.md", "/shared.md"]) {
			const file = fileTreeFile(page, filePath);
			await expect(file).toBeVisible();
			await expect(file).toHaveAttribute("data-item-git-status", "modified");
		}

		await fileTreeFile(page, "/shared.md").click();
		await expect(page.locator(".markdown-review-overlay")).toBeVisible();
		await expect(
			page.locator(".markdown-review-overlay [data-diff-status]").first(),
		).toBeVisible();
		await expect(page.getByText("Previous snapshot")).toBeVisible();
		await expect(page.getByText("Target snapshot")).toBeVisible();

		await fileTreeFile(page, "/added.md").click();
		await expect(page.locator(".markdown-review-overlay")).toBeVisible();
		await expect(
			page.locator(".markdown-review-overlay [data-diff-status]").first(),
		).toBeVisible();
		await expect(page.getByText("Added only in target")).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Keep", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Undo", exact: true }),
		).toHaveCount(0);
		await expect
			.poll(async () => await activeBranchIdFromUi(page))
			.toBe(setup.activeBranchId);
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

async function createCheckpointFromUi(page: Page): Promise<void> {
	await ensureHistoryViewOpenInLeftPanel(page);
	await page.getByRole("button", { name: "Create checkpoint" }).click();
	await expect(
		page.getByRole("button", { name: "Naming checkpoint...", exact: true }),
	).toBeVisible();
}

async function switchBranchFromUi(
	page: Page,
	branchName: string,
): Promise<void> {
	await ensureHistoryViewOpenInLeftPanel(page);
	await page
		.getByRole("button", {
			name: `Checkpoint actions for ${branchName}`,
			exact: true,
		})
		.click();
	await page.getByRole("menuitem", { name: "Restore", exact: true }).click();
}

async function expectCurrentCheckpointActive(page: Page): Promise<void> {
	await expectCheckpointActive(page, "Current Checkpoint");
}

async function expectCheckpointActive(
	page: Page,
	checkpointName: string,
): Promise<void> {
	const checkpoint = page.getByRole("button", {
		name: checkpointName,
		exact: true,
	});
	await expect(checkpoint).toBeEnabled();
	await expect(checkpoint).toHaveAttribute("aria-current", "true");
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

async function createCheckpointDiffBranches(
	page: Page,
): Promise<{ activeBranchId: string }> {
	return await page.evaluate(async () => {
		const lix = window.flashtypeDesktop?.lix;
		if (!lix) {
			throw new Error("Desktop Lix bridge is unavailable");
		}

		const encoder = new TextEncoder();
		const data = (text: string) => encoder.encode(text);
		const paths = ["/shared.md", "/added.md", "/removed.md"];

		await lix.execute({
			sql: "DELETE FROM lix_file WHERE path IN ($1, $2, $3)",
			params: paths,
		});
		await lix.execute({
			sql: "INSERT INTO lix_file (id, path, data) VALUES ($1, $2, $3), ($4, $5, $6)",
			params: [
				"e2e_shared",
				"/shared.md",
				data("# Shared\n\nTarget snapshot\n"),
				"e2e_added",
				"/added.md",
				data("# Added\n\nAdded only in target\n"),
			],
		});
		await lix.createBranch({ options: { name: "b-target" } });

		await lix.execute({
			sql: "UPDATE lix_file SET data = $1 WHERE id = $2",
			params: [data("# Shared\n\nPrevious snapshot\n"), "e2e_shared"],
		});
		await lix.execute({
			sql: "DELETE FROM lix_file WHERE id = $1",
			params: ["e2e_added"],
		});
		await lix.execute({
			sql: "INSERT INTO lix_file (id, path, data) VALUES ($1, $2, $3)",
			params: [
				"e2e_removed",
				"/removed.md",
				data("# Removed\n\nRemoved before target\n"),
			],
		});
		await lix.createBranch({ options: { name: "a-previous" } });

		return { activeBranchId: await lix.activeBranchId() };
	});
}

async function checkpointRowLabels(page: Page): Promise<string[]> {
	return await page
		.locator('[data-attr="branch-diff"]')
		.evaluateAll((rows) =>
			rows.map((row) => (row.textContent ?? "").replace(/\s+/g, " ").trim()),
		);
}

async function activeBranchIdFromUi(page: Page): Promise<string | undefined> {
	return await page.evaluate(async () => {
		return await window.flashtypeDesktop?.lix.activeBranchId();
	});
}
