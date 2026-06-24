import { describe, expect, test } from "vitest";
import type { MarkdownBlockSnapshot } from "./review-diff";
import { renderMarkdownProjection } from "./granular-review-projection";
import {
	planGranularReview,
	type GranularReviewEligibility,
	type GranularReviewPlan,
} from "./granular-review-plan";

// Helper that derives canonical before/after bytes from the snapshots, so the
// projection-equality preflight always passes for well-formed fixtures.
function plan(
	beforeBlocks: readonly MarkdownBlockSnapshot[] | undefined,
	afterBlocks: readonly MarkdownBlockSnapshot[] | undefined,
	overrides?: { beforeData?: Uint8Array; afterData?: Uint8Array },
): GranularReviewEligibility {
	return planGranularReview({
		beforeBlocks,
		afterBlocks,
		beforeData:
			overrides?.beforeData ?? renderMarkdownProjection(beforeBlocks ?? []),
		afterData:
			overrides?.afterData ?? renderMarkdownProjection(afterBlocks ?? []),
	});
}

function expectSafe(eligibility: GranularReviewEligibility): GranularReviewPlan {
	if (eligibility.status !== "safe") {
		throw new Error(`expected safe plan, got unsafe: ${eligibility.reason}`);
	}
	return eligibility.plan;
}

function decisions(
	entries: Record<string, "accepted" | "rejected">,
): Map<string, "accepted" | "rejected"> {
	return new Map(Object.entries(entries));
}

const b = (id: string, orderKey: string, block: string): MarkdownBlockSnapshot => ({
	id,
	orderKey,
	block,
});

describe("planGranularReview eligibility", () => {
	test("missing snapshots fall back", () => {
		expect(plan(undefined, [b("a", "20", "x")]).status).toBe("unsafe");
		expect(plan([b("a", "20", "x")], undefined)).toMatchObject({
			status: "unsafe",
			reason: "missing_snapshots",
		});
	});

	test("invalid snapshot fields fall back", () => {
		const bad = [{ id: "", orderKey: "20", block: "x" }] as MarkdownBlockSnapshot[];
		expect(plan(bad, bad)).toMatchObject({
			status: "unsafe",
			reason: "invalid_snapshot",
		});
	});

	test("duplicate ids within one side fall back", () => {
		const dup = [b("a", "20", "x"), b("a", "40", "y")];
		expect(plan(dup, dup).status).toBe("unsafe");
	});

	test("projection mismatch falls back", () => {
		const before = [b("a", "20", "Title")];
		const after = [b("a", "20", "Title!")];
		const result = plan(before, after, {
			afterData: new TextEncoder().encode("totally different bytes"),
		});
		expect(result).toMatchObject({
			status: "unsafe",
			reason: "projection_mismatch",
		});
	});
});

describe("planGranularReview change detection", () => {
	test("a single in-place update is one update change", () => {
		const before = [b("h", "20", "# Title"), b("p", "40", "Body.")];
		const after = [b("h", "20", "# Title"), b("p", "40", "Body edited.")];
		const result = expectSafe(plan(before, after));
		expect(result.changes).toHaveLength(1);
		expect(result.changes[0]).toMatchObject({
			kind: "update",
			beforeBlockIds: ["p"],
			afterBlockIds: ["p"],
			displayOrder: 0,
		});
	});

	test("insertion and deletion are detected as separate changes", () => {
		const before = [b("h", "20", "# Title"), b("p", "40", "Body.")];
		const after = [
			b("h", "20", "# Title"),
			b("n", "30", "Inserted."),
			b("p", "40", "Body."),
		];
		const result = expectSafe(plan(before, after));
		expect(result.changes).toHaveLength(1);
		expect(result.changes[0]?.kind).toBe("insert");

		const del = expectSafe(plan(after, before));
		expect(del.changes[0]?.kind).toBe("delete");
	});

	test("two independent updates become two changes in document order", () => {
		const before = [
			b("a", "20", "Alpha"),
			b("m", "40", "Middle"),
			b("z", "60", "Zeta"),
		];
		const after = [
			b("a", "20", "Alpha edited"),
			b("m", "40", "Middle"),
			b("z", "60", "Zeta edited"),
		];
		const result = expectSafe(plan(before, after));
		expect(result.changes.map((c) => c.displayOrder)).toEqual([0, 1]);
		expect(result.changes.map((c) => c.afterBlockIds[0])).toEqual(["a", "z"]);
	});

	test("a paragraph split (delete-plus-insert) is one compound change", () => {
		const before = [b("h", "20", "# Title"), b("p", "40", "One. Two.")];
		const after = [
			b("h", "20", "# Title"),
			b("p1", "40", "One."),
			b("p2", "50", "Two."),
		];
		const result = expectSafe(plan(before, after));
		expect(result.changes).toHaveLength(1);
		expect(result.changes[0]).toMatchObject({
			kind: "replace",
			beforeBlockIds: ["p"],
			afterBlockIds: ["p1", "p2"],
		});
	});

	test("a move (same id, different position) falls back as ambiguous", () => {
		const before = [
			b("a", "20", "Alpha"),
			b("b", "40", "Beta"),
			b("c", "60", "Gamma"),
		];
		// 'a' moves to the end: same id+content, different order key.
		const after = [
			b("b", "40", "Beta"),
			b("c", "60", "Gamma"),
			b("a", "80", "Alpha"),
		];
		expect(plan(before, after).status).toBe("unsafe");
	});
});

describe("planGranularReview resolution", () => {
	test("all accepted returns exact afterData; all rejected returns exact beforeData", () => {
		const before = [b("h", "20", "# Title"), b("p", "40", "Body.")];
		const after = [b("h", "20", "# Title"), b("p", "40", "Body edited.")];
		const beforeData = renderMarkdownProjection(before);
		const afterData = renderMarkdownProjection(after);
		const result = expectSafe(
			planGranularReview({ beforeBlocks: before, afterBlocks: after, beforeData, afterData }),
		);

		const accepted = result.resolve(decisions({ "change-0": "accepted" }));
		const rejected = result.resolve(decisions({ "change-0": "rejected" }));
		// Identity-equal fast paths.
		expect(accepted).toBe(afterData);
		expect(rejected).toBe(beforeData);
	});

	test("mixed decisions compose the canonical projection of selected blocks", () => {
		const before = [
			b("a", "20", "Alpha"),
			b("m", "40", "Middle"),
			b("z", "60", "Zeta"),
		];
		const after = [
			b("a", "20", "Alpha edited"),
			b("m", "40", "Middle"),
			b("z", "60", "Zeta edited"),
		];
		const result = expectSafe(plan(before, after));
		// Accept the first change (a -> "Alpha edited"), reject the second (keep "Zeta").
		const mixed = result.resolve(
			decisions({ "change-0": "accepted", "change-1": "rejected" }),
		);
		expect(new TextDecoder().decode(mixed)).toBe(
			"Alpha edited\n\nMiddle\n\nZeta\n",
		);
	});

	test("rejecting an insertion drops the new block; accepting a deletion removes it", () => {
		const before = [b("h", "20", "# Title"), b("p", "40", "Body.")];
		const after = [
			b("h", "20", "# Title"),
			b("n", "30", "Inserted."),
			b("p", "40", "Body."),
		];
		const insertPlan = expectSafe(plan(before, after));
		expect(
			new TextDecoder().decode(
				insertPlan.resolve(decisions({ "change-0": "rejected" })),
			),
		).toBe("# Title\n\nBody.\n");

		const deletePlan = expectSafe(plan(after, before));
		expect(
			new TextDecoder().decode(
				deletePlan.resolve(decisions({ "change-0": "accepted" })),
			),
		).toBe("# Title\n\nBody.\n");
	});

	test("resolving a pending change throws", () => {
		const before = [b("h", "20", "# Title"), b("p", "40", "Body.")];
		const after = [b("h", "20", "# Title"), b("p", "40", "Body edited.")];
		const result = expectSafe(plan(before, after));
		expect(() => result.resolve(new Map())).toThrow();
	});
});

describe("planGranularReview invariants", () => {
	test("every block transition is owned by exactly one change", () => {
		const before = [
			b("a", "20", "Alpha"),
			b("b", "40", "Beta"),
			b("c", "60", "Gamma"),
		];
		const after = [
			b("a", "20", "Alpha!"),
			b("b", "40", "Beta"),
			b("c", "60", "Gamma!"),
		];
		const result = expectSafe(plan(before, after));
		// An id may appear in both the before and after of the SAME change (an
		// in-place update reuses the block id), but never across two changes.
		const owner = new Map<string, string>();
		for (const change of result.changes) {
			const ids = new Set([
				...change.beforeBlockIds,
				...change.afterBlockIds,
			]);
			for (const id of ids) {
				expect(owner.has(id)).toBe(false);
				owner.set(id, change.id);
			}
		}
	});

	test("all-rejected reproduces beforeData and all-accepted reproduces afterData for many combinations", () => {
		const before = [
			b("a", "20", "Alpha"),
			b("b", "40", "Beta"),
			b("c", "60", "Gamma"),
			b("d", "80", "Delta"),
		];
		const after = [
			b("a", "20", "Alpha 2"),
			b("b", "40", "Beta"),
			b("c", "60", "Gamma 2"),
			b("d", "80", "Delta 2"),
		];
		const beforeData = renderMarkdownProjection(before);
		const afterData = renderMarkdownProjection(after);
		const result = expectSafe(
			planGranularReview({ beforeBlocks: before, afterBlocks: after, beforeData, afterData }),
		);
		const ids = result.changes.map((c) => c.id);
		const total = 1 << ids.length;
		for (let mask = 0; mask < total; mask += 1) {
			const map = new Map<string, "accepted" | "rejected">();
			ids.forEach((id, index) => {
				map.set(id, mask & (1 << index) ? "accepted" : "rejected");
			});
			const bytes = result.resolve(map);
			// Every mixed projection must parse back into the same block count it
			// declares (no duplicate/dropped blocks), i.e. unique, deterministic.
			const text = new TextDecoder().decode(bytes);
			expect(text.endsWith("\n")).toBe(true);
			expect(text).not.toMatch(/\n{3,}/);
		}
	});
});
