// @vitest-environment node
import { test, expect } from "vitest";
import { createRequire } from "node:module";
import { FilesystemStorage } from "@lix-js/storage-filesystem";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkpointRepositoryMetadata } from "./initialize-checkpoint.mjs";
const { openLix, bundledPluginArchives } = createRequire(import.meta.url)(
	"@lix-js/sdk",
);

test("initialization checkpoints .lix files, leaves documents pending, and survives reopening", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "flashtype-checkpoint-"));
	let lix;
	try {
		await writeFile(path.join(root, "note.md"), "# Keep for review\n");
		lix = await openLix({ storage: new FilesystemStorage({ path: root }) });
		expect(lix.openReport.initialized).toBe(true);
		for (const plugin of await bundledPluginArchives()) {
			await lix.execute(
				"INSERT INTO lix_file (path, content) VALUES ($1, $2)",
				[`/.lix/plugins/${plugin.key}.lixplugin`, plugin.archiveBytes],
			);
		}
		await checkpointRepositoryMetadata(lix);
		const pendingPaths = async () =>
			(
				await lix.execute(
					"SELECT coalesce(to_path, from_path) AS path FROM lix_diff('lix_file') ORDER BY path",
				)
			).rows.map((row) => row.path);
		expect(await pendingPaths()).toEqual(["/note.md"]);
		const checkpoint = async () =>
			(await lix.execute("SELECT working_base_commit_id AS id FROM lix_branch WHERE id = lix_active_branch_id()"))
				.rows[0].id;
		const initial = await checkpoint();
		await checkpointRepositoryMetadata(lix);
		expect(await checkpoint()).toBe(initial);
		await lix.close();
		lix = await openLix({ storage: new FilesystemStorage({ path: root }) });
		expect(lix.openReport.initialized).toBe(false);
		expect(await checkpoint()).toBe(initial);
		expect(await pendingPaths()).toEqual(["/note.md"]);
	} finally {
		await lix?.close();
		await rm(root, { recursive: true, force: true });
	}
});
