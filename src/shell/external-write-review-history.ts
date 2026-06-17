import type { Lix } from "@/lib/lix-types";
import { qb } from "@/lib/lix-kysely";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import { hashFileData } from "@/extension-runtime/external-write-tracking";
import type { ExternalWriteReview } from "@/extension-runtime/external-write-review";

type FileHistoryRow = {
	readonly data: unknown;
	readonly lixcol_depth: number | null;
};

export async function getExternalWriteReview(
	lix: Lix,
	fileId: string,
	path: string,
): Promise<ExternalWriteReview | null> {
	const rows = await getHistoryRows(lix, fileId);
	if (rows.length < 2) return null;
	const afterData = decodeFileDataToBytes(rows[0]?.data);
	const beforeData = decodeFileDataToBytes(rows[1]?.data);
	return {
		fileId,
		path,
		reviewId: `${fileId}:${hashFileData(beforeData)}:${hashFileData(afterData)}`,
		afterData,
		beforeData,
		afterDepth:
			typeof rows[0]?.lixcol_depth === "number"
				? rows[0].lixcol_depth
				: undefined,
		beforeDepth:
			typeof rows[1]?.lixcol_depth === "number"
				? rows[1].lixcol_depth
				: undefined,
	};
}

async function getHistoryRows(
	lix: Lix,
	fileId: string,
): Promise<FileHistoryRow[]> {
	const activeBranchId = await lix.activeBranchId();
	const branch = await qb(lix)
		.selectFrom("lix_branch")
		.select("commit_id")
		.where("id", "=", activeBranchId)
		.limit(1)
		.executeTakeFirst();

	const startCommitId = branch?.commit_id;
	if (typeof startCommitId !== "string" || startCommitId.length === 0) {
		return [];
	}

	return (await qb(lix)
		.selectFrom("lix_file_history")
		.select(["data", "lixcol_depth"])
		.where("lixcol_start_commit_id", "=", startCommitId)
		.where("id", "=", fileId)
		.orderBy("lixcol_depth", "asc")
		.limit(2)
		.execute()) as FileHistoryRow[];
}
