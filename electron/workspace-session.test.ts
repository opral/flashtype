import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
	filterExistingWorkspaceEntries,
	getWorkspaceSessionPath,
	markWorkspaceSessionBootInProgressSync,
	mergeRestoredAndExplicitWorkspaceRequests,
	readWorkspaceSessionEntries,
	recoverWorkspaceSessionAfterFailedBootSync,
	WORKSPACE_SESSION_RECOVERY_BACKUP_FILE,
	writeWorkspaceSessionEntries,
	writeWorkspaceSessionEntriesSync,
	WORKSPACE_SESSION_VERSION,
} from "./workspace-session.mjs";

describe("workspace session store", () => {
	test("missing store returns no workspace entries", async () => {
		const userDataPath = createUserDataPath();

		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual(
			[],
		);
	});

	test("corrupt or invalid stores return no workspace entries", async () => {
		const userDataPath = createUserDataPath();
		await mkdir(userDataPath, { recursive: true });

		await writeFile(getWorkspaceSessionPath(userDataPath), "{bad json", "utf8");
		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual(
			[],
		);

		await writeFile(
			getWorkspaceSessionPath(userDataPath),
			JSON.stringify({ version: WORKSPACE_SESSION_VERSION }),
			"utf8",
		);
		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual(
			[],
		);

		await writeFile(
			getWorkspaceSessionPath(userDataPath),
			JSON.stringify({ version: 999, workspaces: [] }),
			"utf8",
		);
		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual(
			[],
		);
	});

	test("write persists normalized workspace entries", async () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");
		const firstFilePath = path.join(userDataPath, "files", "one.md");
		const secondFilePath = path.join(userDataPath, "files", "two.md");

		await writeWorkspaceSessionEntries(userDataPath, [
			{ ephemeral: false, path: workspacePath },
			{ ephemeral: false, path: workspacePath },
			{
				ephemeral: true,
				sourceFilePaths: [firstFilePath, secondFilePath, firstFilePath],
			},
		]);

		await expect(readStore(userDataPath)).resolves.toEqual({
			version: WORKSPACE_SESSION_VERSION,
			workspaces: [
				{ ephemeral: false, path: workspacePath },
				{
					ephemeral: true,
					sourceFilePaths: [firstFilePath, secondFilePath],
				},
			],
		});
	});

	test("sync write persists normalized workspace entries", async () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");

		writeWorkspaceSessionEntriesSync(userDataPath, [
			{ ephemeral: false, path: workspacePath },
		]);

		await expect(readStore(userDataPath)).resolves.toEqual({
			version: WORKSPACE_SESSION_VERSION,
			workspaces: [{ ephemeral: false, path: workspacePath }],
		});
	});

	test("boot recovery without guard leaves saved workspace entries alone", async () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");
		writeWorkspaceSessionEntriesSync(userDataPath, [
			{ ephemeral: false, path: workspacePath },
		]);

		expect(recoverWorkspaceSessionAfterFailedBootSync(userDataPath)).toBe(
			false,
		);

		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual([
			{ ephemeral: false, path: workspacePath },
		]);
	});

	test("boot recovery backs up once and clears saved workspace entries", async () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");
		writeWorkspaceSessionEntriesSync(userDataPath, [
			{ ephemeral: false, path: workspacePath },
		]);
		markWorkspaceSessionBootInProgressSync(userDataPath);

		expect(recoverWorkspaceSessionAfterFailedBootSync(userDataPath)).toBe(true);

		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual(
			[],
		);
		await expect(readRecoveryBackup(userDataPath)).resolves.toEqual({
			version: WORKSPACE_SESSION_VERSION,
			workspaces: [{ ephemeral: false, path: workspacePath }],
		});

		expect(recoverWorkspaceSessionAfterFailedBootSync(userDataPath)).toBe(true);

		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual(
			[],
		);
		await expect(readRecoveryBackup(userDataPath)).resolves.toEqual({
			version: WORKSPACE_SESSION_VERSION,
			workspaces: [{ ephemeral: false, path: workspacePath }],
		});
	});

	test("filters stale workspace entries", async () => {
		const userDataPath = createUserDataPath();
		const directoryWorkspacePath = path.join(userDataPath, "directory");
		const firstFilePath = path.join(userDataPath, "one.md");
		const secondFilePath = path.join(userDataPath, "two.md");
		const staleWorkspacePath = path.join(userDataPath, "missing");
		await mkdir(directoryWorkspacePath, { recursive: true });
		await mkdir(userDataPath, { recursive: true });
		await writeFile(firstFilePath, "# One\n", "utf8");

		await expect(
			filterExistingWorkspaceEntries([
				{ ephemeral: false, path: directoryWorkspacePath },
				{ ephemeral: false, path: staleWorkspacePath },
				{
					ephemeral: true,
					sourceFilePaths: [firstFilePath, secondFilePath],
				},
			]),
		).resolves.toEqual([
			{ ephemeral: false, path: directoryWorkspacePath },
			{ ephemeral: true, sourceFilePaths: [firstFilePath] },
		]);
	});

	test("restores saved workspaces when launch has no explicit paths", () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");
		const firstFilePath = path.join(userDataPath, "files", "one.md");
		const secondFilePath = path.join(userDataPath, "files", "two.md");

		expect(
			mergeRestoredAndExplicitWorkspaceRequests(
				[
					{ ephemeral: false, path: workspacePath },
					{ ephemeral: false, path: workspacePath },
					{
						ephemeral: true,
						sourceFilePaths: [firstFilePath, secondFilePath, firstFilePath],
					},
				],
				[],
			),
		).toEqual([
			{ ephemeral: false, path: workspacePath },
			{ ephemeral: true, sourceFilePaths: [firstFilePath, secondFilePath] },
		]);
	});

	test("keeps unrelated restored workspaces when launch has explicit paths", () => {
		const userDataPath = createUserDataPath();
		const restoredWorkspacePath = path.join(userDataPath, "Downloads");
		const unrelatedWorkspacePath = path.join(userDataPath, "Projects");
		const restoredFilePath = path.join(userDataPath, "notes", "draft.md");
		const unrelatedFilePath = path.join(userDataPath, "notes", "other.md");
		const explicitFilePath = path.join(
			userDataPath,
			"Downloads",
			"docs",
			"README.md",
		);

		expect(
			mergeRestoredAndExplicitWorkspaceRequests(
				[
					{ ephemeral: false, path: restoredWorkspacePath },
					{ ephemeral: false, path: unrelatedWorkspacePath },
					{
						ephemeral: true,
						sourceFilePaths: [restoredFilePath, unrelatedFilePath],
					},
				],
				[explicitFilePath, restoredFilePath],
			),
		).toEqual([
			{ ephemeral: false, path: unrelatedWorkspacePath },
			explicitFilePath,
			restoredFilePath,
		]);
	});

	test("does not duplicate explicitly opened restored workspace directories", () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");

		expect(
			mergeRestoredAndExplicitWorkspaceRequests(
				[{ ephemeral: false, path: workspacePath }],
				[workspacePath],
			),
		).toEqual([workspacePath]);
	});

	test("drops restored workspace directories containing explicit launch files", () => {
		const userDataPath = createUserDataPath();
		const restoredWorkspacePath = path.join(userDataPath, "Downloads");
		const explicitFilePath = path.join(
			userDataPath,
			"Downloads",
			"docs",
			"README.md",
		);

		expect(
			mergeRestoredAndExplicitWorkspaceRequests(
				[{ ephemeral: false, path: restoredWorkspacePath }],
				[explicitFilePath],
			),
		).toEqual([explicitFilePath]);
	});

	test("drops restored nested entries contained by explicit launch folders", () => {
		const userDataPath = createUserDataPath();
		const explicitWorkspacePath = path.join(userDataPath, "Downloads");
		const restoredWorkspacePath = path.join(userDataPath, "Downloads", "docs");
		const restoredFilePath = path.join(
			userDataPath,
			"Downloads",
			"notes",
			"draft.md",
		);

		expect(
			mergeRestoredAndExplicitWorkspaceRequests(
				[
					{ ephemeral: false, path: restoredWorkspacePath },
					{ ephemeral: true, sourceFilePaths: [restoredFilePath] },
				],
				[explicitWorkspacePath],
			),
		).toEqual([explicitWorkspacePath]);
	});
});

function createUserDataPath() {
	return path.join(tmpdir(), "flashtype-workspace-session-test", randomUUID());
}

async function readStore(userDataPath: string): Promise<unknown> {
	return JSON.parse(
		await readFile(getWorkspaceSessionPath(userDataPath), "utf8"),
	);
}

async function readRecoveryBackup(userDataPath: string): Promise<unknown> {
	return JSON.parse(
		await readFile(
			path.join(userDataPath, WORKSPACE_SESSION_RECOVERY_BACKUP_FILE),
			"utf8",
		),
	);
}
