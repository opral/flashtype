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
	| "unsupported_compound"
	| "extended_markdown";

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
	/**
	 * Stable identity of this change across re-plans (the involved block ids).
	 * Used to carry a decision when sequential external writes fold into the same
	 * open review and the plan is recomputed.
	 */
	readonly key: string;
	/**
	 * Content fingerprint of the change's before/after blocks. A carried decision
	 * is only reused when the signature still matches, so a change whose content
	 * evolved is re-reviewed rather than silently re-deciding unseen content.
	 */
	readonly signature: string;
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
	| {
			readonly status: "unsafe";
			readonly reason: GranularReviewFallbackReason;
	  };

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

	// Extended Markdown (YAML frontmatter, footnotes, math) is deliberately kept
	// on the classic all-or-nothing path. Even when the block projection happens
	// to round-trip these constructs byte-for-byte, the per-change diff display
	// and block highlighting do not map cleanly onto them, so granular review
	// could mislead. This is a cheap, conservative textual signal over the
	// projection bytes themselves — it never parses with `markdown-wc` and never
	// treats that parser as the source of truth for granularity. False positives
	// only ever degrade to classic, which is always safe.
	if (
		hasExtendedMarkdown(decodeProjection(beforeData)) ||
		hasExtendedMarkdown(decodeProjection(afterData))
	) {
		return unsafe("extended_markdown");
	}

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

	// Align both sides on their common block ids. A common id is an alignment
	// point: if its content/order is identical it is unchanged, otherwise it is
	// its own atomic update. Blocks unique to one side (inserts/deletes) between
	// alignment points are grouped into one compound change per gap.
	const beforeIds = new Set(before.map((block) => block.id));
	const afterIds = new Set(after.map((block) => block.id));
	const beforeCommon = before
		.filter((block) => afterIds.has(block.id))
		.map((block) => block.id);
	const afterCommon = after
		.filter((block) => beforeIds.has(block.id))
		.map((block) => block.id);
	// Differing common-id order means a move/reorder we cannot represent safely.
	if (!sameSequence(beforeCommon, afterCommon)) {
		return unsafe("ambiguous_order");
	}

	const changes: GranularReviewChange[] = [];
	const segments: Segment[] = [];
	const unchanged: MarkdownBlockSnapshot[] = [];
	let displayOrder = 0;
	const pushChange = (
		beforeGap: readonly MarkdownBlockSnapshot[],
		afterGap: readonly MarkdownBlockSnapshot[],
		kind: GranularReviewChangeKind,
	) => {
		segments.push({ before: beforeGap, after: afterGap });
		changes.push({
			id: `change-${displayOrder}`,
			kind,
			beforeBlockIds: beforeGap.map((block) => block.id),
			afterBlockIds: afterGap.map((block) => block.id),
			displayOrder,
			key: changeKey(beforeGap, afterGap),
			signature: changeSignature(beforeGap, afterGap),
		});
		displayOrder += 1;
	};

	let i = 0;
	let j = 0;
	for (const commonId of beforeCommon) {
		const beforeGap: MarkdownBlockSnapshot[] = [];
		while (i < before.length && before[i]!.id !== commonId) {
			beforeGap.push(before[i]!);
			i += 1;
		}
		const afterGap: MarkdownBlockSnapshot[] = [];
		while (j < after.length && after[j]!.id !== commonId) {
			afterGap.push(after[j]!);
			j += 1;
		}
		if (beforeGap.length > 0 || afterGap.length > 0) {
			pushChange(beforeGap, afterGap, classifyGap(beforeGap, afterGap));
		}
		const beforeBlock = before[i]!;
		const afterBlock = after[j]!;
		i += 1;
		j += 1;
		if (
			beforeBlock.block === afterBlock.block &&
			beforeBlock.orderKey === afterBlock.orderKey
		) {
			unchanged.push(beforeBlock);
		} else {
			pushChange([beforeBlock], [afterBlock], "update");
		}
	}
	const beforeTail = before.slice(i);
	const afterTail = after.slice(j);
	if (beforeTail.length > 0 || afterTail.length > 0) {
		pushChange(beforeTail, afterTail, classifyGap(beforeTail, afterTail));
	}

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
		selected.push(
			...(decision === "accepted" ? segment.after : segment.before),
		);
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

function sameSequence(
	left: readonly string[],
	right: readonly string[],
): boolean {
	if (left.length !== right.length) return false;
	return left.every((id, index) => id === right[index]);
}

function changeKey(
	before: readonly MarkdownBlockSnapshot[],
	after: readonly MarkdownBlockSnapshot[],
): string {
	const ids = new Set<string>();
	for (const block of before) ids.add(block.id);
	for (const block of after) ids.add(block.id);
	return [...ids].sort().join("|");
}

function changeSignature(
	before: readonly MarkdownBlockSnapshot[],
	after: readonly MarkdownBlockSnapshot[],
): string {
	const serialize = (blocks: readonly MarkdownBlockSnapshot[]) =>
		blocks.map((block) => [block.id, block.orderKey, block.block]);
	return hashString(JSON.stringify([serialize(before), serialize(after)]));
}

function hashString(value: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < value.length; i += 1) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

function classifyGap(
	before: readonly MarkdownBlockSnapshot[],
	after: readonly MarkdownBlockSnapshot[],
): GranularReviewChangeKind {
	if (before.length === 0) return "insert";
	if (after.length === 0) return "delete";
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

// YAML frontmatter fenced at the very start of the document.
const FRONTMATTER_PATTERN = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
// Footnote reference or definition, e.g. `[^1]` / `[^note]:`.
const FOOTNOTE_PATTERN = /\[\^[^\]\s]+\]/;
// Block math fences `$$ … $$`.
const BLOCK_MATH_PATTERN = /\$\$/;
// Inline math `$ … $` on a single line. Intentionally broad: prose mentioning
// two dollar amounts will also match and fall back to classic, which is safe.
const INLINE_MATH_PATTERN = /\$[^$\n]+\$/;

function decodeProjection(data: Uint8Array): string {
	return new TextDecoder().decode(data);
}

function hasExtendedMarkdown(text: string): boolean {
	return (
		FRONTMATTER_PATTERN.test(text) ||
		FOOTNOTE_PATTERN.test(text) ||
		BLOCK_MATH_PATTERN.test(text) ||
		INLINE_MATH_PATTERN.test(text)
	);
}
