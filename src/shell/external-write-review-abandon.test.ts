import { describe, expect, test } from "vitest";
import {
	keepProposedThenContinue,
	type KeepProposedOutcome,
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
