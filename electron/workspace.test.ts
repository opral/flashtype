import { mkdir, symlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
	profileWorkspaceFilesystem,
	resolveWorkspace,
	resolveWorkspaceTarget,
	resolveWorkspaceTargets,
} from "./workspace.mjs";

vi.mock("electron", () => ({
	dialog: { showOpenDialog: vi.fn() },
	ipcMain: { handle: vi.fn() },
}));

describe("workspace resolution", () => {
	test("opens directory paths as ephemeral workspaces by default", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		await mkdir(directory, { recursive: true });

		await expect(resolveWorkspace(directory)).resolves.toEqual({
			ephemeral: true,
			path: directory,
			includePaths: [],
			name: "workspace",
		});
	});

	test("opens directory workspaces without a size limit", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		await mkdir(directory, { recursive: true });
		await writeFile(path.join(directory, "large.md"), Buffer.alloc(11));

		await expect(resolveWorkspaceTarget(directory)).resolves.toEqual({
			workspace: {
				ephemeral: true,
				path: directory,
				includePaths: ["large.md"],
				name: "workspace",
			},
			pendingOpenFilePaths: [],
		});
	});

	test("opens non-Lix directories with recursive exact supported include paths", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		await mkdir(path.join(directory, "docs", "nested"), { recursive: true });
		await mkdir(path.join(directory, ".lix"), { recursive: true });
		await writeFile(path.join(directory, "z.md"), "# Z\n");
		await writeFile(path.join(directory, "alpha.markdown"), "# Alpha\n");
		await writeFile(path.join(directory, "data.csv"), "name,value\nA,1\n");
		await writeFile(path.join(directory, "docs", "readme.md"), "# Docs\n");
		await writeFile(
			path.join(directory, "docs", "table.csv"),
			"label,total\nDocs,2\n",
		);
		await writeFile(
			path.join(directory, "docs", "nested", "guide.markdown"),
			"# Guide\n",
		);
		await writeFile(path.join(directory, "docs", "upper.MD"), "# Upper\n");
		await writeFile(path.join(directory, "notes.txt"), "Notes\n");
		await writeFile(path.join(directory, ".lix", "ignored.md"), "# Ignored\n");

		await expect(resolveWorkspaceTarget(directory)).resolves.toEqual({
			workspace: {
				ephemeral: true,
				path: directory,
				includePaths: [
					"alpha.markdown",
					"data.csv",
					"docs/nested/guide.markdown",
					"docs/readme.md",
					"docs/table.csv",
					"z.md",
				],
				name: "workspace",
			},
			pendingOpenFilePaths: [],
		});
	});

	test("resolves directory paths inside Lix workspaces to the workspace root", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		const nestedDirectory = path.join(directory, "docs", "guides");
		await mkdir(path.join(directory, ".lix", ".internal"), { recursive: true });
		await writeFile(path.join(directory, ".lix", ".internal", "db.sqlite"), "");
		await mkdir(nestedDirectory, { recursive: true });

		await expect(resolveWorkspaceTarget(nestedDirectory)).resolves.toEqual({
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

	test("resolves a file inside a RocksDB Lix workspace to the workspace root", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		const filePath = path.join(directory, "readme.md");
		await mkdir(path.join(directory, ".lix", ".internal", "rocksdb"), {
			recursive: true,
		});
		await writeFile(filePath, "# Hello\n");

		await expect(resolveWorkspaceTarget(filePath)).resolves.toEqual({
			workspace: {
				ephemeral: false,
				path: directory,
				name: "workspace",
			},
			pendingOpenFilePaths: ["readme.md"],
		});
	});

	test("resolves files in Lix workspaces without a size limit", async () => {
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

		await expect(resolveWorkspaceTarget(filePath)).resolves.toEqual({
			workspace: {
				ephemeral: false,
				path: directory,
				name: "workspace",
			},
			pendingOpenFilePaths: ["readme.md"],
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

	test("resolves files inside Lix workspaces to the workspace root", async () => {
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

		await expect(resolveWorkspaceTargets([filePath])).resolves.toEqual([
			{
				workspace: {
					ephemeral: false,
					path: directory,
					name: "workspace",
				},
				pendingOpenFilePaths: ["readme.md"],
			},
		]);
	});

	test("resolves file targets in Lix workspaces to persistent workspaces", async () => {
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

		await expect(resolveWorkspaceTargets([filePath])).resolves.toEqual([
			{
				workspace: {
					ephemeral: false,
					path: directory,
					name: "workspace",
				},
				pendingOpenFilePaths: ["readme.md"],
			},
		]);
	});

	test("resolves each file inside Lix workspaces independently", async () => {
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
				includePaths: ["readme.md"],
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
					includePaths: ["alpha.md", "nested/beta.markdown"],
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
					includePaths: ["alpha.txt", "beta.csv"],
					name: "workspace",
				},
				pendingOpenFilePaths: ["alpha.txt", "beta.csv"],
			},
		]);
	});

	test("profiles workspace filesystem sizes by extension without reading Lix blobs", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		await mkdir(path.join(directory, "docs"), { recursive: true });
		await mkdir(path.join(directory, "data"), { recursive: true });
		await mkdir(path.join(directory, ".lix", ".internal"), {
			recursive: true,
		});
		await writeFile(path.join(directory, "README.md"), Buffer.alloc(1024));
		await writeFile(
			path.join(directory, "docs", "guide.MD"),
			Buffer.alloc(3072),
		);
		await writeFile(
			path.join(directory, "data", "book.xlsx"),
			Buffer.alloc(2048),
		);
		await writeFile(path.join(directory, "LICENSE"), Buffer.alloc(512));
		await writeFile(
			path.join(directory, ".lix", ".internal", "db.sqlite"),
			Buffer.alloc(10_000),
		);

		const profile = await profileWorkspaceFilesystem({
			ephemeral: false,
			path: directory,
			name: "workspace",
		});

		expect(profile).toEqual({
			file_count: 4,
			directory_count: 2,
			extension_count: 3,
			extension_counts: {
				"(none)": 1,
				md: 2,
				xlsx: 1,
			},
			total_size_mb: 0.01,
			extensions: [
				{
					file_extension: "(none)",
					file_count: 1,
					total_size_mb: 0,
					median_file_size_kb: 0.5,
				},
				{
					file_extension: "md",
					file_count: 2,
					total_size_mb: 0,
					median_file_size_kb: 2,
				},
				{
					file_extension: "xlsx",
					file_count: 1,
					total_size_mb: 0,
					median_file_size_kb: 2,
				},
			],
		});
	});

	test("skips symbolic links while profiling workspace filesystem", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		await mkdir(directory, { recursive: true });
		const realFilePath = path.join(directory, "real.md");
		await writeFile(realFilePath, Buffer.alloc(1024));
		await symlink(realFilePath, path.join(directory, "linked.md"));

		await expect(
			profileWorkspaceFilesystem({
				ephemeral: false,
				path: directory,
				name: "workspace",
			}),
		).resolves.toMatchObject({
			file_count: 1,
			extension_counts: { md: 1 },
		});
	});

	test("profiles transient workspaces from source files only", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		const openedFilePath = path.join(directory, "notes", "today.md");
		await mkdir(path.dirname(openedFilePath), { recursive: true });
		await writeFile(openedFilePath, Buffer.alloc(1024));
		await writeFile(path.join(directory, "ignored.xlsx"), Buffer.alloc(4096));

		await expect(
			profileWorkspaceFilesystem({
				ephemeral: true,
				path: directory,
				name: "workspace",
				includePaths: ["notes/today.md"],
			}),
		).resolves.toMatchObject({
			file_count: 1,
			directory_count: 1,
			extension_counts: { md: 1 },
			total_size_mb: 0,
		});
	});

	test("ignores saved open files for tracked workspace session entries", async () => {
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

		await expect(
			resolveWorkspaceTargets([
				{ path: directory, openFilePaths: ["docs/readme.md"] },
			]),
		).resolves.toEqual([
			{
				workspace: {
					ephemeral: false,
					path: directory,
					name: "workspace",
				},
				pendingOpenFilePaths: [],
			},
		]);
	});

	test("restores saved workspace session entries without .lix as ephemeral", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		const filePath = path.join(directory, "docs", "readme.md");
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(filePath, "# Hello\n");
		await writeFile(path.join(directory, "overview.md"), "# Overview\n");

		await expect(
			resolveWorkspaceTargets([
				{ path: directory, openFilePaths: ["docs/readme.md"] },
			]),
		).resolves.toEqual([
			{
				workspace: {
					ephemeral: true,
					path: directory,
					includePaths: ["docs/readme.md", "overview.md"],
					name: "workspace",
				},
				pendingOpenFilePaths: ["docs/readme.md"],
			},
		]);
	});

	test("restores saved non-Lix directory session entries with all supported files", async () => {
		const directory = path.join(
			tmpdir(),
			"flashtype-workspace-test",
			randomUUID(),
			"workspace",
		);
		await mkdir(path.join(directory, "docs"), { recursive: true });
		await writeFile(path.join(directory, "marker.md"), "# Marker\n");
		await writeFile(
			path.join(directory, "docs", "notes.markdown"),
			"# Notes\n",
		);
		await writeFile(path.join(directory, "data.csv"), "name,value\nA,1\n");
		await writeFile(path.join(directory, "ignored.txt"), "Ignored\n");

		await expect(
			resolveWorkspaceTargets([{ path: directory, openFilePaths: [] }]),
		).resolves.toEqual([
			{
				workspace: {
					ephemeral: true,
					path: directory,
					includePaths: ["data.csv", "docs/notes.markdown", "marker.md"],
					name: "workspace",
				},
				pendingOpenFilePaths: [],
			},
		]);
	});
});
