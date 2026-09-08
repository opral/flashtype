// @vitest-environment node
import { test, expect } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
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
