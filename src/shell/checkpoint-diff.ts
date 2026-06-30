import type {
	CheckpointDiff,
	CheckpointDiffBranchRow,
	CheckpointDiffFile,
	CheckpointDiffFileStatus,
} from "@/extension-runtime/checkpoint-diff";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import type { Lix } from "@/lib/lix-types";
import { qb } from "@/lib/lix-kysely";

type FileHistorySnapshot = {
	readonly id: string;
	readonly path: string | null;
	readonly data: unknown | null;
	readonly lixcol_depth: number;
};

type VisibleFileSnapshot = {
	readonly id: string;
	readonly path: string;
	readonly data: unknown;
};

const EMPTY_DATA = new Uint8Array();

export async function resolveCheckpointDiff(args: {
	readonly lix: Lix;
	readonly branches: readonly CheckpointDiffBranchRow[];
	readonly branchId: string;
}): Promise<CheckpointDiff | null> {
	const selectedIndex = args.branches.findIndex(
		(branch) => branch.id === args.branchId,
	);
	if (selectedIndex < 0) return null;
	const afterBranch = args.branches[selectedIndex];
	if (!afterBranch?.commit_id) return null;
	const beforeBranch = args.branches[selectedIndex - 1] ?? null;
	const beforeCommitId = beforeBranch
		? beforeBranch.commit_id
		: await loadInitialCommitId(args.lix, afterBranch.commit_id);
	if (!beforeCommitId) return null;
	if (beforeCommitId === afterBranch.commit_id) return null;

	const [beforeSnapshots, afterSnapshots] = await Promise.all([
		loadFileSnapshotsAtCommit(args.lix, beforeCommitId),
		loadFileSnapshotsAtCommit(args.lix, afterBranch.commit_id),
	]);
	const files = buildCheckpointDiffFiles({
		beforeCommitId,
		beforeSnapshots,
		afterCommitId: afterBranch.commit_id,
		afterSnapshots,
	});
	if (files.length === 0) return null;
	return {
		branchId: afterBranch.id,
		branchName: afterBranch.name,
		beforeBranchId: beforeBranch?.id ?? `initial:${beforeCommitId}`,
		beforeBranchName: beforeBranch?.name ?? "Initial Commit",
		beforeCommitId,
		afterCommitId: afterBranch.commit_id,
		files,
	};
}

async function loadInitialCommitId(
	lix: Lix,
	startCommitId: string,
): Promise<string | null> {
	const result = await lix.execute(
		`
			SELECT h.observed_commit_id AS commit_id
			FROM lix_state_history h
			WHERE h.start_commit_id = ?
				AND h.schema_key = 'lix_commit'
			ORDER BY h.depth DESC
			LIMIT 1
		`,
		[startCommitId],
	);
	const commitIds = result.rows
		.map((row) => row.get("commit_id"))
		.filter(
			(value): value is string => typeof value === "string" && value.length > 0,
		);
	return commitIds.length === 1 ? commitIds[0] : null;
}

async function loadFileSnapshotsAtCommit(
	lix: Lix,
	commitId: string,
): Promise<VisibleFileSnapshot[]> {
	const rows = (await qb(lix)
		.selectFrom("lix_file_history")
		.select(["id", "path", "data", "lixcol_depth"])
		.where("lixcol_start_commit_id", "=", commitId)
		.orderBy("id", "asc")
		.orderBy("lixcol_depth", "asc")
		.execute()) as FileHistorySnapshot[];
	const latestByFileId = new Map<string, FileHistorySnapshot>();
	for (const row of rows) {
		const existing = latestByFileId.get(row.id);
		if (!existing || row.lixcol_depth < existing.lixcol_depth) {
			latestByFileId.set(row.id, row);
		}
	}
	return [...latestByFileId.values()]
		.filter((row) => typeof row.path === "string" && row.data !== null)
		.map((row) => ({
			id: row.id,
			path: row.path as string,
			data: row.data as unknown,
		}))
		.sort((left, right) => left.path.localeCompare(right.path));
}

function buildCheckpointDiffFiles(args: {
	readonly beforeCommitId: string;
	readonly beforeSnapshots: readonly VisibleFileSnapshot[];
	readonly afterCommitId: string;
	readonly afterSnapshots: readonly VisibleFileSnapshot[];
}): CheckpointDiffFile[] {
	const beforeById = new Map(
		args.beforeSnapshots.map((file) => [file.id, file]),
	);
	const afterById = new Map(args.afterSnapshots.map((file) => [file.id, file]));
	const beforeUnmatched = new Map(beforeById);
	const afterUnmatched = new Map(afterById);
	const files: CheckpointDiffFile[] = [];

	for (const [fileId, before] of beforeById) {
		const after = afterById.get(fileId);
		if (!after) continue;
		beforeUnmatched.delete(fileId);
		afterUnmatched.delete(fileId);
		const diffFile = buildDiffFile({
			before,
			beforeCommitId: args.beforeCommitId,
			after,
			afterCommitId: args.afterCommitId,
			status: "modified",
		});
		if (diffFile) {
			files.push(diffFile);
		}
	}

	for (const [beforeId, before] of [...beforeUnmatched]) {
		const after = [...afterUnmatched.values()].find(
			(candidate) => candidate.path === before.path,
		);
		if (!after) continue;
		beforeUnmatched.delete(beforeId);
		afterUnmatched.delete(after.id);
		const diffFile = buildDiffFile({
			before,
			beforeCommitId: args.beforeCommitId,
			after,
			afterCommitId: args.afterCommitId,
			status: "recreated",
		});
		if (diffFile) {
			files.push(diffFile);
		}
	}

	for (const before of beforeUnmatched.values()) {
		files.push(
			buildMissingSideDiffFile({
				before,
				beforeCommitId: args.beforeCommitId,
				afterCommitId: args.afterCommitId,
				status: "deleted",
			}),
		);
	}
	for (const after of afterUnmatched.values()) {
		files.push(
			buildMissingSideDiffFile({
				after,
				beforeCommitId: args.beforeCommitId,
				afterCommitId: args.afterCommitId,
				status: "added",
			}),
		);
	}

	return files.sort((left, right) => left.path.localeCompare(right.path));
}

function buildDiffFile(args: {
	readonly before: VisibleFileSnapshot;
	readonly beforeCommitId: string;
	readonly after: VisibleFileSnapshot;
	readonly afterCommitId: string;
	readonly status: Extract<CheckpointDiffFileStatus, "modified" | "recreated">;
}): CheckpointDiffFile | null {
	const beforeData = decodeFileDataToBytes(args.before.data);
	const afterData = decodeFileDataToBytes(args.after.data);
	const pathChanged = args.before.path !== args.after.path;
	const dataChanged = !fileBytesEqual(beforeData, afterData);
	if (args.status === "modified" && !pathChanged && !dataChanged) return null;
	return {
		fileId: args.after.id,
		path: args.after.path,
		beforePath: args.before.path,
		afterPath: args.after.path,
		beforeData,
		afterData,
		beforeCommitId: args.beforeCommitId,
		afterCommitId: args.afterCommitId,
		reviewId: checkpointDiffReviewId({
			beforeCommitId: args.beforeCommitId,
			afterCommitId: args.afterCommitId,
			fileId: args.after.id,
			path: args.after.path,
		}),
		status: args.status,
	};
}

function buildMissingSideDiffFile(
	args:
		| {
				readonly before: VisibleFileSnapshot;
				readonly beforeCommitId: string;
				readonly afterCommitId: string;
				readonly status: Extract<CheckpointDiffFileStatus, "deleted">;
		  }
		| {
				readonly after: VisibleFileSnapshot;
				readonly beforeCommitId: string;
				readonly afterCommitId: string;
				readonly status: Extract<CheckpointDiffFileStatus, "added">;
		  },
): CheckpointDiffFile {
	const before = "before" in args ? args.before : null;
	const after = "after" in args ? args.after : null;
	const fileId = after?.id ?? before?.id ?? "";
	const path = after?.path ?? before?.path ?? "";
	return {
		fileId,
		path,
		beforePath: before?.path ?? null,
		afterPath: after?.path ?? null,
		beforeData: before ? decodeFileDataToBytes(before.data) : EMPTY_DATA,
		afterData: after ? decodeFileDataToBytes(after.data) : EMPTY_DATA,
		beforeCommitId: args.beforeCommitId,
		afterCommitId: args.afterCommitId,
		reviewId: checkpointDiffReviewId({
			beforeCommitId: args.beforeCommitId,
			afterCommitId: args.afterCommitId,
			fileId,
			path,
		}),
		status: args.status,
	};
}

function checkpointDiffReviewId(args: {
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
	readonly fileId: string;
	readonly path: string;
}): string {
	return [
		"checkpoint",
		args.beforeCommitId,
		args.afterCommitId,
		args.fileId,
		args.path,
	].join(":");
}

function fileBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}
