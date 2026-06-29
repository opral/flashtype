import { FLASHTYPE_CHECKPOINTS_KEY } from "@/hooks/key-value/schema";
import { qb } from "@/lib/lix-kysely";
import type { Lix } from "@/lib/lix-types";

const checkpointMutationQueues = new WeakMap<Lix, Promise<void>>();

export async function readCheckpointCommitIds(
	lix: Lix,
): Promise<readonly string[]> {
	const branchId = await lix.activeBranchId();
	const row = await qb(lix)
		.selectFrom("lix_key_value_by_branch")
		.select("value")
		.where("key", "=", FLASHTYPE_CHECKPOINTS_KEY)
		.where("lixcol_branch_id", "=", branchId)
		.limit(1)
		.executeTakeFirst();
	return isCheckpointCommitIdArray(row?.value) ? row.value : [];
}

export async function appendCheckpointCommitId(
	lix: Lix,
	commitId: string,
): Promise<void> {
	if (commitId.length === 0) {
		return;
	}
	await runCheckpointMutation(lix, async () => {
		const commitIds = await readCheckpointCommitIds(lix);
		await writeCheckpointCommitIds(lix, [...commitIds, commitId]);
	});
}

async function writeCheckpointCommitIds(
	lix: Lix,
	commitIds: readonly string[],
): Promise<void> {
	const value = commitIds.filter(
		(commitId) => typeof commitId === "string" && commitId.length > 0,
	);
	const branchId = await lix.activeBranchId();
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: FLASHTYPE_CHECKPOINTS_KEY,
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

async function runCheckpointMutation<T>(
	lix: Lix,
	operation: () => Promise<T>,
): Promise<T> {
	const previous = checkpointMutationQueues.get(lix) ?? Promise.resolve();
	let releaseCurrent: (() => void) | undefined;
	const current = new Promise<void>((resolve) => {
		releaseCurrent = resolve;
	});
	const next = previous.catch(() => undefined).then(() => current);
	checkpointMutationQueues.set(lix, next);
	await previous.catch(() => undefined);
	try {
		return await operation();
	} finally {
		releaseCurrent?.();
		if (checkpointMutationQueues.get(lix) === next) {
			checkpointMutationQueues.delete(lix);
		}
	}
}

function isCheckpointCommitIdArray(
	value: unknown,
): value is readonly string[] {
	return (
		Array.isArray(value) &&
		value.every(
			(commitId) => typeof commitId === "string" && commitId.length > 0,
		)
	);
}
