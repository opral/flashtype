import { describe, expect, test } from "vitest";
import { openLix, type Lix } from "@/test-utils/node-lix-sdk";
import { qb } from "@/lib/lix-kysely";
import { getExternalWriteReview } from "./external-write-review-history";
import {
	clearAgentTurnCommitRange,
	readAgentTurnCommitRange,
	writeAgentTurnCommitRange,
	type AgentTurnCommitRange,
} from "./agent-turn-review-range";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("getExternalWriteReview", () => {
	test("returns no review when no agent turn range exists", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "history-file", "/docs/history.md", "before");
			await writeFile(lix, "history-file", "/docs/history.md", "after");

			const review = await getExternalWriteReview(
				lix,
				"history-file",
				"/docs/history.md",
			);

			expect(review).toBeNull();
		} finally {
			await lix.close();
		}
	});

	test("uses an agent turn range for the review diff", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "agent-file", "/docs/agent.md", "turn before");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, "agent-file", "/docs/agent.md", "intermediate");
			await writeFile(lix, "agent-file", "/docs/agent.md", "turn after");
			const afterCommitId = await activeCommitId(lix);

			await writeAgentTurnCommitRange(
				lix,
				agentRange({ id: "range-1", beforeCommitId, afterCommitId }),
			);

			const review = await getExternalWriteReview(
				lix,
				"agent-file",
				"/docs/agent.md",
			);

			expect(review?.agentTurnRangeId).toBe("range-1");
			expect(review?.beforeCommitId).toBe(beforeCommitId);
			expect(review?.afterCommitId).toBe(afterCommitId);
			expect(decode(review?.beforeData)).toBe("turn before");
			expect(decode(review?.afterData)).toBe("turn after");
		} finally {
			await lix.close();
		}
	});

	test("returns no review for a no-op agent turn range", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "noop-file", "/docs/noop.md", "before");
			const commitId = await activeCommitId(lix);
			await writeFile(lix, "noop-file", "/docs/noop.md", "after");

			await writeAgentTurnCommitRange(
				lix,
				agentRange({
					id: "range-noop",
					beforeCommitId: commitId,
					afterCommitId: commitId,
				}),
			);

			await expect(
				getExternalWriteReview(lix, "noop-file", "/docs/noop.md"),
			).resolves.toBeNull();
		} finally {
			await lix.close();
		}
	});

	test("clears only the matching persisted agent turn range", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "clear-file", "/docs/clear.md", "before");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, "clear-file", "/docs/clear.md", "after");
			const afterCommitId = await activeCommitId(lix);
			await writeAgentTurnCommitRange(
				lix,
				agentRange({ id: "range-to-clear", beforeCommitId, afterCommitId }),
			);

			await clearAgentTurnCommitRange(lix, "other-range");
			expect((await readAgentTurnCommitRange(lix))?.id).toBe("range-to-clear");

			await clearAgentTurnCommitRange(lix, "range-to-clear");
			await expect(readAgentTurnCommitRange(lix)).resolves.toBeNull();
		} finally {
			await lix.close();
		}
	});

	test("omits undefined optional ids when persisting agent turn ranges", async () => {
		const lix = await openLix();
		try {
			await writeAgentTurnCommitRange(lix, {
				id: "range-without-optional-ids",
				agent: "codex",
				beforeCommitId: "commit-before",
				afterCommitId: "commit-after",
				sessionId: undefined,
				turnId: undefined,
				startedAt: 1,
				completedAt: 2,
			});

			const range = await readAgentTurnCommitRange(lix);

			expect(range?.id).toBe("range-without-optional-ids");
			expect(Object.hasOwn(range ?? {}, "sessionId")).toBe(false);
			expect(Object.hasOwn(range ?? {}, "turnId")).toBe(false);
		} finally {
			await lix.close();
		}
	});
});

async function writeFile(
	lix: Lix,
	id: string,
	path: string,
	text: string,
): Promise<void> {
	await qb(lix)
		.insertInto("lix_file")
		.values({ id, path, data: encoder.encode(text) })
		.onConflict((oc) =>
			oc.column("id").doUpdateSet({ path, data: encoder.encode(text) }),
		)
		.execute();
}

async function activeCommitId(lix: Lix): Promise<string> {
	const result = await lix.execute(
		"SELECT lix_active_branch_commit_id() AS commit_id",
	);
	const commitId = result.rows[0]?.get("commit_id");
	if (typeof commitId !== "string") {
		throw new Error("Missing active commit id");
	}
	return commitId;
}

function agentRange(
	overrides: Pick<
		AgentTurnCommitRange,
		"id" | "beforeCommitId" | "afterCommitId"
	>,
): AgentTurnCommitRange {
	return {
		agent: "codex",
		sessionId: "session-1",
		turnId: "turn-1",
		startedAt: 1,
		completedAt: 2,
		...overrides,
	};
}

function decode(value: Uint8Array | undefined): string {
	return decoder.decode(value ?? new Uint8Array());
}
