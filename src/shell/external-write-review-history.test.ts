import { createElement, Suspense, useEffect, type ComponentType } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { openLix, type Lix } from "@/test-utils/node-lix-sdk";
import { qb } from "@/lib/lix-kysely";
import type { ExternalWriteReview } from "@/extension-runtime/external-write-review";
import {
	getExternalWriteReview,
	useExternalWriteReview,
} from "./external-write-review-history";
import {
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

	test("uses the nearest inherited file history snapshot at the before commit", async () => {
		const lix = await openLix();
		try {
			await writeFile(
				lix,
				"inherited-file",
				"/docs/inherited.md",
				"inherited before",
			);
			await writeFile(
				lix,
				"other-file",
				"/docs/other.md",
				"unrelated turn start",
			);
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(
				lix,
				"inherited-file",
				"/docs/inherited.md",
				"inherited after",
			);
			const afterCommitId = await activeCommitId(lix);

			await writeAgentTurnCommitRange(
				lix,
				agentRange({ id: "range-inherited", beforeCommitId, afterCommitId }),
			);

			const review = await getExternalWriteReview(
				lix,
				"inherited-file",
				"/docs/inherited.md",
			);

			expect(review?.agentTurnRangeId).toBe("range-inherited");
			expect(decode(review?.beforeData)).toBe("inherited before");
			expect(decode(review?.afterData)).toBe("inherited after");
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

	test("updates an already mounted review hook when the persisted range appears", async () => {
		const lix = await openLix();
		let utils: ReturnType<typeof render> | undefined;
		try {
			await writeFile(lix, "live-file", "/docs/live.md", "live before");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, "live-file", "/docs/live.md", "live after");
			const afterCommitId = await activeCommitId(lix);
			const reviews: Array<ExternalWriteReview | null> = [];

			await act(async () => {
				utils = render(
					createElement(
						LixProvider as ComponentType<{ lix: Lix }>,
						{ lix },
						createElement(
							Suspense,
							{ fallback: null },
							createElement(ExternalWriteReviewProbe, {
								fileId: "live-file",
								path: "/docs/live.md",
								onReview: (review) => reviews.push(review),
							}),
						),
					),
				);
			});

			await waitFor(() => {
				expect(reviews.length).toBeGreaterThan(0);
				expect(reviews.at(-1)).toBeNull();
			});

			await act(async () => {
				await writeAgentTurnCommitRange(
					lix,
					agentRange({
						id: "range-live-hook",
						beforeCommitId,
						afterCommitId,
					}),
				);
			});

			await waitFor(() => {
				const review = reviews.at(-1);
				expect(review?.agentTurnRangeId).toBe("range-live-hook");
				expect(decode(review?.beforeData)).toBe("live before");
				expect(decode(review?.afterData)).toBe("live after");
			});
		} finally {
			await act(async () => {
				utils?.unmount();
			});
			await lix.close();
		}
	});
});

function ExternalWriteReviewProbe({
	fileId,
	path,
	onReview,
}: {
	readonly fileId: string;
	readonly path: string;
	readonly onReview: (review: ExternalWriteReview | null) => void;
}) {
	const review = useExternalWriteReview({ fileId, path });
	useEffect(() => {
		onReview(review);
	}, [onReview, review]);
	return null;
}

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
