import { describe, expect, test } from "vitest";
import {
	keepProposedThenContinue,
	rejectAllThenContinue,
	type KeepProposedOutcome,
	type RejectAllOutcome,
} from "./external-write-review-abandon";

describe("keepProposedThenContinue", () => {
	test("runs the continuation only after the accept resolves", async () => {
		const events: string[] = [];
		let settle: (outcome: KeepProposedOutcome) => void = () => {};
		const accept = () =>
			new Promise<KeepProposedOutcome>((resolve) => {
				settle = (outcome) => {
					events.push("accept-resolved");
					resolve(outcome);
				};
			});
		const pending = keepProposedThenContinue({
			accept,
			continuation: () => events.push("continuation"),
		});

		// The accept is still in flight: the continuation must not have run yet.
		await Promise.resolve();
		expect(events).toEqual([]);

		settle("accepted");
		await expect(pending).resolves.toBe("continued");
		expect(events).toEqual(["accept-resolved", "continuation"]);
	});

	test("a stale accept cancels instead of continuing", async () => {
		const events: string[] = [];
		const result = await keepProposedThenContinue({
			accept: async () => "abandoned",
			continuation: () => events.push("continuation"),
			cancel: () => events.push("cancel"),
		});
		expect(result).toBe("cancelled");
		expect(events).toEqual(["cancel"]);
	});

	test("a no-op accept still continues", async () => {
		const events: string[] = [];
		const result = await keepProposedThenContinue({
			accept: async () => "noop",
			continuation: () => events.push("continuation"),
		});
		expect(result).toBe("continued");
		expect(events).toEqual(["continuation"]);
	});
});

describe("rejectAllThenContinue", () => {
	test("runs the continuation only after the reject resolves", async () => {
		const events: string[] = [];
		let settle: (outcome: RejectAllOutcome) => void = () => {};
		const reject = () =>
			new Promise<RejectAllOutcome>((resolve) => {
				settle = (outcome) => {
					events.push("reject-resolved");
					resolve(outcome);
				};
			});
		const pending = rejectAllThenContinue({
			reject,
			continuation: () => events.push("continuation"),
		});

		await Promise.resolve();
		expect(events).toEqual([]);

		settle("rejected");
		await expect(pending).resolves.toBe("continued");
		expect(events).toEqual(["reject-resolved", "continuation"]);
	});

	test("a stale reject cancels instead of continuing", async () => {
		const events: string[] = [];
		const result = await rejectAllThenContinue({
			reject: async () => "abandoned",
			continuation: () => events.push("continuation"),
			cancel: () => events.push("cancel"),
		});
		expect(result).toBe("cancelled");
		expect(events).toEqual(["cancel"]);
	});

	test("a no-op reject still continues", async () => {
		const events: string[] = [];
		const result = await rejectAllThenContinue({
			reject: async () => "noop",
			continuation: () => events.push("continuation"),
		});
		expect(result).toBe("continued");
		expect(events).toEqual(["continuation"]);
	});
});
