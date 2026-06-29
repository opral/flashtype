import { useEffect, useMemo, useState } from "react";
import type { Lix } from "@/lib/lix-types";
import { useLix, useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import type {
	ExternalWriteReview,
	ExternalWriteReviewData,
} from "@/extension-runtime/external-write-review";
import {
	AGENT_TURN_COMMIT_RANGE_KEY,
	agentTurnReviewId,
	isAgentTurnCommitRangeStore,
	readAgentTurnCommitRanges,
	type AgentTurnCommitRange,
} from "./agent-turn-review-range";

type FileHistoryRow = {
	readonly data: unknown;
};

export type ExternalWriteReviewFile = {
	readonly fileId: string;
	readonly path: string;
};

export async function getExternalWriteReview(
	lix: Lix,
	fileId: string,
	path: string,
): Promise<ExternalWriteReview | null> {
	const ranges = await readAgentTurnCommitRanges(lix);
	return getAgentTurnExternalWriteReview(lix, fileId, path, ranges);
}

export async function getPendingExternalWriteReviewPaths(
	lix: Lix,
	files: readonly ExternalWriteReviewFile[],
	ranges?: readonly AgentTurnCommitRange[],
): Promise<Set<string>> {
	const pendingPaths = new Set<string>();
	const resolvedRanges = ranges ?? (await readAgentTurnCommitRanges(lix));
	if (files.length === 0 || resolvedRanges.length === 0) {
		return pendingPaths;
	}
	await Promise.all(
		files.map(async (file) => {
			const review = await getAgentTurnExternalWriteReview(
				lix,
				file.fileId,
				file.path,
				resolvedRanges,
			);
			if (review) {
				pendingPaths.add(file.path);
			}
		}),
	);
	return pendingPaths;
}

export function useExternalWriteReview(args: {
	readonly fileId?: string | null;
	readonly path?: string | null;
}): ExternalWriteReview | null {
	const lix = useLix();
	const activeBranch = useQueryTakeFirst<{ value: string }>((lix) =>
		qb(lix)
			.selectFrom("lix_key_value")
			.where("key", "=", "lix_workspace_branch_id")
			.select(["value"]),
	);
	const activeBranchId =
		typeof activeBranch?.value === "string" ? activeBranch.value : "";
	const rangeRow = useQueryTakeFirst<{ value: unknown }>((lix) =>
		qb(lix)
			.selectFrom("lix_key_value_by_branch")
			.select("value")
			.where("key", "=", AGENT_TURN_COMMIT_RANGE_KEY)
			.where("lixcol_branch_id", "=", activeBranchId)
			.limit(1),
	);
	const ranges = useMemo(
		() =>
			isAgentTurnCommitRangeStore(rangeRow?.value) ? rangeRow.value.ranges : [],
		[rangeRow?.value],
	);
	const [review, setReview] = useState<ExternalWriteReview | null>(null);

	useEffect(() => {
		let cancelled = false;
		setReview(null);
		if (!args.fileId || !args.path || ranges.length === 0) {
			return;
		}
		void getAgentTurnExternalWriteReview(lix, args.fileId, args.path, ranges)
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
	}, [lix, args.fileId, args.path, ranges]);

	if (!review) {
		return null;
	}
	return review;
}

export function useExternalWriteReviewData(
	review: ExternalWriteReview | null | undefined,
): ExternalWriteReviewData | null {
	const lix = useLix();
	const [data, setData] = useState<ExternalWriteReviewData | null>(null);

	useEffect(() => {
		let cancelled = false;
		setData(null);
		if (!review) {
			return;
		}
		void getExternalWriteReviewData(lix, review)
			.then((nextData) => {
				if (!cancelled) {
					setData(nextData);
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					console.warn("[agent-turn-review] failed to load review data", error);
					setData(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [lix, review]);

	return data;
}

export async function getExternalWriteReviewData(
	lix: Lix,
	review: ExternalWriteReview,
): Promise<ExternalWriteReviewData | null> {
	const [beforeData, afterData] = await Promise.all([
		getFileDataAtCommit(lix, review.fileId, review.beforeCommitId),
		getFileDataAtCommit(lix, review.fileId, review.afterCommitId),
	]);
	if (!beforeData || !afterData) return null;
	return { beforeData, afterData };
}

export async function getFileDataAtCommit(
	lix: Lix,
	fileId: string,
	commitId: string,
): Promise<Uint8Array | null> {
	const snapshot = await getFileHistorySnapshotAtCommit(lix, fileId, commitId);
	return snapshot ? decodeFileDataToBytes(snapshot.data) : null;
}

async function getAgentTurnExternalWriteReview(
	lix: Lix,
	fileId: string,
	path: string,
	ranges: readonly AgentTurnCommitRange[],
): Promise<ExternalWriteReview | null> {
	const relevantRanges: AgentTurnCommitRange[] = [];
	for (const range of ranges) {
		if (range.beforeCommitId === range.afterCommitId) continue;
		if (range.clearedFileIds?.includes(fileId)) continue;
		const data = await getRangeFileData(lix, fileId, range);
		if (!data) continue;
		if (fileBytesEqual(data.beforeData, data.afterData)) continue;
		relevantRanges.push(range);
	}
	if (relevantRanges.length === 0) return null;
	const firstRange = relevantRanges[0];
	const lastRange = relevantRanges[relevantRanges.length - 1];
	if (!firstRange || !lastRange) return null;
	const [beforeData, afterData] = await Promise.all([
		getFileDataAtCommit(lix, fileId, firstRange.beforeCommitId),
		getFileDataAtCommit(lix, fileId, lastRange.afterCommitId),
	]);
	if (!beforeData || !afterData) return null;
	if (fileBytesEqual(beforeData, afterData)) return null;
	const rangeIds = relevantRanges.map((range) => range.id);
	return {
		fileId,
		path,
		reviewId: agentTurnReviewId(fileId, rangeIds),
		beforeCommitId: firstRange.beforeCommitId,
		afterCommitId: lastRange.afterCommitId,
		agentTurnRangeIds: rangeIds,
	};
}

async function getRangeFileData(
	lix: Lix,
	fileId: string,
	range: AgentTurnCommitRange,
): Promise<ExternalWriteReviewData | null> {
	const [beforeData, afterData] = await Promise.all([
		getFileDataAtCommit(lix, fileId, range.beforeCommitId),
		getFileDataAtCommit(lix, fileId, range.afterCommitId),
	]);
	if (!beforeData || !afterData) return null;
	return { beforeData, afterData };
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
