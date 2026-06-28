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

	describe("app-quit coordination", () => {
		test("first confirmation enters the confirming phase without proceeding", () => {
			const guard = createWindowCloseGuard();
			expect(guard.beginQuitConfirmation()).toEqual({
				proceed: false,
				alreadyConfirming: false,
			});
			expect(guard.isConfirmingQuit()).toBe(true);
			expect(guard.isQuitConfirmed()).toBe(false);
		});

		test("a re-entrant confirmation reports alreadyConfirming", () => {
			const guard = createWindowCloseGuard();
			guard.beginQuitConfirmation();
			expect(guard.beginQuitConfirmation()).toEqual({
				proceed: false,
				alreadyConfirming: true,
			});
		});

		test("after confirmQuit, the next quit pass proceeds to teardown", () => {
			const guard = createWindowCloseGuard();
			guard.beginQuitConfirmation();
			guard.confirmQuit();
			expect(guard.isQuitConfirmed()).toBe(true);
			expect(guard.beginQuitConfirmation()).toEqual({
				proceed: true,
				alreadyConfirming: false,
			});
		});

		test("a confirmed quit lets window closes bypass the guard", () => {
			const guard = createWindowCloseGuard();
			guard.confirmQuit();
			expect(guard.isQuitConfirmed()).toBe(true);
		});

		test("cancelQuit returns to idle so the quit can be re-attempted", () => {
			const guard = createWindowCloseGuard();
			guard.beginQuitConfirmation();
			guard.cancelQuit();
			expect(guard.isConfirmingQuit()).toBe(false);
			expect(guard.isQuitConfirmed()).toBe(false);
			// A fresh quit attempt starts a brand new confirmation.
			expect(guard.beginQuitConfirmation()).toEqual({
				proceed: false,
				alreadyConfirming: false,
			});
		});
	});
});
