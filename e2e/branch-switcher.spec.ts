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

test("checkpoint row click marks files without auto-opening a diff", async ({
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
		await expect(page.locator(".markdown-review-overlay")).toHaveCount(0);

		await ensureFilesViewOpenInLeftPanel(page);
		for (const [filePath, status] of [
			["/added.md", "added"],
			["/removed.md", "deleted"],
			["/shared.md", "modified"],
		] as const) {
			const file = fileTreeFile(page, filePath);
			await expect(file).toBeVisible();
			await expect(file).toHaveAttribute("data-item-git-status", status);
		}

		await fileTreeFile(page, "/added.md").click();
		await expectMarkdownDiff(page, { added: ["Added only in target"] });

		await fileTreeFile(page, "/removed.md").click();
		await expectMarkdownDiff(page, { removed: ["Removed before target"] });

		await fileTreeFile(page, "/shared.md").click();
		await expectMarkdownDiff(page);
		await expect(
			page
				.locator(".markdown-review-overlay [data-diff-status='removed']")
				.filter({ hasText: "Previous" }),
		).toBeVisible();
		await expect(
			page
				.locator(".markdown-review-overlay [data-diff-status='added']")
				.filter({ hasText: "Target" }),
		).toBeVisible();
		await expect(
			page.locator(".markdown-review-overlay").getByText("snapshot"),
		).toBeVisible();
		await expect
			.poll(async () => await activeBranchIdFromUi(page))
			.toBe(setup.activeBranchId);
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("checkpoint diff selection keeps the active editor and toggles revision state", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath(
		"checkpoint-editor-revision-workspace",
	);

	let electronApp: ElectronApplication | undefined;
	try {
		await mkdir(workspaceDir, { recursive: true });
		await initializeLixWorkspace(workspaceDir);

		electronApp = await launchDevElectronApp(workspaceDir);
		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		const setup = await createCheckpointEditorRevisionMatrix(page);
		const firstInitialCommitId = await initialCommitIdForCommitFromUi(
			page,
			setup.firstCommitId,
		);
		await expectHistoryBranchOrder(page, [
			setup.firstBranchId,
			setup.secondBranchId,
			setup.activeBranchId,
		]);
		await expect
			.poll(async () => await activeBranchIdFromUi(page))
			.toBe(setup.activeBranchId);

		await openMarkdownFileFromTree(page, "/modified.md");
		await expectActiveEditorRevisionState(page, {
			beforeCommitId: null,
			afterCommitId: null,
		});
		await expectEditableMarkdown(page);
		await expectSingleCentralDocumentSlot(page);
		const modifiedDocument = await expectActiveCentralDocumentIdentityForPath(
			page,
			"/modified.md",
		);

		await clickCheckpointRow(page, 0);
		await expectCheckpointRowSelected(page, 0);
		await expectActiveCentralFile(page, "/modified.md");
		await expectActiveCentralDocumentIdentity(
			page,
			modifiedDocument,
			"first checkpoint selection should reuse the active modified.md document view",
		);
		await expectActiveBranchId(page, setup.activeBranchId);
		await expect
			.poll(async () => await activeEditorRevisionStateFromUi(page), {
				message:
					"first checkpoint selection should keep the editor as a diff from the initial commit",
				timeout: 3000,
			})
			.toEqual({
				beforeCommitId: firstInitialCommitId,
				afterCommitId: setup.firstCommitId,
			});
		await expectMarkdownDiff(page, {
			added: ["Modified at first checkpoint"],
		});
		await expectSingleCentralDocumentSlot(page);
		await expectFileTreeStatuses(
			page,
			{
				"/deleted.md": "added",
				"/head-deleted.md": "added",
				"/head-recreated.md": "added",
				"/modified.md": "added",
				"/recreated.md": "added",
			},
			"first checkpoint should mark every file as added from the initial commit",
		);

		await clickCheckpointRow(page, 1);
		await expectCheckpointRowSelected(page, 1);
		await expectActiveCentralFile(page, "/modified.md");
		await expectActiveCentralDocumentIdentity(
			page,
			modifiedDocument,
			"checkpoint-to-checkpoint selection should reuse the active modified.md document view",
		);
		await expectActiveBranchId(page, setup.activeBranchId);
		await expect
			.poll(async () => await activeEditorRevisionStateFromUi(page), {
				message:
					"checkpoint-to-checkpoint selection should keep the editor as a diff between checkpoints",
				timeout: 3000,
			})
			.toEqual({
				beforeCommitId: setup.firstCommitId,
				afterCommitId: setup.secondCommitId,
			});
		await expectMarkdownDiff(page, {
			added: ["second"],
			removed: ["first"],
		});
		await expectSingleCentralDocumentSlot(page);
		await expectFileTreeStatuses(
			page,
			{
				"/added.md": "added",
				"/deleted.md": "deleted",
				"/modified.md": "modified",
				"/recreated.md": "recreated",
			},
			"checkpoint-to-checkpoint diff should expose per-file statuses",
		);
		await expectFileTreeStatuses(
			page,
			{
				"/head-deleted.md": null,
				"/head-recreated.md": null,
			},
			"unchanged files in the checkpoint range should not be marked",
		);

		await clickCheckpointRow(page, 2);
		await expectCheckpointRowSelected(page, 2);
		await expectActiveCentralFile(page, "/modified.md");
		await expectActiveCentralDocumentIdentity(
			page,
			modifiedDocument,
			"current checkpoint selection should reuse the active modified.md document view",
		);
		await expectActiveBranchId(page, setup.activeBranchId);
		await expect
			.poll(async () => await activeEditorRevisionStateFromUi(page), {
				message:
					"current checkpoint selection should keep the editor as a diff from the previous checkpoint to HEAD",
				timeout: 3000,
			})
			.toEqual({
				beforeCommitId: setup.secondCommitId,
				afterCommitId: null,
			});
		await expectMarkdownDiff(page, {
			added: ["HEAD"],
			removed: ["second"],
		});
		await expectSingleCentralDocumentSlot(page);
		await expectFileTreeStatuses(
			page,
			{
				"/head-added.md": "added",
				"/head-deleted.md": "deleted",
				"/head-recreated.md": "recreated",
				"/modified.md": "modified",
			},
			"checkpoint-to-HEAD diff should expose per-file statuses",
		);
		await expectFileTreeStatuses(
			page,
			{
				"/added.md": null,
				"/recreated.md": null,
			},
			"unchanged checkpoint files should not be marked in checkpoint-to-HEAD diff",
		);

		await openMarkdownFileFromTree(page, "/added.md");
		await expectActiveCentralFile(page, "/added.md");
		const addedDocument = await expectActiveCentralDocumentIdentityForPath(
			page,
			"/added.md",
		);
		await expect
			.poll(async () => await activeEditorRevisionStateFromUi(page), {
				message:
					"unchanged visible file opened during checkpoint-to-HEAD diff should enter review mode",
				timeout: 3000,
			})
			.toEqual({
				beforeCommitId: setup.secondCommitId,
				afterCommitId: null,
			});
		await expectReadonlyMarkdown(page);
		await expectSingleCentralDocumentSlot(page);

		await clickCheckpointRow(page, 2);
		await expectNoCheckpointRowSelected(page);
		await expectActiveCentralFile(page, "/added.md");
		await expectActiveCentralDocumentIdentity(
			page,
			addedDocument,
			"clearing checkpoint-to-HEAD should reuse the active added.md document view",
		);
		await expectActiveBranchId(page, setup.activeBranchId);
		await expectActiveEditorRevisionState(page, {
			beforeCommitId: null,
			afterCommitId: null,
		});
		await expectEditableMarkdown(page);
		await expectSingleCentralDocumentSlot(page);

		await clickCheckpointRow(page, 2);
		await expectCheckpointRowSelected(page, 2);
		await expectActiveCentralFile(page, "/added.md");
		await expectActiveCentralDocumentIdentity(
			page,
			addedDocument,
			"reselecting checkpoint-to-HEAD should reuse the active added.md document view",
		);
		await expectActiveBranchId(page, setup.activeBranchId);
		await expect
			.poll(async () => await activeEditorRevisionStateFromUi(page), {
				message:
					"reselecting the checkpoint-to-HEAD diff should restore review mode on the active unchanged file",
				timeout: 3000,
			})
			.toEqual({
				beforeCommitId: setup.secondCommitId,
				afterCommitId: null,
			});
		await expectReadonlyMarkdown(page);
		await expectSingleCentralDocumentSlot(page);

		await openMarkdownFileFromTree(page, "/modified.md");
		await expectActiveCentralFile(page, "/modified.md");
		await expectActiveCentralDocumentIdentity(
			page,
			modifiedDocument,
			"reopening modified.md should restore the same central document identity",
		);
		await expect
			.poll(async () => await activeEditorRevisionStateFromUi(page), {
				message:
					"changed file opened after reselecting the checkpoint-to-HEAD diff should stay in review mode",
				timeout: 3000,
			})
			.toEqual({
				beforeCommitId: setup.secondCommitId,
				afterCommitId: null,
			});
		await expectMarkdownDiff(page, {
			added: ["HEAD"],
			removed: ["second"],
		});
		await expectSingleCentralDocumentSlot(page);

		await clickCheckpointRow(page, 2);
		await expectNoCheckpointRowSelected(page);
		await expectActiveCentralFile(page, "/modified.md");
		await expectActiveCentralDocumentIdentity(
			page,
			modifiedDocument,
			"clearing checkpoint-to-HEAD should reuse the active modified.md document view",
		);
		await expectActiveBranchId(page, setup.activeBranchId);
		await expectActiveEditorRevisionState(page, {
			beforeCommitId: null,
			afterCommitId: null,
		});
		await expectEditableMarkdown(page);
		await expectSingleCentralDocumentSlot(page);
		await expectFileTreeStatuses(
			page,
			{
				"/added.md": null,
				"/head-added.md": null,
				"/head-recreated.md": null,
				"/modified.md": null,
				"/recreated.md": null,
			},
			"clearing the checkpoint diff should clear file-view statuses",
		);
		await expect(fileTreeFile(page, "/deleted.md")).toHaveCount(0);
		await expect(fileTreeFile(page, "/head-deleted.md")).toHaveCount(0);
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

async function openMarkdownFileFromTree(
	page: Page,
	appPath: string,
): Promise<void> {
	await ensureFilesViewOpenInLeftPanel(page);
	const file = fileTreeFile(page, appPath);
	await expect(file).toBeVisible();
	await file.click();
	await expectActiveCentralFile(page, appPath);
}

async function createCheckpointFromUi(page: Page): Promise<string> {
	const beforeIds = await branchIdsFromUi(page);
	await ensureHistoryViewOpenInLeftPanel(page);
	await page.getByRole("button", { name: "Create checkpoint" }).click();
	await expect(
		page.getByRole("button", { name: "Naming checkpoint...", exact: true }),
	).toBeVisible();
	await expect
		.poll(async () => await newBranchIdFromUi(page, beforeIds))
		.not.toBeNull();
	const branchId = await newBranchIdFromUi(page, beforeIds);
	if (!branchId) {
		throw new Error("Created checkpoint branch was not found.");
	}
	return branchId;
}

async function expectHistoryBranchOrder(
	page: Page,
	expectedBranchIds: readonly string[],
): Promise<void> {
	await ensureHistoryViewOpenInLeftPanel(page);
	await expect
		.poll(async () => await visibleBranchIdsInHistoryOrderFromUi(page))
		.toEqual(expectedBranchIds);
	const rows = page.locator('[data-attr="branch-diff"]');
	await expect(rows).toHaveCount(expectedBranchIds.length);
	await expect(rows.nth(expectedBranchIds.length - 1)).toContainText(
		"Current Checkpoint",
	);
}

async function clickCheckpointRow(page: Page, rowIndex: number): Promise<void> {
	await ensureHistoryViewOpenInLeftPanel(page);
	const checkpoint = page.locator('[data-attr="branch-diff"]').nth(rowIndex);
	await expect(checkpoint).toBeVisible();
	await checkpoint.click();
}

async function expectCheckpointRowSelected(
	page: Page,
	rowIndex: number,
): Promise<void> {
	await ensureHistoryViewOpenInLeftPanel(page);
	await expect(
		page.locator('[data-attr="branch-diff"]').nth(rowIndex),
	).toHaveAttribute("data-selected", "true");
}

async function expectNoCheckpointRowSelected(page: Page): Promise<void> {
	await ensureHistoryViewOpenInLeftPanel(page);
	await expect(
		page.locator('[data-attr="branch-diff"][data-selected="true"]'),
	).toHaveCount(0);
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

async function createCheckpointEditorRevisionMatrix(page: Page): Promise<{
	firstBranchId: string;
	firstCommitId: string;
	secondBranchId: string;
	secondCommitId: string;
	activeBranchId: string;
}> {
	return await page.evaluate(async () => {
		const lix = window.flashtypeDesktop?.lix;
		if (!lix) {
			throw new Error("Desktop Lix bridge is unavailable");
		}

		const encoder = new TextEncoder();
		const data = (text: string) => encoder.encode(text);
		const execute = async (sql: string, params: unknown[] = []) => {
			return await lix.execute({ sql, params });
		};
		const insertFile = async (id: string, path: string, text: string) => {
			await execute(
				"INSERT INTO lix_file (id, path, data) VALUES ($1, $2, $3)",
				[id, path, data(text)],
			);
		};
		const updateFile = async (id: string, text: string) => {
			await execute("UPDATE lix_file SET data = $1 WHERE id = $2", [
				data(text),
				id,
			]);
		};
		const deleteFile = async (id: string) => {
			await execute("DELETE FROM lix_file WHERE id = $1", [id]);
		};
		const createBranch = async (name: string) => {
			await lix.createBranch({ options: { name } });
			const result = await execute(
				"SELECT id, commit_id FROM lix_branch WHERE name = $1",
				[name],
			);
			const row = result?.rows?.[0];
			const id = cell(row, 0, "id");
			const commitId = cell(row, 1, "commit_id");
			if (
				typeof id !== "string" ||
				id.length === 0 ||
				typeof commitId !== "string" ||
				commitId.length === 0
			) {
				throw new Error(`Created checkpoint ${name} was not found.`);
			}
			return { id, commitId };
		};

		await insertFile(
			"matrix_modified",
			"/modified.md",
			"# Modified\n\nModified at first checkpoint\n",
		);
		await insertFile(
			"matrix_deleted",
			"/deleted.md",
			"# Deleted\n\nDeleted after first checkpoint\n",
		);
		await insertFile(
			"matrix_recreated_before",
			"/recreated.md",
			"# Recreated\n\nOriginal identity before second checkpoint\n",
		);
		await insertFile(
			"matrix_head_deleted",
			"/head-deleted.md",
			"# Head deleted\n\nDeleted after second checkpoint\n",
		);
		await insertFile(
			"matrix_head_recreated_before",
			"/head-recreated.md",
			"# Head recreated\n\nOriginal identity before HEAD\n",
		);

		const first = await createBranch("a-first-statuses");

		await updateFile(
			"matrix_modified",
			"# Modified\n\nModified at second checkpoint\n",
		);
		await deleteFile("matrix_deleted");
		await insertFile(
			"matrix_added",
			"/added.md",
			"# Added\n\nAdded at second checkpoint\n",
		);
		await deleteFile("matrix_recreated_before");
		await insertFile(
			"matrix_recreated_after",
			"/recreated.md",
			"# Recreated\n\nNew identity at second checkpoint\n",
		);

		const second = await createBranch("b-second-statuses");

		await updateFile("matrix_modified", "# Modified\n\nModified at HEAD\n");
		await insertFile("matrix_head_added", "/head-added.md", "# Head added\n");
		await deleteFile("matrix_head_deleted");
		await deleteFile("matrix_head_recreated_before");
		await insertFile(
			"matrix_head_recreated_after",
			"/head-recreated.md",
			"# Head recreated\n\nNew identity at HEAD\n",
		);

		const activeBranchId = await lix.activeBranchId();
		if (!activeBranchId) {
			throw new Error("Active branch id is unavailable.");
		}

		return {
			firstBranchId: first.id,
			firstCommitId: first.commitId,
			secondBranchId: second.id,
			secondCommitId: second.commitId,
			activeBranchId,
		};

		function cell(row: unknown, index: number, key: string): unknown {
			if (Array.isArray(row)) return row[index];
			if (
				row &&
				typeof row === "object" &&
				"get" in row &&
				typeof (row as { get?: unknown }).get === "function"
			) {
				return (row as { get(key: string): unknown }).get(key);
			}
			if (row && typeof row === "object" && key in row) {
				return (row as Record<string, unknown>)[key];
			}
			return undefined;
		}
	});
}

async function branchIdsFromUi(page: Page): Promise<string[]> {
	return await page.evaluate(async () => {
		const result = await window.flashtypeDesktop?.lix.execute({
			sql: "SELECT id FROM lix_branch",
			params: [],
		});
		return (result?.rows ?? []).map((row) => String(row[0]));
	});
}

async function expectActiveBranchId(
	page: Page,
	expectedBranchId: string,
): Promise<void> {
	await expect
		.poll(async () => await activeBranchIdFromUi(page), {
			message: "checkpoint diff selection should not restore/switch branches",
			timeout: 3000,
		})
		.toBe(expectedBranchId);
}

async function newBranchIdFromUi(
	page: Page,
	beforeIds: readonly string[],
): Promise<string | null> {
	return await page.evaluate(async (previousIds) => {
		const result = await window.flashtypeDesktop?.lix.execute({
			sql: "SELECT id FROM lix_branch",
			params: [],
		});
		const previous = new Set(previousIds);
		for (const row of result?.rows ?? []) {
			const id = String(row[0]);
			if (!previous.has(id)) return id;
		}
		return null;
	}, beforeIds);
}

async function initialCommitIdForCommitFromUi(
	page: Page,
	commitId: string,
): Promise<string> {
	const initialCommitId = await page.evaluate(async (startCommitId) => {
		const result = await window.flashtypeDesktop?.lix.execute({
			sql: `
				SELECT DISTINCT h.observed_commit_id AS commit_id
				FROM lix_state_history h
				LEFT JOIN lix_commit_edge e
					ON e.child_id = h.observed_commit_id
				WHERE h.start_commit_id = $1
					AND h.schema_key = 'lix_commit'
					AND e.child_id IS NULL
			`,
			params: [startCommitId],
		});
		const commitIds = (result?.rows ?? [])
			.map((row) => row[0])
			.filter(
				(value): value is string =>
					typeof value === "string" && value.length > 0,
			);
		if (commitIds.length !== 1) {
			throw new Error(
				`Expected exactly one initial commit for ${startCommitId}, found ${commitIds.length}.`,
			);
		}
		return commitIds[0];
	}, commitId);
	return initialCommitId;
}

async function visibleBranchIdsInHistoryOrderFromUi(
	page: Page,
): Promise<string[]> {
	return await page.evaluate(async () => {
		const result = await window.flashtypeDesktop?.lix.execute({
			sql: `
				SELECT id
				FROM lix_branch
				WHERE COALESCE(CAST(hidden AS TEXT), 'false') NOT IN ('true', '1', 't')
				ORDER BY name ASC
			`,
			params: [],
		});
		return (result?.rows ?? []).map((row) => String(row[0]));
	});
}

async function expectActiveCentralFile(
	page: Page,
	appPath: string,
): Promise<void> {
	await expect
		.poll(async () => await activeCentralFilePathFromUi(page))
		.toBe(appPath);
}

type ActiveCentralDocumentIdentity = {
	readonly instance: string;
	readonly kind: string;
	readonly fileId: string;
	readonly filePath: string;
};

async function expectActiveCentralDocumentIdentityForPath(
	page: Page,
	appPath: string,
): Promise<ActiveCentralDocumentIdentity> {
	await expect
		.poll(async () => await activeCentralDocumentIdentityFromUi(page), {
			message: `expected ${appPath} to be the active central document`,
			timeout: 3000,
		})
		.toMatchObject({ filePath: appPath });
	const identity = await activeCentralDocumentIdentityFromUi(page);
	if (!identity || identity.filePath !== appPath) {
		throw new Error(`Active central document for ${appPath} was not found.`);
	}
	return identity;
}

async function expectActiveCentralDocumentIdentity(
	page: Page,
	expected: ActiveCentralDocumentIdentity,
	message: string,
): Promise<void> {
	await expect
		.poll(async () => await activeCentralDocumentIdentityFromUi(page), {
			message,
			timeout: 3000,
		})
		.toEqual(expected);
}

async function activeCentralDocumentIdentityFromUi(
	page: Page,
): Promise<ActiveCentralDocumentIdentity | null> {
	return await page.evaluate(async () => {
		const result = await window.flashtypeDesktop?.lix.execute({
			sql: "SELECT value FROM lix_key_value_by_branch WHERE key = $1 AND lixcol_branch_id = $2",
			params: ["atelier_ui_state", "global"],
		});
		const state = result?.rows?.[0]?.[0] as
			| {
					panels?: {
						central?: {
							activeInstance?: string | null;
							views?: Array<{
								instance?: unknown;
								kind?: unknown;
								state?: { fileId?: unknown; filePath?: unknown };
							}>;
						};
					};
			  }
			| undefined;
		const central = state?.panels?.central;
		const views = central?.views ?? [];
		const active =
			views.find((view) => view.instance === central?.activeInstance) ??
			views[0];
		const instance = active?.instance;
		const kind = active?.kind;
		const fileId = active?.state?.fileId;
		const filePath = active?.state?.filePath;
		if (
			typeof instance !== "string" ||
			typeof kind !== "string" ||
			typeof fileId !== "string" ||
			typeof filePath !== "string"
		) {
			return null;
		}
		return { instance, kind, fileId, filePath };
	});
}

async function activeCentralFilePathFromUi(page: Page): Promise<string | null> {
	return await page.evaluate(async () => {
		const result = await window.flashtypeDesktop?.lix.execute({
			sql: "SELECT value FROM lix_key_value_by_branch WHERE key = $1 AND lixcol_branch_id = $2",
			params: ["atelier_ui_state", "global"],
		});
		const state = result?.rows?.[0]?.[0] as
			| {
					panels?: {
						central?: {
							activeInstance?: string | null;
							views?: Array<{
								instance?: string;
								state?: { filePath?: unknown };
							}>;
						};
					};
			  }
			| undefined;
		const central = state?.panels?.central;
		const views = central?.views ?? [];
		const active =
			views.find((view) => view.instance === central?.activeInstance) ??
			views[0];
		const filePath = active?.state?.filePath;
		return typeof filePath === "string" ? filePath : null;
	});
}

async function expectActiveEditorRevisionState(
	page: Page,
	expected: {
		readonly beforeCommitId: string | null;
		readonly afterCommitId: string | null;
	},
): Promise<void> {
	await expect
		.poll(async () => await activeEditorRevisionStateFromUi(page))
		.toEqual(expected);
}

async function expectSingleCentralDocumentSlot(page: Page): Promise<void> {
	await expect
		.poll(async () => await documentSlotViolationsFromUi(page), {
			message:
				"document views should only exist as the single active central view",
			timeout: 3000,
		})
		.toEqual([]);
}

async function documentSlotViolationsFromUi(page: Page): Promise<string[]> {
	return await page.evaluate(async () => {
		const result = await window.flashtypeDesktop?.lix.execute({
			sql: "SELECT value FROM lix_key_value_by_branch WHERE key = $1 AND lixcol_branch_id = $2",
			params: ["atelier_ui_state", "global"],
		});
		type ViewState = {
			readonly fileId?: unknown;
		};
		type View = {
			readonly instance?: unknown;
			readonly kind?: unknown;
			readonly state?: ViewState;
		};
		type Panel = {
			readonly activeInstance?: unknown;
			readonly views?: View[];
		};
		const state = result?.rows?.[0]?.[0] as
			| {
					panels?: {
						left?: Panel;
						central?: Panel;
						right?: Panel;
					};
			  }
			| undefined;
		const panels = state?.panels ?? {};
		const violations: string[] = [];
		const isDocumentView = (view: View): boolean => {
			const fileId = view.state?.fileId;
			return (
				typeof view.kind === "string" &&
				typeof view.instance === "string" &&
				typeof fileId === "string" &&
				view.instance === `${view.kind}:${fileId}`
			);
		};
		for (const side of ["left", "right"] as const) {
			const documentViews = panels[side]?.views?.filter(isDocumentView) ?? [];
			if (documentViews.length > 0) {
				violations.push(`${side} has ${documentViews.length} document view(s)`);
			}
		}
		const central = panels.central;
		const centralViews = central?.views ?? [];
		if (centralViews.length > 1) {
			violations.push(`central has ${centralViews.length} views`);
		}
		const centralView = centralViews[0];
		if (centralView && !isDocumentView(centralView)) {
			violations.push("central view is not a document view");
		}
		if (
			centralView &&
			typeof centralView.instance === "string" &&
			central?.activeInstance !== centralView.instance
		) {
			violations.push("central document view is not active");
		}
		return violations;
	});
}

async function activeEditorRevisionStateFromUi(page: Page): Promise<{
	beforeCommitId: string | null;
	afterCommitId: string | null;
} | null> {
	return await page.evaluate(async () => {
		const result = await window.flashtypeDesktop?.lix.execute({
			sql: "SELECT value FROM lix_key_value_by_branch WHERE key = $1 AND lixcol_branch_id = $2",
			params: ["atelier_ui_state", "global"],
		});
		const state = result?.rows?.[0]?.[0] as
			| {
					panels?: {
						central?: {
							activeInstance?: string | null;
							views?: Array<{
								instance?: string;
								state?: {
									beforeCommitId?: unknown;
									afterCommitId?: unknown;
								};
							}>;
						};
					};
			  }
			| undefined;
		const central = state?.panels?.central;
		const views = central?.views ?? [];
		const active =
			views.find((view) => view.instance === central?.activeInstance) ??
			views[0];
		if (!active) return null;
		const beforeCommitId = active.state?.beforeCommitId;
		const afterCommitId = active.state?.afterCommitId;
		return {
			beforeCommitId:
				typeof beforeCommitId === "string" && beforeCommitId.length > 0
					? beforeCommitId
					: null,
			afterCommitId:
				typeof afterCommitId === "string" && afterCommitId.length > 0
					? afterCommitId
					: null,
		};
	});
}

async function expectFileTreeStatuses(
	page: Page,
	expected: Record<string, string | null>,
	message: string,
): Promise<void> {
	await ensureFilesViewOpenInLeftPanel(page);
	await expect
		.poll(async () => await fileTreeStatuses(page, Object.keys(expected)), {
			message,
			timeout: 3000,
		})
		.toEqual(expected);
}

async function fileTreeStatuses(
	page: Page,
	appPaths: readonly string[],
): Promise<Record<string, string | null>> {
	const statuses: Record<string, string | null> = {};
	for (const appPath of appPaths) {
		const file = fileTreeFile(page, appPath);
		if ((await file.count()) === 0) {
			statuses[appPath] = "<missing>";
			continue;
		}
		statuses[appPath] = await file.first().getAttribute("data-item-git-status");
	}
	return statuses;
}

async function expectEditableMarkdown(page: Page): Promise<void> {
	await expect(page.locator(".markdown-review-overlay")).toHaveCount(0);
	await expect(
		page.locator('[data-testid="tiptap-editor"] .ProseMirror'),
	).toBeVisible();
	await expect(
		page.locator('[data-testid="tiptap-editor"] .ProseMirror'),
	).toHaveAttribute("contenteditable", "true");
}

async function expectReadonlyMarkdown(page: Page): Promise<void> {
	const editor = page.locator('[data-attr="markdown-editor"] .ProseMirror');
	await expect(editor.first()).toBeVisible();
	await expect
		.poll(async () => {
			return await editor.evaluateAll((nodes) =>
				nodes.every((node) => node.getAttribute("contenteditable") !== "true"),
			);
		})
		.toBe(true);
}

async function expectMarkdownDiff(
	page: Page,
	expected: { added?: readonly string[]; removed?: readonly string[] } = {},
): Promise<void> {
	const overlay = page
		.locator(".markdown-review-overlay")
		.filter({ has: page.locator("[data-diff-status]") })
		.first();
	await expect(overlay).toBeVisible();
	await expectReadonlyMarkdown(page);
	await expect(overlay.locator("[data-diff-status]").first()).toBeVisible();
	for (const text of expected.added ?? []) {
		await expect(
			overlay.locator("[data-diff-status='added']").filter({ hasText: text }),
		).toBeVisible();
	}
	for (const text of expected.removed ?? []) {
		await expect(
			overlay.locator("[data-diff-status='removed']").filter({ hasText: text }),
		).toBeVisible();
	}
	await expect(
		page.getByRole("button", { name: "Keep", exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Undo", exact: true }),
	).toHaveCount(0);
}

async function checkpointRowLabels(page: Page): Promise<string[]> {
	return await page
		.locator('[data-attr="branch-diff"]')
		.evaluateAll((rows) =>
			rows.map((row) => (row.textContent ?? "").replace(/\s+/g, " ").trim()),
		);
}

async function activeBranchIdFromUi(page: Page): Promise<string> {
	const activeBranchId = await page.evaluate(async () => {
		return await window.flashtypeDesktop?.lix.activeBranchId();
	});
	if (!activeBranchId) {
		throw new Error("Active branch id is unavailable.");
	}
	return activeBranchId;
}
