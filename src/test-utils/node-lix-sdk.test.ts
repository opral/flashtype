import { expect, test } from "vitest";
import { openLix } from "./node-lix-sdk";

test("observe returns the current result snapshot until next is called", async () => {
	const lix = await openLix({
		keyValues: [
			{
				key: "observe_current_snapshot",
				value: "current",
			},
		],
	});

	const events = lix.observe("SELECT value FROM lix_key_value WHERE key = $1", [
		"observe_current_snapshot",
	]);

	try {
		await new Promise((resolve) => setTimeout(resolve, 100));
		const event = await withTimeout(events.next(), 2_000);

		expect(event?.result.columns).toEqual(["value"]);
		expect(event?.result.rows.map((row) => [row["value"]])).toEqual([
			["current"],
		]);
	} finally {
		events.close();
		await lix.close();
	}
});

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) => {
			setTimeout(
				() => reject(new Error("timed out waiting for observe event")),
				ms,
			);
		}),
	]);
}
