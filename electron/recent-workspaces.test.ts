import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
	activeFileDockLabel,
	addRecentWorkspaceEntry,
	filterExistingRecentWorkspaceEntries,
	getMacDockRecentWorkspacePaths,
	getRecentWorkspacesPath,
	MACOS_DOCK_RECENT_WORKSPACES_LIMIT,
	readRecentWorkspaceEntries,
	recentWorkspaceEntryFromWorkspace,
	recentWorkspaceLabel,
	RECENT_WORKSPACES_LIMIT,
	RECENT_WORKSPACES_VERSION,
	writeRecentWorkspaceEntries,
	writeRecentWorkspaceEntriesSync,
} from "./recent-workspaces.mjs";

describe("recent workspaces", () => {
	test("missing or invalid stores return no recent workspaces", async () => {
		const userDataPath = createUserDataPath();

		await expect(readRecentWorkspaceEntries(userDataPath)).resolves.toEqual([]);

		await mkdir(userDataPath, { recursive: true });
		await writeFile(getRecentWorkspacesPath(userDataPath), "{bad json", "utf8");

		await expect(readRecentWorkspaceEntries(userDataPath)).resolves.toEqual([]);
	});

	test("write persists normalized recent workspace entries", async () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");

		await writeRecentWorkspaceEntries(userDataPath, [
			{ path: workspacePath, name: "Workspace", lastOpenedAt: "now" },
			{ path: workspacePath, name: "Duplicate" },
			{ path: "" },
		]);

		await expect(readStore(userDataPath)).resolves.toEqual({
			version: RECENT_WORKSPACES_VERSION,
			workspaces: [
				{ path: workspacePath, name: "Workspace", lastOpenedAt: "now" },
			],
		});
	});

	test("sync write persists normalized recent workspace entries", async () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");

		writeRecentWorkspaceEntriesSync(userDataPath, [{ path: workspacePath }]);

		await expect(readStore(userDataPath)).resolves.toEqual({
			version: RECENT_WORKSPACES_VERSION,
			workspaces: [
				{
					path: workspacePath,
					name: "workspace",
					lastOpenedAt: null,
				},
			],
		});
	});

	test("adds newest workspace first and enforces the limit", () => {
		const userDataPath = createUserDataPath();
		const entries = Array.from(
			{ length: RECENT_WORKSPACES_LIMIT + 2 },
			(_, i) => ({
				path: path.join(userDataPath, `workspace-${i}`),
				name: `workspace-${i}`,
			}),
		);

		const next = addRecentWorkspaceEntry(entries, entries.at(-1));

		expect(next).toHaveLength(RECENT_WORKSPACES_LIMIT);
		expect(next[0]?.path).toBe(entries.at(-1)?.path);
		expect(new Set(next.map((entry) => entry.path)).size).toBe(next.length);
	});

	test("filters stale recent workspace folders", async () => {
		const userDataPath = createUserDataPath();
		const existingPath = path.join(userDataPath, "existing");
		const missingPath = path.join(userDataPath, "missing");
		await mkdir(existingPath, { recursive: true });

		await expect(
			filterExistingRecentWorkspaceEntries([
				{ path: existingPath },
				{ path: missingPath },
			]),
		).resolves.toEqual([
			{ path: existingPath, name: "existing", lastOpenedAt: null },
		]);
	});

	test("builds macOS Dock recent folders like VS Code", async () => {
		const userDataPath = createUserDataPath();
		const entries = [];
		for (let i = 0; i < MACOS_DOCK_RECENT_WORKSPACES_LIMIT + 2; i++) {
			const workspacePath = path.join(userDataPath, `workspace-${i}`);
			await mkdir(workspacePath, { recursive: true });
			entries.push({ path: workspacePath });
		}
		const missingPath = path.join(userDataPath, "missing");

		await expect(
			getMacDockRecentWorkspacePaths([
				{ path: missingPath },
				...entries,
			]),
		).resolves.toEqual(
			entries
				.slice(0, MACOS_DOCK_RECENT_WORKSPACES_LIMIT)
				.map((entry) => entry.path)
				.reverse(),
		);
	});

	test("builds recent and active workspace labels", () => {
		const workspacePath = path.join("/Users/example/Documents", "Project");

		expect(recentWorkspaceLabel({ path: workspacePath })).toBe("Project");
		expect(
			activeFileDockLabel(
				{ ephemeral: false, path: workspacePath, name: "Project" },
				"/docs/readme.md",
			),
		).toBe("readme.md – Project");
		expect(
			activeFileDockLabel(
				{ ephemeral: false, path: workspacePath, name: "Project" },
				null,
			),
		).toBeNull();
	});

	test("does not record transient workspaces as recent folders", () => {
		expect(
			recentWorkspaceEntryFromWorkspace({
				ephemeral: true,
				path: "/tmp",
				name: "tmp",
				includePaths: ["file.md"],
			}),
		).toBeNull();
	});
});

function createUserDataPath() {
	return path.join(tmpdir(), "flashtype-recent-workspaces-test", randomUUID());
}

async function readStore(userDataPath: string): Promise<unknown> {
	return JSON.parse(
		await readFile(getRecentWorkspacesPath(userDataPath), "utf8"),
	);
}
