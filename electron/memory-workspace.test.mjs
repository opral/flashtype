// @vitest-environment node
import { test, expect } from "vitest";
import { createRequire } from "node:module";
import {
	mkdtemp,
	mkdir,
	writeFile,
	readFile,
	readdir,
	rm,
	stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemoryWorkspace } from "./memory-workspace.mjs";
const { openLix } = createRequire(import.meta.url)("@lix-js/sdk");

test("memory workspace saves files, imports external edits, rejects conflicts, and leaves no repository", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "flashtype-memory-test-"));
	const lix = await openLix();
	try {
		await writeFile(path.join(root, "note.md"), "original");
		const bridge = createMemoryWorkspace(lix, root);
		await bridge.importPaths(["note.md"]);
		const update = (text) =>
			lix.execute("UPDATE lix_file SET content = $1 WHERE path = $2", [
				new TextEncoder().encode(text),
				"/note.md",
			]);
		await update("edited");
		await bridge.flush();
		expect(await readFile(path.join(root, "note.md"), "utf8")).toBe("edited");
		await writeFile(path.join(root, "note.md"), "external");
		await bridge.syncDiskToLix();
		expect(
			new TextDecoder().decode(
				(
					await lix.execute("SELECT content FROM lix_file WHERE path = $1", [
						"/note.md",
					])
				).rows[0].content,
			),
		).toBe("external");
		await update("local conflict");
		await writeFile(path.join(root, "note.md"), "new external");
		await expect(bridge.flush()).rejects.toThrow("changed on disk");
		expect(await readFile(path.join(root, "note.md"), "utf8")).toBe(
			"new external",
		);
		await expect(bridge.importPaths(["../outside.md"])).rejects.toThrow(
			"Invalid workspace path",
		);
		expect(await readdir(root)).toEqual(["note.md"]);
	} finally {
		await lix.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("memory workspace persists new directories and only removes directories it created", async () => {
	const root = await mkdtemp(
		path.join(tmpdir(), "flashtype-memory-directories-test-"),
	);
	const lix = await openLix();
	try {
		await mkdir(path.join(root, "existing"), { recursive: true });
		await writeFile(path.join(root, "existing", "keep.md"), "Keep me");
		const bridge = createMemoryWorkspace(lix, root);

		await lix.execute("INSERT INTO lix_directory (path) VALUES ($1)", [
			"/existing",
		]);
		await lix.execute("INSERT INTO lix_directory (path) VALUES ($1)", [
			"/created",
		]);
		await lix.execute("INSERT INTO lix_directory (path) VALUES ($1)", [
			"/created/nested",
		]);
		await bridge.flush();

		expect((await stat(path.join(root, "created"))).isDirectory()).toBe(true);
		expect(
			(await stat(path.join(root, "created", "nested"))).isDirectory(),
		).toBe(true);

		await lix.execute("DELETE FROM lix_directory WHERE path = $1", [
			"/created/nested",
		]);
		await lix.execute("DELETE FROM lix_directory WHERE path = $1", [
			"/created",
		]);
		await lix.execute("DELETE FROM lix_directory WHERE path = $1", [
			"/existing",
		]);
		await bridge.flush();

		await expect(stat(path.join(root, "created"))).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect(await readFile(path.join(root, "existing", "keep.md"), "utf8")).toBe(
			"Keep me",
		);
		expect(await readdir(path.join(root, "existing"))).toEqual(["keep.md"]);
	} finally {
		await lix.close();
		await rm(root, { recursive: true, force: true });
	}
});
