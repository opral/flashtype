import { describe, expect, test } from "vitest";
import { qb } from "@/lib/lix-kysely";
import { openLix } from "@/test-utils/node-lix-sdk";
import {
	resolveCheckpointDiff,
	resolveCheckpointDiffForBranch,
} from "./checkpoint-diff";

describe("resolveCheckpointDiff", () => {
	test("ignores hidden branches when choosing the previous checkpoint", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "file_doc", "/doc.md", "# Before\n");
			const before = await lix.createBranch({ name: "a-before" });
			await qb(lix)
				.deleteFrom("lix_file")
				.where("id", "=", "file_doc")
				.execute();
			const hidden = await lix.createBranch({ name: "a-hidden" });
			await qb(lix)
				.updateTable("lix_branch")
				.set({ hidden: true })
				.where("id", "=", hidden.id)
				.execute();
			await writeFile(lix, "file_doc", "/doc.md", "# After\n");
			const after = await lix.createBranch({ name: "b-after" });

			const diff = await resolveCheckpointDiffForBranch({
				lix,
				branchId: after.id,
			});

			expect(diff?.beforeCommitId).toBe(before.commitId);
			expect(diff?.afterCommitId).toBe(after.commitId);
			expect(diff?.files).toHaveLength(1);
			expect(diff?.files[0]).toMatchObject({
				fileId: "file_doc",
				path: "/doc.md",
				status: "modified",
			});
		} finally {
			await lix.close();
		}
	});

	test("diffs a modified file against the previous visible checkpoint row", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "file_doc", "/doc.md", "# Before\n");
			const before = await lix.createBranch({ name: "a-before" });
			await writeFile(lix, "file_doc", "/doc.md", "# After\n");
			const after = await lix.createBranch({ name: "b-after" });

			const diff = await resolveCheckpointDiff({
				lix,
				branchId: after.id,
				branches: [
					{ id: before.id, name: before.name, commit_id: before.commitId },
					{ id: after.id, name: after.name, commit_id: after.commitId },
				],
			});

			expect(diff?.beforeCommitId).toBe(before.commitId);
			expect(diff?.afterCommitId).toBe(after.commitId);
			expect(diff?.files).toHaveLength(1);
			expect(diff?.files[0]).toMatchObject({
				fileId: "file_doc",
				path: "/doc.md",
				status: "modified",
			});
			expect(decode(diff?.files[0]?.beforeData)).toBe("# Before\n");
			expect(decode(diff?.files[0]?.afterData)).toBe("# After\n");
		} finally {
			await lix.close();
		}
	});

	test("uses empty before data for added files", async () => {
		const lix = await openLix();
		try {
			const before = await lix.createBranch({ name: "a-before" });
			await writeFile(lix, "file_added", "/added.md", "# Added\n");
			const after = await lix.createBranch({ name: "b-after" });

			const diff = await resolveCheckpointDiff({
				lix,
				branchId: after.id,
				branches: [
					{ id: before.id, name: before.name, commit_id: before.commitId },
					{ id: after.id, name: after.name, commit_id: after.commitId },
				],
			});

			expect(diff?.files).toHaveLength(1);
			expect(diff?.files[0]?.status).toBe("added");
			expect(decode(diff?.files[0]?.beforeData)).toBe("");
			expect(decode(diff?.files[0]?.afterData)).toBe("# Added\n");
		} finally {
			await lix.close();
		}
	});

	test("uses empty after data for deleted files", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "file_deleted", "/deleted.md", "# Deleted\n");
			const before = await lix.createBranch({ name: "a-before" });
			await qb(lix)
				.deleteFrom("lix_file")
				.where("id", "=", "file_deleted")
				.execute();
			const after = await lix.createBranch({ name: "b-after" });

			const diff = await resolveCheckpointDiff({
				lix,
				branchId: after.id,
				branches: [
					{ id: before.id, name: before.name, commit_id: before.commitId },
					{ id: after.id, name: after.name, commit_id: after.commitId },
				],
			});

			expect(diff?.files).toHaveLength(1);
			expect(diff?.files[0]?.status).toBe("deleted");
			expect(decode(diff?.files[0]?.beforeData)).toBe("# Deleted\n");
			expect(decode(diff?.files[0]?.afterData)).toBe("");
		} finally {
			await lix.close();
		}
	});

	test("diffs the first visible checkpoint against the initial commit", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "file_doc", "/doc.md", "# First\n");
			const first = await lix.createBranch({ name: "a-first" });

			const diff = await resolveCheckpointDiff({
				lix,
				branchId: first.id,
				branches: [
					{ id: first.id, name: first.name, commit_id: first.commitId },
				],
			});

			expect(diff?.beforeBranchName).toBe("Initial Commit");
			expect(diff?.beforeCommitId).not.toBe(first.commitId);
			expect(diff?.afterCommitId).toBe(first.commitId);
			expect(diff?.files).toHaveLength(1);
			expect(diff?.files[0]).toMatchObject({
				fileId: "file_doc",
				path: "/doc.md",
				status: "added",
			});
			expect(decode(diff?.files[0]?.beforeData)).toBe("");
			expect(decode(diff?.files[0]?.afterData)).toBe("# First\n");
		} finally {
			await lix.close();
		}
	});

	test("diffs every visible file in the first checkpoint snapshot", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "file_alpha", "/alpha.md", "# Alpha\n");
			await writeFile(lix, "file_beta", "/beta.md", "# Beta\n");
			await writeFile(lix, "file_gamma", "/gamma.md", "# Gamma\n");
			const first = await lix.createBranch({ name: "a-first" });

			const diff = await resolveCheckpointDiff({
				lix,
				branchId: first.id,
				branches: [
					{ id: first.id, name: first.name, commit_id: first.commitId },
				],
			});

			expect(diff?.beforeBranchName).toBe("Initial Commit");
			expect(diff?.files.map((file) => file.path)).toEqual([
				"/alpha.md",
				"/beta.md",
				"/gamma.md",
			]);
			expect(diff?.files.map((file) => file.status)).toEqual([
				"added",
				"added",
				"added",
			]);
		} finally {
			await lix.close();
		}
	});

	test("diffs the current checkpoint against the initial commit when no checkpoint is above it", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "file_current", "/current.md", "# Current\n");
			const activeBranchId = await lix.activeBranchId();
			const activeCommitId = await readBranchCommitId(lix, activeBranchId);
			const initialCommitId = await initialCommitIdForCommit(
				lix,
				activeCommitId,
			);

			const diff = await resolveCheckpointDiff({
				lix,
				branchId: activeBranchId,
				branches: [
					{ id: activeBranchId, name: "main", commit_id: activeCommitId },
				],
			});

			expect(diff?.branchId).toBe(activeBranchId);
			expect(diff?.beforeBranchName).toBe("Initial Commit");
			expect(diff?.beforeCommitId).toBe(initialCommitId);
			expect(diff?.afterCommitId).toBe(activeCommitId);
			expect(diff?.files).toHaveLength(1);
			expect(diff?.files[0]).toMatchObject({
				fileId: "file_current",
				path: "/current.md",
				status: "added",
			});
		} finally {
			await lix.close();
		}
	});

	test("returns null for missing commits", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "file_doc", "/doc.md", "# Before\n");
			const first = await lix.createBranch({ name: "a-first" });
			await writeFile(lix, "file_doc", "/doc.md", "# After\n");
			const second = await lix.createBranch({ name: "b-second" });

			await expect(
				resolveCheckpointDiff({
					lix,
					branchId: second.id,
					branches: [
						{ id: first.id, name: first.name, commit_id: null },
						{ id: second.id, name: second.name, commit_id: second.commitId },
					],
				}),
			).resolves.toBeNull();
		} finally {
			await lix.close();
		}
	});
});

async function writeFile(
	lix: Awaited<ReturnType<typeof openLix>>,
	id: string,
	path: string,
	text: string,
): Promise<void> {
	await qb(lix)
		.insertInto("lix_file")
		.values({ id, path, data: new TextEncoder().encode(text) })
		.onConflict((oc) =>
			oc.column("id").doUpdateSet({
				path,
				data: new TextEncoder().encode(text),
			}),
		)
		.execute();
}

function decode(data: Uint8Array | undefined): string {
	return new TextDecoder().decode(data);
}

async function readBranchCommitId(
	lix: Awaited<ReturnType<typeof openLix>>,
	branchId: string,
): Promise<string> {
	const result = await qb(lix)
		.selectFrom("lix_branch")
		.select(["commit_id"])
		.where("id", "=", branchId)
		.executeTakeFirstOrThrow();
	expect(result.commit_id).toEqual(expect.any(String));
	return result.commit_id as string;
}

async function initialCommitIdForCommit(
	lix: Awaited<ReturnType<typeof openLix>>,
	commitId: string,
): Promise<string> {
	const result = await lix.execute(
		`
			SELECT h.observed_commit_id AS commit_id
			FROM lix_state_history AS h
			LEFT JOIN lix_commit_edge AS e
				ON e.child_id = h.observed_commit_id
			WHERE h.start_commit_id = $1
				AND h.schema_key = 'lix_commit'
				AND e.child_id IS NULL
			ORDER BY h.depth DESC
			LIMIT 1
		`,
		[commitId],
	);
	const commitIds = result.rows
		.map((row) => row.get("commit_id"))
		.filter(
			(value): value is string => typeof value === "string" && value.length > 0,
		);
	expect(commitIds).toHaveLength(1);
	return commitIds[0] as string;
}
