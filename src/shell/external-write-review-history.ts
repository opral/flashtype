import type { Lix } from "@/lib/lix-types";
import { qb } from "@/lib/lix-kysely";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import { hashFileData } from "@/extension-runtime/external-write-tracking";
import type { ExternalWriteReview } from "@/extension-runtime/external-write-review";
import {
	readAgentTurnCommitRange,
	type AgentTurnCommitRange,
} from "./agent-turn-review-range";

type FileHistoryRow = {
	readonly data: unknown;
	readonly lixcol_depth: number | null;
	readonly lixcol_observed_commit_id: string | null;
};

export async function getExternalWriteReview(
	lix: Lix,
	fileId: string,
	path: string,
): Promise<ExternalWriteReview | null> {
	const range = await readAgentTurnCommitRange(lix);
	if (!range || range.beforeCommitId === range.afterCommitId) return null;
	return getAgentTurnExternalWriteReview(lix, fileId, path, range);
}

async function getAgentTurnExternalWriteReview(
	lix: Lix,
	fileId: string,
	path: string,
	range: AgentTurnCommitRange,
): Promise<ExternalWriteReview | null> {
	const [before, after] = await Promise.all([
		getFileHistorySnapshotAtCommit(lix, fileId, range.beforeCommitId),
		getFileHistorySnapshotAtCommit(lix, fileId, range.afterCommitId),
	]);
	if (!before || !after) return null;
	const beforeData = decodeFileDataToBytes(before.data);
	const afterData = decodeFileDataToBytes(after.data);
	if (fileBytesEqual(beforeData, afterData)) return null;
	return {
		fileId,
		path,
		reviewId: `${fileId}:${range.id}:${hashFileData(beforeData)}:${hashFileData(afterData)}`,
		beforeData,
		afterData,
		beforeCommitId: range.beforeCommitId,
		afterCommitId: range.afterCommitId,
		beforeDepth:
			typeof before.lixcol_depth === "number" ? before.lixcol_depth : undefined,
		afterDepth:
			typeof after.lixcol_depth === "number" ? after.lixcol_depth : undefined,
		agentTurnRangeId: range.id,
	};
}

async function getFileHistorySnapshotAtCommit(
	lix: Lix,
	fileId: string,
	commitId: string,
): Promise<FileHistoryRow | null> {
	const row = (await qb(lix)
		.selectFrom("lix_file_history")
		.select(["data", "lixcol_depth", "lixcol_observed_commit_id"])
		.where("lixcol_start_commit_id", "=", commitId)
		.where("id", "=", fileId)
		.where("lixcol_depth", "=", 0)
		.limit(1)
		.executeTakeFirst()) as FileHistoryRow | undefined;
	return row ?? null;
}

function fileBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}
