import type { Lix } from "@/lib/lix-types";
import { qb } from "@/lib/lix-kysely";

export const AGENT_TURN_COMMIT_RANGE_KEY =
	"flashtype_agent_turn_commit_range" as const;

const agentTurnCommitRangeMutationQueues = new WeakMap<Lix, Promise<void>>();

export type AgentTurnCommitRange = {
	readonly id: string;
	readonly agent: "claude" | "codex";
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
	readonly sessionId?: string;
	readonly turnId?: string;
	readonly clearedFileIds?: readonly string[];
	readonly startedAt: number;
	readonly completedAt: number;
};

export type AgentTurnCommitRangeStore = {
	readonly ranges: readonly AgentTurnCommitRange[];
};

export function agentTurnReviewId(
	fileId: string,
	rangeIds: readonly string[],
): string {
	return `${fileId}:${rangeIds.join(",")}`;
}

export async function readAgentTurnCommitRanges(
	lix: Lix,
): Promise<readonly AgentTurnCommitRange[]> {
	const branchId = await lix.activeBranchId();
	const row = await qb(lix)
		.selectFrom("lix_key_value_by_branch")
		.select("value")
		.where("key", "=", AGENT_TURN_COMMIT_RANGE_KEY)
		.where("lixcol_branch_id", "=", branchId)
		.limit(1)
		.executeTakeFirst();
	return isAgentTurnCommitRangeStore(row?.value) ? row.value.ranges : [];
}

export async function appendAgentTurnCommitRange(
	lix: Lix,
	range: AgentTurnCommitRange,
): Promise<void> {
	await runAgentTurnCommitRangeMutation(lix, async () => {
		const ranges = await readAgentTurnCommitRanges(lix);
		await writeAgentTurnCommitRanges(lix, [
			...ranges.filter((existing) => existing.id !== range.id),
			range,
		]);
	});
}

async function writeAgentTurnCommitRanges(
	lix: Lix,
	ranges: readonly AgentTurnCommitRange[],
): Promise<void> {
	const value = serializeAgentTurnCommitRangeStore({ ranges });
	const branchId = await lix.activeBranchId();
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: AGENT_TURN_COMMIT_RANGE_KEY,
			value,
			lixcol_branch_id: branchId,
			lixcol_global: branchId === "global",
			lixcol_untracked: true,
		})
		.onConflict((oc) =>
			oc.columns(["key", "lixcol_branch_id"]).doUpdateSet({ value }),
		)
		.execute();
}

export async function clearAgentTurnCommitRangeFile(
	lix: Lix,
	args: {
		readonly fileId: string;
		readonly reviewId?: string;
		readonly agentTurnRangeIds?: readonly string[];
	},
): Promise<boolean> {
	return await runAgentTurnCommitRangeMutation(lix, async () => {
		const ranges = await readAgentTurnCommitRanges(lix);
		const rangeIds = args.agentTurnRangeIds ?? [];
		if (rangeIds.length === 0) {
			return false;
		}
		if (
			args.reviewId &&
			args.reviewId !== agentTurnReviewId(args.fileId, rangeIds)
		) {
			return false;
		}
		const rangeIdSet = new Set(rangeIds);
		let changed = false;
		const nextRanges = ranges.map((range) => {
			if (!rangeIdSet.has(range.id)) return range;
			if (range.clearedFileIds?.includes(args.fileId)) return range;
			changed = true;
			return {
				...range,
				clearedFileIds: [...(range.clearedFileIds ?? []), args.fileId],
			};
		});
		if (!changed) return false;
		await writeAgentTurnCommitRanges(lix, nextRanges);
		return true;
	});
}

async function runAgentTurnCommitRangeMutation<T>(
	lix: Lix,
	operation: () => Promise<T>,
): Promise<T> {
	const previous =
		agentTurnCommitRangeMutationQueues.get(lix) ?? Promise.resolve();
	let releaseCurrent: (() => void) | undefined;
	const current = new Promise<void>((resolve) => {
		releaseCurrent = resolve;
	});
	const next = previous.catch(() => undefined).then(() => current);
	agentTurnCommitRangeMutationQueues.set(lix, next);
	await previous.catch(() => undefined);
	try {
		return await operation();
	} finally {
		releaseCurrent?.();
		if (agentTurnCommitRangeMutationQueues.get(lix) === next) {
			agentTurnCommitRangeMutationQueues.delete(lix);
		}
	}
}

export function isAgentTurnCommitRangeStore(
	value: unknown,
): value is AgentTurnCommitRangeStore {
	if (!value || typeof value !== "object") {
		return false;
	}
	const store = value as Partial<AgentTurnCommitRangeStore>;
	return (
		Array.isArray(store.ranges) && store.ranges.every(isAgentTurnCommitRange)
	);
}

function isAgentTurnCommitRange(value: unknown): value is AgentTurnCommitRange {
	if (!value || typeof value !== "object") {
		return false;
	}
	const range = value as Partial<AgentTurnCommitRange>;
	const clearedFileIds = range.clearedFileIds;
	return (
		(range.agent === "claude" || range.agent === "codex") &&
		typeof range.id === "string" &&
		range.id.length > 0 &&
		typeof range.beforeCommitId === "string" &&
		range.beforeCommitId.length > 0 &&
		typeof range.afterCommitId === "string" &&
		range.afterCommitId.length > 0 &&
		typeof range.startedAt === "number" &&
		Number.isFinite(range.startedAt) &&
		typeof range.completedAt === "number" &&
		Number.isFinite(range.completedAt) &&
		(range.sessionId === undefined || typeof range.sessionId === "string") &&
		(range.turnId === undefined || typeof range.turnId === "string") &&
		(clearedFileIds === undefined ||
			(Array.isArray(clearedFileIds) &&
				clearedFileIds.every(
					(fileId) => typeof fileId === "string" && fileId.length > 0,
				)))
	);
}

function serializeAgentTurnCommitRangeStore(
	store: AgentTurnCommitRangeStore,
): AgentTurnCommitRangeStore {
	return {
		ranges: store.ranges.map(serializeAgentTurnCommitRange),
	};
}

function serializeAgentTurnCommitRange(
	range: AgentTurnCommitRange,
): AgentTurnCommitRange {
	return {
		id: range.id,
		agent: range.agent,
		beforeCommitId: range.beforeCommitId,
		afterCommitId: range.afterCommitId,
		...(range.sessionId !== undefined ? { sessionId: range.sessionId } : {}),
		...(range.turnId !== undefined ? { turnId: range.turnId } : {}),
		...(range.clearedFileIds?.length
			? { clearedFileIds: [...new Set(range.clearedFileIds)] }
			: {}),
		startedAt: range.startedAt,
		completedAt: range.completedAt,
	};
}
