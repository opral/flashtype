import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
	WORKSPACE_TOO_LARGE_ERROR_CODE,
	resolveDirectLaunchWorkspaceTargets,
	resolveWorkspace,
	resolveWorkspaceTarget,
	resolveWorkspaceTargets,
} from "./workspace.mjs";

vi.mock("electron", () => ({
	dialog: { showOpenDialog: vi.fn() },
	ipcMain: { handle: vi.fn() },
}));

describe("workspace resolution", () => {
	test("uses a directory path as the workspace", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		await mkdir(directory, { recursive: true });

		await expect(resolveWorkspace(directory)).resolves.toEqual({
			ephemeral: false,
			path: directory,
			name: "workspace",
		});
	});

	test("rejects directory workspaces over the size limit", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		await mkdir(directory, { recursive: true });
		await writeFile(path.join(directory, "large.md"), Buffer.alloc(11));

		await expect(
			resolveWorkspaceTarget(directory, { maxWorkspaceSizeBytes: 10 }),
		).rejects.toMatchObject({
			code: WORKSPACE_TOO_LARGE_ERROR_CODE,
			workspacePath: directory,
			maxSizeBytes: 10,
		});
	});

	test("allows directory workspaces at the size limit", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		await mkdir(directory, { recursive: true });
		await writeFile(path.join(directory, "small.md"), Buffer.alloc(10));

		await expect(
			resolveWorkspaceTarget(directory, { maxWorkspaceSizeBytes: 10 }),
		).resolves.toEqual({
			workspace: {
				ephemeral: false,
				path: directory,
				name: "workspace",
			},
			pendingOpenFilePaths: [],
		});
	});

	test("excludes .lix directories from the workspace size limit", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		await mkdir(path.join(directory, ".lix", ".internal"), {
			recursive: true,
		});
		await writeFile(path.join(directory, "small.md"), Buffer.alloc(10));
		await writeFile(
			path.join(directory, ".lix", ".internal", "db.sqlite"),
			Buffer.alloc(11),
		);

		await expect(
			resolveWorkspaceTarget(directory, { maxWorkspaceSizeBytes: 10 }),
		).resolves.toEqual({
			workspace: {
				ephemeral: false,
				path: directory,
				name: "workspace",
			},
			pendingOpenFilePaths: [],
		});
	});

	test("resolves a file inside a Lix workspace to the workspace root", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		const filePath = path.join(directory, "readme.md");
		await mkdir(path.join(directory, ".lix", ".internal"), { recursive: true });
		await writeFile(path.join(directory, ".lix", ".internal", "db.sqlite"), "");
		await writeFile(filePath, "# Hello\n");

		await expect(resolveWorkspace(filePath)).resolves.toEqual({
			ephemeral: false,
			path: directory,
			name: "workspace",
		});
	});

	test("rejects files that resolve to an oversized Lix workspace root", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		const filePath = path.join(directory, "readme.md");
		await mkdir(path.join(directory, ".lix", ".internal"), { recursive: true });
		await writeFile(path.join(directory, ".lix", ".internal", "db.sqlite"), "");
		await writeFile(filePath, "# Hello\n");
		await writeFile(path.join(directory, "large.md"), Buffer.alloc(11));

		await expect(
			resolveWorkspaceTarget(filePath, { maxWorkspaceSizeBytes: 10 }),
		).rejects.toMatchObject({
			code: WORKSPACE_TOO_LARGE_ERROR_CODE,
			workspacePath: directory,
			maxSizeBytes: 10,
		});
	});

	test("resolves files inside legacy Lix workspaces to the workspace root", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		const filePath = path.join(directory, "readme.md");
		await mkdir(path.join(directory, ".lix"), { recursive: true });
		await writeFile(path.join(directory, ".lix", "db.sqlite"), "");
		await writeFile(filePath, "# Hello\n");

		await expect(resolveWorkspace(filePath)).resolves.toEqual({
			ephemeral: false,
			path: directory,
			name: "workspace",
		});
	});

	test("resolves nested files to workspace-relative pending paths", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		const filePath = path.join(directory, "docs", "readme.md");
		await mkdir(path.join(directory, ".lix", ".internal"), { recursive: true });
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(path.join(directory, ".lix", ".internal", "db.sqlite"), "");
		await writeFile(filePath, "# Hello\n");

		await expect(resolveWorkspaceTarget(filePath)).resolves.toEqual({
			workspace: {
				ephemeral: false,
				path: directory,
				name: "workspace",
			},
			pendingOpenFilePaths: ["docs/readme.md"],
		});
	});

	test("can resolve files inside Lix workspaces as transient launch targets", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		const filePath = path.join(directory, "readme.md");
		await mkdir(path.join(directory, ".lix", ".internal"), { recursive: true });
		await writeFile(path.join(directory, ".lix", ".internal", "db.sqlite"), "");
		await writeFile(filePath, "# Hello\n");

		await expect(
			resolveWorkspaceTargets([filePath], { openFilesAsTransient: true }),
		).resolves.toEqual([
			{
				workspace: {
					ephemeral: true,
					path: directory,
					sourceFilePaths: [filePath],
					name: "workspace",
				},
				pendingOpenFilePaths: ["readme.md"],
			},
		]);
	});

	test("resolves direct launch file targets as transient workspaces", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		const filePath = path.join(directory, "readme.md");
		await mkdir(path.join(directory, ".lix", ".internal"), { recursive: true });
		await writeFile(path.join(directory, ".lix", ".internal", "db.sqlite"), "");
		await writeFile(filePath, "# Hello\n");

		await expect(
			resolveDirectLaunchWorkspaceTargets([filePath]),
		).resolves.toEqual([
			{
				workspace: {
					ephemeral: true,
					path: directory,
					sourceFilePaths: [filePath],
					name: "workspace",
				},
				pendingOpenFilePaths: ["readme.md"],
			},
		]);
	});

	test("resolves each file in a direct launch batch independently", async () => {
		const firstDirectory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"first",
		);
		const secondDirectory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"second",
		);
		const firstPath = path.join(firstDirectory, "readme.md");
		const secondPath = path.join(secondDirectory, "readme.md");
		await mkdir(path.join(firstDirectory, ".lix", ".internal"), {
			recursive: true,
		});
		await mkdir(path.join(secondDirectory, ".lix", ".internal"), {
			recursive: true,
		});
		await writeFile(
			path.join(firstDirectory, ".lix", ".internal", "db.sqlite"),
			"",
		);
		await writeFile(
			path.join(secondDirectory, ".lix", ".internal", "db.sqlite"),
			"",
		);
		await writeFile(firstPath, "# First\n");
		await writeFile(secondPath, "# Second\n");

		await expect(
			resolveDirectLaunchWorkspaceTargets([firstPath, secondPath]),
		).resolves.toEqual([
			{
				workspace: {
					ephemeral: true,
					path: firstDirectory,
					sourceFilePaths: [firstPath],
					name: "first",
				},
				pendingOpenFilePaths: ["readme.md"],
			},
			{
				workspace: {
					ephemeral: true,
					path: secondDirectory,
					sourceFilePaths: [secondPath],
					name: "second",
				},
				pendingOpenFilePaths: ["readme.md"],
			},
		]);
	});

	test("resolves files outside a Lix workspace to transient directory workspaces", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		const filePath = path.join(directory, "readme.md");
		await mkdir(directory, { recursive: true });
		await writeFile(filePath, "# Hello\n");

		await expect(resolveWorkspaceTarget(filePath)).resolves.toEqual({
			workspace: {
				ephemeral: true,
				path: directory,
				sourceFilePaths: [filePath],
				name: "workspace",
			},
			pendingOpenFilePaths: ["readme.md"],
		});
	});

	test("groups standalone files into one transient directory workspace target", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		const firstPath = path.join(directory, "alpha.md");
		const secondPath = path.join(directory, "nested", "beta.markdown");
		await mkdir(path.dirname(secondPath), { recursive: true });
		await writeFile(firstPath, "# Alpha\n");
		await writeFile(secondPath, "# Beta\n");

		await expect(
			resolveWorkspaceTargets([firstPath, secondPath]),
		).resolves.toEqual([
			{
				workspace: {
					ephemeral: true,
					path: directory,
					sourceFilePaths: [firstPath, secondPath],
					name: "workspace",
				},
				pendingOpenFilePaths: ["alpha.md", "nested/beta.markdown"],
			},
		]);
	});

	test("does not group markdown files inside Lix workspaces", async () => {
		const firstDirectory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"first",
		);
		const secondDirectory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"second",
		);
		const firstPath = path.join(firstDirectory, "readme.md");
		const secondPath = path.join(secondDirectory, "readme.md");
		await mkdir(path.join(firstDirectory, ".lix", ".internal"), {
			recursive: true,
		});
		await mkdir(path.join(secondDirectory, ".lix", ".internal"), {
			recursive: true,
		});
		await writeFile(
			path.join(firstDirectory, ".lix", ".internal", "db.sqlite"),
			"",
		);
		await writeFile(
			path.join(secondDirectory, ".lix", ".internal", "db.sqlite"),
			"",
		);
		await writeFile(firstPath, "# First\n");
		await writeFile(secondPath, "# Second\n");

		await expect(
			resolveWorkspaceTargets([firstPath, secondPath]),
		).resolves.toEqual([
			{
				workspace: {
					ephemeral: false,
					path: firstDirectory,
					name: "first",
				},
				pendingOpenFilePaths: ["readme.md"],
			},
			{
				workspace: {
					ephemeral: false,
					path: secondDirectory,
					name: "second",
				},
				pendingOpenFilePaths: ["readme.md"],
			},
		]);
	});

	test("groups non-markdown standalone files", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		const firstPath = path.join(directory, "alpha.txt");
		const secondPath = path.join(directory, "beta.csv");
		await mkdir(directory, { recursive: true });
		await writeFile(firstPath, "Alpha\n");
		await writeFile(secondPath, "Beta\n");

		await expect(
			resolveWorkspaceTargets([firstPath, secondPath]),
		).resolves.toEqual([
			{
				workspace: {
					ephemeral: true,
					path: directory,
					sourceFilePaths: [firstPath, secondPath],
					name: "workspace",
				},
				pendingOpenFilePaths: ["alpha.txt", "beta.csv"],
			},
		]);
	});
});
