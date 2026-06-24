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

	test("corrupt, invalid, or old-version stores return no workspace entries", async () => {
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
			JSON.stringify({
				version: 3,
				workspaces: [{ ephemeral: false, path: "/old" }],
			}),
			"utf8",
		);
		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual(
			[],
		);
	});

	test("write persists normalized workspace entries", async () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");
		const secondWorkspacePath = path.join(userDataPath, "second");

		await writeWorkspaceSessionEntries(userDataPath, [
			{
				path: workspacePath,
				openFiles: [
					"/docs/readme.md",
					"docs\\readme.md",
					"notes/today.md",
					"../outside.md",
					".lix/app_data/private.md",
					"",
				],
			},
			{ path: workspacePath, openFiles: ["duplicate.md"] },
			{ path: secondWorkspacePath },
		]);

		await expect(readStore(userDataPath)).resolves.toEqual({
			version: WORKSPACE_SESSION_VERSION,
			workspaces: [
				{
					path: workspacePath,
					openFiles: ["docs/readme.md", "notes/today.md"],
				},
				{ path: secondWorkspacePath, openFiles: [] },
			],
		});
	});

	test("sync write persists normalized workspace entries", async () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");

		writeWorkspaceSessionEntriesSync(userDataPath, [
			{ path: workspacePath, openFiles: ["draft.md"] },
		]);

		await expect(readStore(userDataPath)).resolves.toEqual({
			version: WORKSPACE_SESSION_VERSION,
			workspaces: [{ path: workspacePath, openFiles: ["draft.md"] }],
		});
	});

	test("boot recovery without guard leaves saved workspace entries alone", async () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");
		writeWorkspaceSessionEntriesSync(userDataPath, [
			{ path: workspacePath, openFiles: ["draft.md"] },
		]);

		expect(recoverWorkspaceSessionAfterFailedBootSync(userDataPath)).toBe(
			false,
		);

		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual([
			{ path: workspacePath, openFiles: ["draft.md"] },
		]);
	});

	test("boot recovery backs up once and clears saved workspace entries", async () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");
		writeWorkspaceSessionEntriesSync(userDataPath, [
			{ path: workspacePath, openFiles: ["draft.md"] },
		]);
		markWorkspaceSessionBootInProgressSync(userDataPath);

		expect(recoverWorkspaceSessionAfterFailedBootSync(userDataPath)).toBe(true);

		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual(
			[],
		);
		await expect(readRecoveryBackup(userDataPath)).resolves.toEqual({
			version: WORKSPACE_SESSION_VERSION,
			workspaces: [{ path: workspacePath, openFiles: ["draft.md"] }],
		});

		expect(recoverWorkspaceSessionAfterFailedBootSync(userDataPath)).toBe(true);

		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual(
			[],
		);
		await expect(readRecoveryBackup(userDataPath)).resolves.toEqual({
			version: WORKSPACE_SESSION_VERSION,
			workspaces: [{ path: workspacePath, openFiles: ["draft.md"] }],
		});
	});

	test("filters stale workspace entries and stale open files", async () => {
		const userDataPath = createUserDataPath();
		const directoryWorkspacePath = path.join(userDataPath, "directory");
		const existingFile = path.join(directoryWorkspacePath, "one.md");
		const staleWorkspacePath = path.join(userDataPath, "missing");
		await mkdir(directoryWorkspacePath, { recursive: true });
		await writeFile(existingFile, "# One\n", "utf8");

		await expect(
			filterExistingWorkspaceEntries([
				{
					path: directoryWorkspacePath,
					openFiles: ["one.md", "missing.md"],
				},
				{ path: staleWorkspacePath, openFiles: ["missing.md"] },
			]),
		).resolves.toEqual([
			{ path: directoryWorkspacePath, openFiles: ["one.md"] },
		]);
	});

	test("restores saved workspaces when launch has no explicit paths", () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");
		const secondWorkspacePath = path.join(userDataPath, "second");

		expect(
			mergeRestoredAndExplicitWorkspaceRequests(
				[
					{ path: workspacePath, openFiles: ["a.md"] },
					{ path: workspacePath, openFiles: ["duplicate.md"] },
					{ path: secondWorkspacePath, openFiles: [] },
				],
				[],
			),
		).toEqual([
			{ path: workspacePath, openFiles: ["a.md"] },
			{ path: secondWorkspacePath, openFiles: [] },
		]);
	});

	test("keeps unrelated restored workspaces when launch has explicit paths", () => {
		const userDataPath = createUserDataPath();
		const restoredWorkspacePath = path.join(userDataPath, "Downloads");
		const unrelatedWorkspacePath = path.join(userDataPath, "Projects");
		const explicitFilePath = path.join(
			userDataPath,
			"Downloads",
			"docs",
			"README.md",
		);

		expect(
			mergeRestoredAndExplicitWorkspaceRequests(
				[
					{ path: restoredWorkspacePath, openFiles: ["docs/README.md"] },
					{ path: unrelatedWorkspacePath, openFiles: ["notes.md"] },
				],
				[explicitFilePath],
			),
		).toEqual([
			{ path: unrelatedWorkspacePath, openFiles: ["notes.md"] },
			explicitFilePath,
		]);
	});

	test("does not duplicate explicitly opened restored workspace directories", () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");

		expect(
			mergeRestoredAndExplicitWorkspaceRequests(
				[{ path: workspacePath, openFiles: ["draft.md"] }],
				[workspacePath],
			),
		).toEqual([workspacePath]);
	});

	test("drops restored nested entries contained by explicit launch folders", () => {
		const userDataPath = createUserDataPath();
		const explicitWorkspacePath = path.join(userDataPath, "Downloads");
		const restoredWorkspacePath = path.join(userDataPath, "Downloads", "docs");

		expect(
			mergeRestoredAndExplicitWorkspaceRequests(
				[{ path: restoredWorkspacePath, openFiles: ["draft.md"] }],
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
