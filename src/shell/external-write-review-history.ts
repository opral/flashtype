import { useEffect, useMemo, useState } from "react";
import type { Lix } from "@/lib/lix-types";
import { useLix, useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import type { ExternalWriteReview } from "@/extension-runtime/external-write-review";
import {
	AGENT_TURN_COMMIT_RANGE_KEY,
	isAgentTurnCommitRange,
	readAgentTurnCommitRange,
	type AgentTurnCommitRange,
} from "./agent-turn-review-range";

type FileHistoryRow = {
	readonly data: unknown;
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

export function useExternalWriteReview(args: {
	readonly fileId?: string | null;
	readonly path?: string | null;
	readonly isReviewResolved?: (reviewId: string) => boolean;
}): ExternalWriteReview | null {
	const lix = useLix();
	const rangeRow = useQueryTakeFirst<{ value: unknown }>((lix) =>
		qb(lix)
			.selectFrom("lix_key_value_by_branch")
			.select("value")
			.where("key", "=", AGENT_TURN_COMMIT_RANGE_KEY)
			.where("lixcol_branch_id", "=", "global")
			.limit(1),
	);
	const range = useMemo(
		() => (isAgentTurnCommitRange(rangeRow?.value) ? rangeRow.value : null),
		[rangeRow?.value],
	);
	const [review, setReview] = useState<ExternalWriteReview | null>(null);

	useEffect(() => {
		let cancelled = false;
		setReview(null);
		if (!args.fileId || !args.path || !range) {
			return;
		}
		void getAgentTurnExternalWriteReview(lix, args.fileId, args.path, range)
			.then((nextReview) => {
				if (!cancelled) {
					setReview(nextReview);
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					console.warn("[agent-turn-review] failed to load review", error);
					setReview(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [lix, args.fileId, args.path, range]);

	if (!review || args.isReviewResolved?.(review.reviewId)) {
		return null;
	}
	return review;
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
		reviewId: `${fileId}:${range.id}`,
		beforeData,
		afterData,
		beforeCommitId: range.beforeCommitId,
		afterCommitId: range.afterCommitId,
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
		.select("data")
		.where("lixcol_start_commit_id", "=", commitId)
		.where("id", "=", fileId)
		.orderBy("lixcol_depth", "asc")
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
