import type { Lix } from "@/lib/lix-types";
import { qb } from "@/lib/lix-kysely";

export const AGENT_TURN_COMMIT_RANGE_KEY =
	"flashtype_agent_turn_commit_range" as const;

const GLOBAL_BRANCH_ID = "global";

export type AgentTurnCommitRange = {
	readonly id: string;
	readonly agent: "claude" | "codex";
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
	readonly sessionId?: string;
	readonly turnId?: string;
	readonly startedAt: number;
	readonly completedAt: number;
};

export async function readAgentTurnCommitRange(
	lix: Lix,
): Promise<AgentTurnCommitRange | null> {
	const row = await qb(lix)
		.selectFrom("lix_key_value_by_branch")
		.select("value")
		.where("key", "=", AGENT_TURN_COMMIT_RANGE_KEY)
		.where("lixcol_branch_id", "=", GLOBAL_BRANCH_ID)
		.limit(1)
		.executeTakeFirst();
	return isAgentTurnCommitRange(row?.value) ? row.value : null;
}

export async function writeAgentTurnCommitRange(
	lix: Lix,
	range: AgentTurnCommitRange,
): Promise<void> {
	const value = serializeAgentTurnCommitRange(range);
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: AGENT_TURN_COMMIT_RANGE_KEY,
			value,
			lixcol_branch_id: GLOBAL_BRANCH_ID,
			lixcol_global: true,
			lixcol_untracked: true,
		})
		.onConflict((oc) =>
			oc.columns(["key", "lixcol_branch_id"]).doUpdateSet({ value }),
		)
		.execute();
}

export async function clearAgentTurnCommitRange(
	lix: Lix,
	rangeId: string,
): Promise<void> {
	const current = await readAgentTurnCommitRange(lix);
	if (current?.id !== rangeId) {
		return;
	}
	await qb(lix)
		.deleteFrom("lix_key_value_by_branch")
		.where("key", "=", AGENT_TURN_COMMIT_RANGE_KEY)
		.where("lixcol_branch_id", "=", GLOBAL_BRANCH_ID)
		.execute();
}

export async function deleteAgentTurnCommitRange(lix: Lix): Promise<void> {
	await qb(lix)
		.deleteFrom("lix_key_value_by_branch")
		.where("key", "=", AGENT_TURN_COMMIT_RANGE_KEY)
		.where("lixcol_branch_id", "=", GLOBAL_BRANCH_ID)
		.execute();
}

export function isAgentTurnCommitRange(
	value: unknown,
): value is AgentTurnCommitRange {
	if (!value || typeof value !== "object") {
		return false;
	}
	const range = value as Partial<AgentTurnCommitRange>;
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
		(range.turnId === undefined || typeof range.turnId === "string")
	);
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
		startedAt: range.startedAt,
		completedAt: range.completedAt,
	};
}
