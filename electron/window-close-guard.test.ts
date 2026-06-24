import { describe, expect, test } from "vitest";
import { createWindowCloseGuard } from "./window-close-guard.mjs";

describe("createWindowCloseGuard", () => {
	test("prevents the first close and asks the renderer", () => {
		const guard = createWindowCloseGuard();
		expect(guard.handleCloseRequest(1)).toEqual({ allow: false, ask: true });
		expect(guard.isAsking(1)).toBe(true);
	});

	test("ignores re-entrant close requests while asking", () => {
		const guard = createWindowCloseGuard();
		guard.handleCloseRequest(1);
		expect(guard.handleCloseRequest(1)).toEqual({ allow: false, ask: false });
	});

	test("allow decision bypasses the next close exactly once", () => {
		const guard = createWindowCloseGuard();
		guard.handleCloseRequest(1);
		expect(guard.resolveDecision(1, "allow")).toEqual({ closeNow: true });
		expect(guard.isBypassing(1)).toBe(true);
		// The re-issued close now passes through without asking again.
		expect(guard.handleCloseRequest(1)).toEqual({ allow: true, ask: false });
		expect(guard.isBypassing(1)).toBe(false);
		// A subsequent close is guarded again.
		expect(guard.handleCloseRequest(1)).toEqual({ allow: false, ask: true });
	});

	test("cancel decision keeps the window open and re-guards", () => {
		const guard = createWindowCloseGuard();
		guard.handleCloseRequest(1);
		expect(guard.resolveDecision(1, "cancel")).toEqual({ closeNow: false });
		expect(guard.isAsking(1)).toBe(false);
		expect(guard.handleCloseRequest(1)).toEqual({ allow: false, ask: true });
	});

	test("a decision without a pending ask does nothing", () => {
		const guard = createWindowCloseGuard();
		expect(guard.resolveDecision(1, "allow")).toEqual({ closeNow: false });
		expect(guard.isBypassing(1)).toBe(false);
	});

	test("tracks windows independently", () => {
		const guard = createWindowCloseGuard();
		guard.handleCloseRequest(1);
		guard.handleCloseRequest(2);
		guard.resolveDecision(1, "allow");
		expect(guard.handleCloseRequest(1)).toEqual({ allow: true, ask: false });
		// Window 2 is still awaiting its own decision.
		expect(guard.isAsking(2)).toBe(true);
		expect(guard.handleCloseRequest(2)).toEqual({ allow: false, ask: false });
	});

	test("forget clears all state for a window", () => {
		const guard = createWindowCloseGuard();
		guard.handleCloseRequest(1);
		guard.resolveDecision(1, "allow");
		guard.forget(1);
		expect(guard.isAsking(1)).toBe(false);
		expect(guard.isBypassing(1)).toBe(false);
	});
});
