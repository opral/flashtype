import type { Lix } from "@/lib/lix-types";
import { qb } from "@/lib/lix-kysely";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import { hashFileData } from "@/extension-runtime/external-write-tracking";
import type { ExternalWriteReview } from "@/extension-runtime/external-write-review";

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
	const rows = await getHistoryRows(lix, fileId);
	if (!rows || rows.history.length < 2) return null;
	const afterData = decodeFileDataToBytes(rows.history[0]?.data);
	const beforeData = decodeFileDataToBytes(rows.history[1]?.data);
	const afterCommitId =
		rows.history[0]?.lixcol_observed_commit_id ?? rows.startCommitId;
	const afterDepth =
		typeof rows.history[0]?.lixcol_depth === "number"
			? rows.history[0].lixcol_depth
			: undefined;
	return {
		fileId,
		path,
		reviewId: [
			fileId,
			hashFileData(beforeData),
			hashFileData(afterData),
			afterCommitId,
			afterDepth ?? "unknown-depth",
		].join(":"),
		afterData,
		beforeData,
		afterCommitId,
		beforeCommitId: rows.history[1]?.lixcol_observed_commit_id ?? undefined,
		afterDepth,
		beforeDepth:
			typeof rows.history[1]?.lixcol_depth === "number"
				? rows.history[1].lixcol_depth
				: undefined,
	};
}

export function createExternalWriteReviewFromSnapshots({
	fileId,
	path,
	beforeData,
	afterData,
}: {
	readonly fileId: string;
	readonly path: string;
	readonly beforeData: Uint8Array;
	readonly afterData: Uint8Array;
}): ExternalWriteReview {
	const before = new Uint8Array(beforeData);
	const after = new Uint8Array(afterData);
	return {
		fileId,
		path,
		reviewId: [
			fileId,
			hashFileData(before),
			hashFileData(after),
			Date.now().toString(36),
			Math.random().toString(36).slice(2),
		].join(":"),
		beforeData: before,
		afterData: after,
	};
}

async function getHistoryRows(
	lix: Lix,
	fileId: string,
): Promise<{ startCommitId: string; history: FileHistoryRow[] } | null> {
	const activeBranchId = await lix.activeBranchId();
	const branch = await qb(lix)
		.selectFrom("lix_branch")
		.select("commit_id")
		.where("id", "=", activeBranchId)
		.limit(1)
		.executeTakeFirst();

	const startCommitId = branch?.commit_id;
	if (typeof startCommitId !== "string" || startCommitId.length === 0) {
		return null;
	}

	const history = (await qb(lix)
		.selectFrom("lix_file_history")
		.select(["data", "lixcol_depth", "lixcol_observed_commit_id"])
		.where("lixcol_start_commit_id", "=", startCommitId)
		.where("id", "=", fileId)
		.orderBy("lixcol_depth", "asc")
		.limit(2)
		.execute()) as FileHistoryRow[];
	return { startCommitId, history };
}
