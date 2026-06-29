import { createElement, Suspense, useEffect, type ComponentType } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { openLix, type Lix } from "@/test-utils/node-lix-sdk";
import { qb } from "@/lib/lix-kysely";
import type { ExternalWriteReview } from "@/extension-runtime/external-write-review";
import {
	getExternalWriteReview,
	getExternalWriteReviewData,
	getFirstPendingExternalWriteReviewFile,
	useExternalWriteReview,
} from "./external-write-review-history";
import {
	appendAgentTurnCommitRange,
	clearAgentTurnCommitRangeFile,
	readAgentTurnCommitRanges,
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

			await appendAgentTurnCommitRange(
				lix,
				agentRange({ id: "range-1", beforeCommitId, afterCommitId }),
			);

			const review = await getExternalWriteReview(
				lix,
				"agent-file",
				"/docs/agent.md",
			);

			expect(review?.agentTurnRangeIds).toEqual(["range-1"]);
			expect(review?.beforeCommitId).toBe(beforeCommitId);
			expect(review?.afterCommitId).toBe(afterCommitId);
			await expectReviewData(lix, review, "turn before", "turn after");
		} finally {
			await lix.close();
		}
	});

	test("finds the first file with a pending review for an agent range", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "changed-file", "/docs/changed.md", "before");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, "changed-file", "/docs/changed.md", "after");
			const afterCommitId = await activeCommitId(lix);

			const file = await getFirstPendingExternalWriteReviewFile(
				lix,
				agentRange({
					id: "range-first-review-file",
					beforeCommitId,
					afterCommitId,
				}),
			);

			expect(file).toEqual({
				fileId: "changed-file",
				path: "/docs/changed.md",
			});
		} finally {
			await lix.close();
		}
	});

	test("returns no first pending review file for a no-op range", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "noop-first-file", "/docs/noop-first.md", "before");
			const commitId = await activeCommitId(lix);
			await writeFile(lix, "noop-first-file", "/docs/noop-first.md", "after");

			const file = await getFirstPendingExternalWriteReviewFile(
				lix,
				agentRange({
					id: "range-noop-first-file",
					beforeCommitId: commitId,
					afterCommitId: commitId,
				}),
			);

			expect(file).toBeNull();
		} finally {
			await lix.close();
		}
	});

	test("skips cleared files when finding the first pending review file", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "cleared-first-file", "/docs/a-cleared.md", "a0");
			await writeFile(lix, "open-first-file", "/docs/b-open.md", "b0");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, "cleared-first-file", "/docs/a-cleared.md", "a1");
			await writeFile(lix, "open-first-file", "/docs/b-open.md", "b1");
			const afterCommitId = await activeCommitId(lix);

			const file = await getFirstPendingExternalWriteReviewFile(lix, {
				...agentRange({
					id: "range-cleared-first-file",
					beforeCommitId,
					afterCommitId,
				}),
				clearedFileIds: ["cleared-first-file"],
			});

			expect(file).toEqual({
				fileId: "open-first-file",
				path: "/docs/b-open.md",
			});
		} finally {
			await lix.close();
		}
	});

	test("uses deterministic path order when multiple files changed", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "z-file", "/docs/z-later.md", "z0");
			await writeFile(lix, "a-file", "/docs/a-first.md", "a0");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, "z-file", "/docs/z-later.md", "z1");
			await writeFile(lix, "a-file", "/docs/a-first.md", "a1");
			const afterCommitId = await activeCommitId(lix);

			const file = await getFirstPendingExternalWriteReviewFile(
				lix,
				agentRange({
					id: "range-multiple-first-file",
					beforeCommitId,
					afterCommitId,
				}),
			);

			expect(file).toEqual({
				fileId: "a-file",
				path: "/docs/a-first.md",
			});
		} finally {
			await lix.close();
		}
	});

	test("skips files whose aggregate review cancels out", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "a-file", "/docs/a-first.md", "a0");
			await writeFile(lix, "b-file", "/docs/b-next.md", "b0");
			const firstBeforeCommitId = await activeCommitId(lix);
			await writeFile(lix, "a-file", "/docs/a-first.md", "a1");
			const firstAfterCommitId = await activeCommitId(lix);
			const firstRange = agentRange({
				id: "range-aggregate-first",
				beforeCommitId: firstBeforeCommitId,
				afterCommitId: firstAfterCommitId,
			});
			const secondRange = agentRange({
				id: "range-aggregate-second",
				beforeCommitId: firstAfterCommitId,
				afterCommitId: firstAfterCommitId,
			});
			await writeFile(lix, "a-file", "/docs/a-first.md", "a0");
			await writeFile(lix, "b-file", "/docs/b-next.md", "b1");
			const secondAfterCommitId = await activeCommitId(lix);
			const range = {
				...secondRange,
				afterCommitId: secondAfterCommitId,
			};

			const file = await getFirstPendingExternalWriteReviewFile(lix, range, [
				firstRange,
				range,
			]);

			expect(file).toEqual({
				fileId: "b-file",
				path: "/docs/b-next.md",
			});
		} finally {
			await lix.close();
		}
	});

	test("returns no first pending review file when no file is reviewable", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "same-file", "/docs/same.md", "same");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, "same-file", "/docs/same.md", "same");
			const afterCommitId = await activeCommitId(lix);

			const file = await getFirstPendingExternalWriteReviewFile(
				lix,
				agentRange({
					id: "range-no-reviewable-file",
					beforeCommitId,
					afterCommitId,
				}),
			);

			expect(file).toBeNull();
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

			await appendAgentTurnCommitRange(
				lix,
				agentRange({ id: "range-inherited", beforeCommitId, afterCommitId }),
			);

			const review = await getExternalWriteReview(
				lix,
				"inherited-file",
				"/docs/inherited.md",
			);

			expect(review?.agentTurnRangeIds).toEqual(["range-inherited"]);
			await expectReviewData(
				lix,
				review,
				"inherited before",
				"inherited after",
			);
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

			await appendAgentTurnCommitRange(
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
			await appendAgentTurnCommitRange(lix, {
				id: "range-without-optional-ids",
				agent: "codex",
				beforeCommitId: "commit-before",
				afterCommitId: "commit-after",
				sessionId: undefined,
				turnId: undefined,
				startedAt: 1,
				completedAt: 2,
			});

			const [range] = await readAgentTurnCommitRanges(lix);

			expect(range?.id).toBe("range-without-optional-ids");
			expect(Object.hasOwn(range ?? {}, "sessionId")).toBe(false);
			expect(Object.hasOwn(range ?? {}, "turnId")).toBe(false);
		} finally {
			await lix.close();
		}
	});

	test("serializes concurrent agent turn range appends", async () => {
		const lix = await openLix();
		try {
			const ranges = Array.from({ length: 8 }, (_, index) =>
				agentRange({
					id: `range-concurrent-${index}`,
					beforeCommitId: `commit-before-${index}`,
					afterCommitId: `commit-after-${index}`,
				}),
			);

			await Promise.all(
				ranges.map((range) => appendAgentTurnCommitRange(lix, range)),
			);

			const persistedRanges = await readAgentTurnCommitRanges(lix);
			expect(persistedRanges).toHaveLength(ranges.length);
			expect(persistedRanges.map((range) => range.id).sort()).toEqual(
				ranges.map((range) => range.id).sort(),
			);
		} finally {
			await lix.close();
		}
	});

	test("persists cleared files in the agent turn range", async () => {
		const lix = await openLix();
		try {
			await writeFile(
				lix,
				"cleared-file",
				"/docs/cleared.md",
				"cleared before",
			);
			await writeFile(lix, "open-file", "/docs/open.md", "open before");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, "cleared-file", "/docs/cleared.md", "cleared after");
			await writeFile(lix, "open-file", "/docs/open.md", "open after");
			const afterCommitId = await activeCommitId(lix);
			const range = agentRange({
				id: "range-with-cleared-file",
				beforeCommitId,
				afterCommitId,
			});

			await appendAgentTurnCommitRange(lix, range);
			await clearAgentTurnCommitRangeFile(lix, {
				fileId: "cleared-file",
				reviewId: "cleared-file:range-with-cleared-file",
				agentTurnRangeIds: [range.id],
			});

			const [persistedRange] = await readAgentTurnCommitRanges(lix);
			expect(persistedRange?.clearedFileIds).toEqual(["cleared-file"]);
			await expect(
				getExternalWriteReview(lix, "cleared-file", "/docs/cleared.md"),
			).resolves.toBeNull();
			const openReview = await getExternalWriteReview(
				lix,
				"open-file",
				"/docs/open.md",
			);
			expect(openReview?.agentTurnRangeIds).toEqual([
				"range-with-cleared-file",
			]);
			await expectReviewData(lix, openReview, "open before", "open after");
		} finally {
			await lix.close();
		}
	});

	test("combines unresolved ranges for the same file into one review", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "multi-file", "/docs/multi.md", "turn 1 before");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, "multi-file", "/docs/multi.md", "turn 1 after");
			const middleCommitId = await activeCommitId(lix);
			await appendAgentTurnCommitRange(
				lix,
				agentRange({
					id: "range-multi-1",
					beforeCommitId,
					afterCommitId: middleCommitId,
				}),
			);
			await writeFile(lix, "multi-file", "/docs/multi.md", "turn 2 after");
			const afterCommitId = await activeCommitId(lix);
			await appendAgentTurnCommitRange(
				lix,
				agentRange({
					id: "range-multi-2",
					beforeCommitId: middleCommitId,
					afterCommitId,
				}),
			);

			const review = await getExternalWriteReview(
				lix,
				"multi-file",
				"/docs/multi.md",
			);

			expect(review?.reviewId).toBe("multi-file:range-multi-1,range-multi-2");
			expect(review?.agentTurnRangeIds).toEqual([
				"range-multi-1",
				"range-multi-2",
			]);
			expect(review?.beforeCommitId).toBe(beforeCommitId);
			expect(review?.afterCommitId).toBe(afterCommitId);
			await expectReviewData(lix, review, "turn 1 before", "turn 2 after");
		} finally {
			await lix.close();
		}
	});

	test("clears a combined file review across all contributing ranges", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "multi-clear-file", "/docs/multi-clear.md", "a0");
			await writeFile(lix, "other-clear-file", "/docs/other-clear.md", "b0");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, "multi-clear-file", "/docs/multi-clear.md", "a1");
			await writeFile(lix, "other-clear-file", "/docs/other-clear.md", "b1");
			const middleCommitId = await activeCommitId(lix);
			await appendAgentTurnCommitRange(
				lix,
				agentRange({
					id: "range-clear-1",
					beforeCommitId,
					afterCommitId: middleCommitId,
				}),
			);
			await writeFile(lix, "multi-clear-file", "/docs/multi-clear.md", "a2");
			const afterCommitId = await activeCommitId(lix);
			await appendAgentTurnCommitRange(
				lix,
				agentRange({
					id: "range-clear-2",
					beforeCommitId: middleCommitId,
					afterCommitId,
				}),
			);
			const review = await getExternalWriteReview(
				lix,
				"multi-clear-file",
				"/docs/multi-clear.md",
			);
			expect(review?.agentTurnRangeIds).toEqual([
				"range-clear-1",
				"range-clear-2",
			]);

			await clearAgentTurnCommitRangeFile(lix, {
				fileId: "multi-clear-file",
				reviewId: review?.reviewId,
				agentTurnRangeIds: review?.agentTurnRangeIds,
			});

			const ranges = await readAgentTurnCommitRanges(lix);
			expect(ranges.map((range) => range.clearedFileIds)).toEqual([
				["multi-clear-file"],
				["multi-clear-file"],
			]);
			await expect(
				getExternalWriteReview(lix, "multi-clear-file", "/docs/multi-clear.md"),
			).resolves.toBeNull();
			const otherReview = await getExternalWriteReview(
				lix,
				"other-clear-file",
				"/docs/other-clear.md",
			);
			expect(otherReview?.agentTurnRangeIds).toEqual(["range-clear-1"]);
			await expectReviewData(lix, otherReview, "b0", "b1");
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
				await appendAgentTurnCommitRange(
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
				expect(review?.agentTurnRangeIds).toEqual(["range-live-hook"]);
				expect(review?.beforeCommitId).toBe(beforeCommitId);
				expect(review?.afterCommitId).toBe(afterCommitId);
			});
		} finally {
			await act(async () => {
				utils?.unmount();
			});
			await lix.close();
		}
	});

	test("updates an already mounted review hook when the file is cleared", async () => {
		const lix = await openLix();
		let utils: ReturnType<typeof render> | undefined;
		try {
			await writeFile(
				lix,
				"live-clear-file",
				"/docs/live-clear.md",
				"clear before",
			);
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(
				lix,
				"live-clear-file",
				"/docs/live-clear.md",
				"clear after",
			);
			const afterCommitId = await activeCommitId(lix);
			const reviews: Array<ExternalWriteReview | null> = [];

			await appendAgentTurnCommitRange(
				lix,
				agentRange({
					id: "range-live-clear-hook",
					beforeCommitId,
					afterCommitId,
				}),
			);

			await act(async () => {
				utils = render(
					createElement(
						LixProvider as ComponentType<{ lix: Lix }>,
						{ lix },
						createElement(
							Suspense,
							{ fallback: null },
							createElement(ExternalWriteReviewProbe, {
								fileId: "live-clear-file",
								path: "/docs/live-clear.md",
								onReview: (review) => reviews.push(review),
							}),
						),
					),
				);
			});

			await waitFor(() => {
				const review = reviews.at(-1);
				expect(review?.agentTurnRangeIds).toEqual(["range-live-clear-hook"]);
			});

			await act(async () => {
				await clearAgentTurnCommitRangeFile(lix, {
					fileId: "live-clear-file",
					reviewId: "live-clear-file:range-live-clear-hook",
					agentTurnRangeIds: ["range-live-clear-hook"],
				});
			});

			await waitFor(() => {
				expect(reviews.at(-1)).toBeNull();
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

async function expectReviewData(
	lix: Lix,
	review: ExternalWriteReview | null | undefined,
	beforeText: string,
	afterText: string,
): Promise<void> {
	expect(review).not.toBeNull();
	expect(review).not.toBeUndefined();
	const data = await getExternalWriteReviewData(
		lix,
		review as ExternalWriteReview,
	);
	expect(decode(data?.beforeData)).toBe(beforeText);
	expect(decode(data?.afterData)).toBe(afterText);
}

function decode(value: Uint8Array | undefined): string {
	return decoder.decode(value ?? new Uint8Array());
}
