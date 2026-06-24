import { describe, expect, test } from "vitest";
import {
	createReviewGuardRegistry,
	type ReviewGuard,
} from "./external-write-review-guard";

function guard(
	reviewId: string,
	hasPendingDecisions: () => boolean,
): ReviewGuard {
	return { reviewId, fileId: `file-${reviewId}`, hasPendingDecisions };
}

describe("createReviewGuardRegistry", () => {
	test("reports no pending decisions when empty", () => {
		const registry = createReviewGuardRegistry();
		expect(registry.hasPendingDecisions()).toBe(false);
		expect(registry.pendingGuard()).toBeNull();
	});

	test("surfaces a guard only while it reports pending decisions", () => {
		const registry = createReviewGuardRegistry();
		let pending = false;
		registry.register(guard("r1", () => pending));
		expect(registry.hasPendingDecisions()).toBe(false);
		pending = true;
		expect(registry.hasPendingDecisions()).toBe(true);
		expect(registry.pendingGuard()?.reviewId).toBe("r1");
	});

	test("unregister removes the guard", () => {
		const registry = createReviewGuardRegistry();
		const unregister = registry.register(guard("r1", () => true));
		expect(registry.hasPendingDecisions()).toBe(true);
		unregister();
		expect(registry.hasPendingDecisions()).toBe(false);
	});

	test("returns the first guard with pending decisions", () => {
		const registry = createReviewGuardRegistry();
		registry.register(guard("clean", () => false));
		registry.register(guard("dirty", () => true));
		expect(registry.pendingGuard()?.reviewId).toBe("dirty");
	});
});
