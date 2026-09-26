import { afterEach, expect, test, vi } from "vitest";
import {
	mkdtemp,
	mkdir,
	open,
	rm,
	symlink,
	writeFile,
	readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	inspectRepositorySize,
	assertRepositorySize,
	MAX_REPOSITORY_BYTES,
} from "./repository-limits.mjs";
import {
	setWorkspaceFromPath,
	setWorkspaceTrackChanges,
	getWorkspace,
	disposeWorkspaceWindowState,
} from "./workspace.mjs";
vi.mock("electron", () => ({ dialog: {}, ipcMain: { handle: vi.fn() } }));
const roots = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});
async function folder() {
	const root = await mkdtemp(path.join(tmpdir(), "flashtype-limits-"));
	roots.push(root);
	return root;
}
async function sparse(file, size) {
	const handle = await open(file, "w");
	try {
		await handle.truncate(size);
	} finally {
		await handle.close();
	}
}

test("allows more than 200 files and blocks only oversized initialization", async () => {
	const root = await folder();
	await mkdir(path.join(root, "nested"));
	await Promise.all(
		Array.from({ length: 200 }, (_, i) =>
			writeFile(path.join(root, "nested", `${i}.md`), "x"),
		),
	);
	expect(await inspectRepositorySize(root)).toMatchObject({
		allowed: true,
		complete: true,
		fileCount: 200,
		totalBytes: 200,
	});
	const window = {
		id: 123456,
		isDestroyed: () => false,
		setTitle: vi.fn(),
		setRepresentedFilename: vi.fn(),
		webContents: { send: vi.fn() },
	};
	try {
		await setWorkspaceFromPath(root, window);
		await writeFile(path.join(root, "overflow.md"), "x");
		expect(await inspectRepositorySize(root)).toMatchObject({
			allowed: true,
			fileCount: 201,
		});
		await sparse(path.join(root, "large.bin"), MAX_REPOSITORY_BYTES + 1);
		await expect(setWorkspaceTrackChanges(window, true)).rejects.toThrow(
			"exceeds the 1 GB",
		);
		expect(getWorkspace(window).ephemeral).toBe(true);
		expect(await readdir(root)).not.toContain(".lix");
	} finally {
		await disposeWorkspaceWindowState(window);
	}
});

test("allows exactly 1 GB and rejects aggregate bytes above it without reading content", async () => {
	const root = await folder();
	await sparse(path.join(root, "large.bin"), MAX_REPOSITORY_BYTES);
	expect(await inspectRepositorySize(root)).toMatchObject({
		allowed: true,
		totalBytes: MAX_REPOSITORY_BYTES,
	});
	await writeFile(path.join(root, "extra.md"), "x");
	await expect(assertRepositorySize(root)).rejects.toThrow("exceeds the 1 GB");
});

test("counts hidden and non-Markdown files but excludes metadata and symlink targets", async () => {
	const root = await folder();
	const outside = await folder();
	for (const name of [".git", ".lix", ".lix_system"]) {
		await mkdir(path.join(root, name));
		await sparse(path.join(root, name, "db"), MAX_REPOSITORY_BYTES + 1);
	}
	await writeFile(path.join(root, ".hidden"), "a");
	await writeFile(path.join(root, "image.bin"), "bc");
	await mkdir(path.join(root, "nested", ".lix"), { recursive: true });
	await writeFile(path.join(root, "nested", ".lix", "user.md"), "d");
	await sparse(path.join(outside, "large"), MAX_REPOSITORY_BYTES + 1);
	await symlink(outside, path.join(root, "link"));
	expect(await inspectRepositorySize(root)).toMatchObject({
		allowed: true,
		fileCount: 3,
		totalBytes: 4,
	});
});

test("fails closed when a folder cannot be inspected", async () => {
	const root = await folder();
	await expect(
		assertRepositorySize(path.join(root, "missing")),
	).rejects.toThrow();
});
