import { describe, test, expect } from "vitest";
import { markdownPluginV2ArchiveBytes } from "@/test-utils/plugin-md-v2-archive";
import { openLix } from "@lix-js/sdk";
import { qb } from "@lix-js/kysely";
import {
	selectFiles,
	selectFilesystemEntries,
	selectWorkingDiffCount,
} from "@/queries";

function isHidden(value: unknown): boolean {
	return value === 1 || value === true || value === "true";
}

describe("selectFiles", () => {
	test("returns minimal rows sorted by path", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			archiveBytes: markdownPluginV2ArchiveBytes,
		});

		await qb(lix)
			.insertInto("lix_file")
			.values([
				{ id: "f2", path: "/b.md", data: new Uint8Array() },
				{ id: "f1", path: "/a.md", data: new Uint8Array() },
			])
			.execute();

		const rows = await selectFiles(lix).execute();
		const userRows = rows.filter((row) => !row.path.startsWith("/.lix/"));

		// Sorted ascending by path
		expect(userRows.map((r) => r.path)).toEqual(["/a.md", "/b.md"]);
		// Minimal shape
		expect(userRows[0]).toHaveProperty("id");
		expect(userRows[0]).toHaveProperty("path");
	});
});

describe("selectFilesystemEntries", () => {
	test("returns directories and files with hierarchy metadata", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			archiveBytes: markdownPluginV2ArchiveBytes,
		});

		// Seed directories (nested) via the view so triggers normalize inputs.
		await qb(lix)
			.insertInto("lix_directory")
			.values({ path: "/docs/" } as any)
			.returning(["id"])
			.execute();
		await qb(lix)
			.insertInto("lix_directory")
			.values({ path: "/docs/guides/" } as any)
			.execute();

		await qb(lix)
			.insertInto("lix_file")
			.values([
				{ id: "f_root", path: "/README.md", data: new Uint8Array() },
				{
					id: "f_nested",
					path: "/docs/guides/intro.md",
					data: new Uint8Array(),
				},
			])
			.execute();

		const rows = await selectFilesystemEntries(lix).execute();
		const userRows = rows.filter((row) => !row.path.startsWith("/.lix/"));
		expect(userRows.map((row) => row.kind)).toEqual([
			"file",
			"directory",
			"directory",
			"file",
		]);
		expect(userRows.map((row) => row.path)).toEqual([
			"/README.md",
			"/docs/",
			"/docs/guides/",
			"/docs/guides/intro.md",
		]);

		const docsRow = userRows.find((row) => row.path === "/docs/");
		expect(docsRow?.parent_id).toBeNull();
		expect(docsRow?.display_name).toBe("docs");

		const guidesRow = userRows.find((row) => row.path === "/docs/guides/");
		expect(guidesRow?.parent_id).toBe(docsRow?.id);
		expect(guidesRow?.display_name).toBe("guides");

		const nestedFile = userRows.find(
			(row) => row.path === "/docs/guides/intro.md",
		);
		expect(nestedFile?.parent_id).toBe(guidesRow?.id);
		expect(nestedFile?.display_name).toBe("intro.md");
		expect(isHidden(nestedFile?.hidden)).toBe(false);
	});

	test("distinguishes root files from nested files", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			archiveBytes: markdownPluginV2ArchiveBytes,
		});

		await qb(lix)
			.insertInto("lix_directory")
			.values({ path: "/docs/" } as any)
			.execute();

		await qb(lix)
			.insertInto("lix_file")
			.values([
				{ id: "root_file", path: "/root.md", data: new Uint8Array() },
				{ id: "nested_file", path: "/docs/deep.md", data: new Uint8Array() },
			])
			.execute();

		const rows = await selectFilesystemEntries(lix).execute();
		const rootRow = rows.find((row) => row.id === "root_file");
		expect(rootRow?.parent_id).toBeNull();
		const docsRow = rows.find((row) => row.path === "/docs/");
		const nestedRow = rows.find((row) => row.id === "nested_file");
		expect(docsRow).toBeDefined();
		expect(nestedRow?.parent_id).toBe(docsRow?.id);
	});

	test("includes hidden flags for directories and files", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			archiveBytes: markdownPluginV2ArchiveBytes,
		});

		await qb(lix)
			.insertInto("lix_directory")
			.values({ path: "/private/", hidden: true } as any)
			.execute();

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "hidden_file",
				path: "/secret.md",
				data: new Uint8Array(),
				hidden: true,
			})
			.execute();

		const rows = await selectFilesystemEntries(lix).execute();
		const dirRow = rows.find((row) => row.path === "/private/");
		expect(isHidden(dirRow?.hidden)).toBe(true);
		const fileRow = rows.find((row) => row.path === "/secret.md");
		expect(isHidden(fileRow?.hidden)).toBe(true);
	});
});

describe("selectWorkingDiffCount", () => {
	test("scopes change count to active file and responds to edits/checkpoints", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			archiveBytes: markdownPluginV2ArchiveBytes,
		});

		const fileA = "file_A";
		const fileB = "file_B";

		// Seed two files
		await qb(lix)
			.insertInto("lix_file")
			.values({ id: fileA, path: "/a.md", data: new TextEncoder().encode("A") })
			.execute();
		await qb(lix)
			.insertInto("lix_file")
			.values({ id: fileB, path: "/b.md", data: new TextEncoder().encode("B") })
			.execute();

		// Set active file to A and checkpoint initial inserts
		await qb(lix)
			.insertInto("lix_key_value_by_version")
			.values({
				key: "flashtype_active_file_id",
				value: fileA,
				lixcol_version_id: "global",
				lixcol_untracked: true,
			})
			.execute();
		await lix.createCheckpoint();

		// Make a change in A
		await qb(lix)
			.updateTable("lix_file")
			.set({ data: new TextEncoder().encode("A change") })
			.where("id", "=", fileA)
			.execute();

		// selectWorkingDiff should return >0 for active file A
		const diffA1 = await selectWorkingDiffCount(lix).executeTakeFirst();
		expect(diffA1?.total ?? 0).toBeGreaterThan(0);

		// Make an additional change in B but keep active file = A
		await qb(lix)
			.updateTable("lix_file")
			.set({ data: new TextEncoder().encode("B change") })
			.where("id", "=", fileB)
			.execute();

		// Still scoped to A → count should remain the same as only A's changes are counted
		const diffA2 = await selectWorkingDiffCount(lix).executeTakeFirst();
		expect(diffA2?.total ?? 0).toBe(diffA1?.total ?? 0);

		// Switch active file to B
		await qb(lix)
			.updateTable("lix_key_value_by_version")
			.set({ value: fileB })
			.where("key", "=", "flashtype_active_file_id")
			.where("lixcol_version_id", "=", "global")
			.execute();

		const diffB = await selectWorkingDiffCount(lix).executeTakeFirst();
		expect(diffB?.total ?? 0).toBeGreaterThan(0);

		// Checkpoint and expect zero for B
		await lix.createCheckpoint();
		const diffBAfter = await selectWorkingDiffCount(lix).executeTakeFirst();
		expect(diffBAfter?.total ?? 0).toBe(0);
	});

	test("order-only change yields zero working diff count (excludes root schema)", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			archiveBytes: markdownPluginV2ArchiveBytes,
		});

		const fileId = "file_order_only";
		const before = `# Title\n\nParagraph 1.\n\nParagraph 2.`;

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/order-only.md",
				data: new TextEncoder().encode(before),
			})
			.execute();

		await qb(lix)
			.insertInto("lix_key_value_by_version")
			.values({
				key: "flashtype_active_file_id",
				value: fileId,
				lixcol_version_id: "global",
				lixcol_untracked: true,
			})
			.execute();

		await lix.createCheckpoint();

		// Reorder paragraphs without editing content
		const after = `# Title\n\nParagraph 2.\n\nParagraph 1.`;
		await qb(lix)
			.updateTable("lix_file")
			.set({ data: new TextEncoder().encode(after) })
			.where("id", "=", fileId)
			.execute();

		// Poll a few times to allow detection to run
		for (let i = 0; i < 10; i++) {
			const diff = await selectWorkingDiffCount(lix).executeTakeFirst();
			if ((diff?.total ?? 0) === 0) break;
			await new Promise((r) => setTimeout(r, 10));
		}

		const diffFinal = await selectWorkingDiffCount(lix).executeTakeFirst();
		expect(diffFinal?.total ?? 0).toBe(0);
	});
});
