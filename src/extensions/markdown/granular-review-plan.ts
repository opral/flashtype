import type { MarkdownBlockSnapshot } from "./review-diff";
import {
	orderMarkdownBlocks,
	renderMarkdownProjection,
} from "./granular-review-projection";

// Snapshot-based planner for per-change Markdown review. It never inspects the
// rendered DOM, never patches source byte ranges, and never relies on the
// `markdown-wc` parser. A "change" is derived purely from the before/after
// `markdown_block` snapshots that Lix materialized, and every mixed result is
// composed in Lix projection space (see `granular-review-projection.ts`).
//
// Safety is proven up front: the plan is only `safe` when rejecting everything
// reproduces `beforeData` and accepting everything reproduces `afterData`
// byte-for-byte, and when global identity/order invariants guarantee that any
// mixed accept/reject combination yields a unique, deterministically ordered
// projection. Anything else falls back to the classic all-or-nothing review.

export type GranularReviewFallbackReason =
	| "missing_snapshots"
	| "invalid_snapshot"
	| "projection_mismatch"
	| "ambiguous_identity"
	| "ambiguous_order"
	| "unsupported_compound";

export type ReviewDecision = "pending" | "accepted" | "rejected";

export type GranularReviewChangeKind =
	| "insert"
	| "delete"
	| "update"
	| "replace";

export type GranularReviewChange = {
	readonly id: string;
	readonly kind: GranularReviewChangeKind;
	readonly beforeBlockIds: readonly string[];
	readonly afterBlockIds: readonly string[];
	readonly displayOrder: number;
};

export type GranularReviewPlan = {
	readonly changes: readonly GranularReviewChange[];
	/**
	 * Resolve a fully-decided plan to canonical projection bytes. Accepted
	 * changes contribute their after-state, rejected changes their before-state.
	 * Throws if any change is still pending.
	 */
	readonly resolve: (
		decisions: ReadonlyMap<string, "accepted" | "rejected">,
	) => Uint8Array;
};

export type GranularReviewEligibility =
	| { readonly status: "safe"; readonly plan: GranularReviewPlan }
	| { readonly status: "unsafe"; readonly reason: GranularReviewFallbackReason };

export type GranularReviewInput = {
	readonly beforeBlocks: readonly MarkdownBlockSnapshot[] | undefined;
	readonly afterBlocks: readonly MarkdownBlockSnapshot[] | undefined;
	readonly beforeData: Uint8Array;
	readonly afterData: Uint8Array;
};

type Segment = {
	readonly before: readonly MarkdownBlockSnapshot[];
	readonly after: readonly MarkdownBlockSnapshot[];
};

function unsafe(
	reason: GranularReviewFallbackReason,
): GranularReviewEligibility {
	return { status: "unsafe", reason };
}

/**
 * Build a safe granular review plan, or report a coarse fallback reason.
 */
export function planGranularReview(
	input: GranularReviewInput,
): GranularReviewEligibility {
	const { beforeBlocks, afterBlocks, beforeData, afterData } = input;
	if (!beforeBlocks || !afterBlocks) return unsafe("missing_snapshots");

	const beforeValidation = validateSide(beforeBlocks);
	const afterValidation = validateSide(afterBlocks);
	if (!beforeValidation || !afterValidation) return unsafe("invalid_snapshot");

	// The whole feature depends on Flashtype reproducing the exact Lix
	// projection from snapshots. If it cannot, never offer granular controls.
	if (!bytesEqual(renderMarkdownProjection(beforeBlocks), beforeData)) {
		return unsafe("projection_mismatch");
	}
	if (!bytesEqual(renderMarkdownProjection(afterBlocks), afterData)) {
		return unsafe("projection_mismatch");
	}

	const before = orderMarkdownBlocks(beforeBlocks);
	const after = orderMarkdownBlocks(afterBlocks);

	const anchorIds = strictlyUnchangedIds(before, after);
	const beforeSegments = segmentByAnchors(before, anchorIds);
	const afterSegments = segmentByAnchors(after, anchorIds);

	// Anchors must delimit the same regions on both sides, in the same order.
	if (
		!sameAnchorSequence(beforeSegments.anchorOrder, afterSegments.anchorOrder)
	) {
		return unsafe("ambiguous_order");
	}
	if (beforeSegments.gaps.length !== afterSegments.gaps.length) {
		return unsafe("ambiguous_order");
	}

	const changes: GranularReviewChange[] = [];
	const segments: Segment[] = [];
	let displayOrder = 0;
	for (let i = 0; i < beforeSegments.gaps.length; i += 1) {
		const beforeGap = beforeSegments.gaps[i] ?? [];
		const afterGap = afterSegments.gaps[i] ?? [];
		if (beforeGap.length === 0 && afterGap.length === 0) continue;
		segments.push({ before: beforeGap, after: afterGap });
		changes.push({
			id: `change-${displayOrder}`,
			kind: classifyChange(beforeGap, afterGap),
			beforeBlockIds: beforeGap.map((block) => block.id),
			afterBlockIds: afterGap.map((block) => block.id),
			displayOrder,
		});
		displayOrder += 1;
	}

	const unchanged = before.filter((block) => anchorIds.has(block.id));

	// Global invariants that make any mixed accept/reject combination provably
	// valid: every block id and every order key is owned by exactly one change
	// (or is an unchanged anchor). This rules out moves and boundary churn that
	// could duplicate or drop a block under some decision combination.
	const ownership = checkOwnership(segments, unchanged);
	if (ownership) return unsafe(ownership);

	const changeById = new Map<string, Segment>();
	changes.forEach((change, index) => {
		const segment = segments[index];
		if (segment) changeById.set(change.id, segment);
	});

	const plan: GranularReviewPlan = {
		changes,
		resolve: (decisions) =>
			resolvePlan({
				changes,
				changeById,
				unchanged,
				beforeData,
				afterData,
				decisions,
			}),
	};
	return { status: "safe", plan };
}

function resolvePlan(args: {
	readonly changes: readonly GranularReviewChange[];
	readonly changeById: ReadonlyMap<string, Segment>;
	readonly unchanged: readonly MarkdownBlockSnapshot[];
	readonly beforeData: Uint8Array;
	readonly afterData: Uint8Array;
	readonly decisions: ReadonlyMap<string, "accepted" | "rejected">;
}): Uint8Array {
	const { changes, changeById, unchanged, beforeData, afterData, decisions } =
		args;

	let acceptedCount = 0;
	let rejectedCount = 0;
	for (const change of changes) {
		const decision = decisions.get(change.id);
		if (decision === "accepted") acceptedCount += 1;
		else if (decision === "rejected") rejectedCount += 1;
		else throw new Error(`Cannot resolve a pending change: ${change.id}`);
	}

	// Exact fast paths: keep the original projection bytes untouched.
	if (rejectedCount === 0) return afterData;
	if (acceptedCount === 0) return beforeData;

	const selected: MarkdownBlockSnapshot[] = [...unchanged];
	for (const change of changes) {
		const segment = changeById.get(change.id);
		if (!segment) continue;
		const decision = decisions.get(change.id);
		selected.push(...(decision === "accepted" ? segment.after : segment.before));
	}
	return renderMarkdownProjection(selected);
}

function validateSide(blocks: readonly MarkdownBlockSnapshot[]): boolean {
	const ids = new Set<string>();
	const orderKeys = new Set<string>();
	for (const block of blocks) {
		if (
			!block ||
			typeof block.id !== "string" ||
			block.id.length === 0 ||
			typeof block.orderKey !== "string" ||
			block.orderKey.length === 0 ||
			typeof block.block !== "string"
		) {
			return false;
		}
		if (ids.has(block.id)) return false;
		if (orderKeys.has(block.orderKey)) return false;
		ids.add(block.id);
		orderKeys.add(block.orderKey);
	}
	return true;
}

function strictlyUnchangedIds(
	before: readonly MarkdownBlockSnapshot[],
	after: readonly MarkdownBlockSnapshot[],
): Set<string> {
	const afterById = new Map(after.map((block) => [block.id, block]));
	const anchors = new Set<string>();
	for (const block of before) {
		const counterpart = afterById.get(block.id);
		if (
			counterpart &&
			counterpart.block === block.block &&
			counterpart.orderKey === block.orderKey
		) {
			anchors.add(block.id);
		}
	}
	return anchors;
}

function segmentByAnchors(
	sorted: readonly MarkdownBlockSnapshot[],
	anchorIds: ReadonlySet<string>,
): { gaps: MarkdownBlockSnapshot[][]; anchorOrder: string[] } {
	const gaps: MarkdownBlockSnapshot[][] = [[]];
	const anchorOrder: string[] = [];
	for (const block of sorted) {
		if (anchorIds.has(block.id)) {
			anchorOrder.push(block.id);
			gaps.push([]);
		} else {
			gaps[gaps.length - 1]?.push(block);
		}
	}
	return { gaps, anchorOrder };
}

function sameAnchorSequence(left: string[], right: string[]): boolean {
	if (left.length !== right.length) return false;
	return left.every((id, index) => id === right[index]);
}

function classifyChange(
	before: readonly MarkdownBlockSnapshot[],
	after: readonly MarkdownBlockSnapshot[],
): GranularReviewChangeKind {
	if (before.length === 0) return "insert";
	if (after.length === 0) return "delete";
	if (before.length === 1 && after.length === 1) return "update";
	return "replace";
}

function checkOwnership(
	segments: readonly Segment[],
	unchanged: readonly MarkdownBlockSnapshot[],
): GranularReviewFallbackReason | null {
	const idOwner = new Map<string, string>();
	const orderKeyOwner = new Map<string, string>();

	for (const block of unchanged) {
		idOwner.set(block.id, "unchanged");
		orderKeyOwner.set(block.orderKey, "unchanged");
	}

	for (let i = 0; i < segments.length; i += 1) {
		const owner = `change-${i}`;
		const segment = segments[i];
		if (!segment) continue;
		for (const block of [...segment.before, ...segment.after]) {
			const existingId = idOwner.get(block.id);
			if (existingId && existingId !== owner) return "ambiguous_identity";
			idOwner.set(block.id, owner);

			const existingOrder = orderKeyOwner.get(block.orderKey);
			if (existingOrder && existingOrder !== owner) return "ambiguous_order";
			orderKeyOwner.set(block.orderKey, owner);
		}
	}
	return null;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) return false;
	for (let i = 0; i < left.length; i += 1) {
		if (left[i] !== right[i]) return false;
	}
	return true;
}
