import { describe, expect, test } from "vitest";
import {
	consumeRecentFlashtypeFileWrite,
	hashFileData,
	markFlashtypeFileWrite,
} from "./external-write-tracking";

describe("external write tracking", () => {
	test("hashes equal bytes and text identically", () => {
		const bytes = new TextEncoder().encode("# Hello\n");
		expect(hashFileData(bytes)).toBe(hashFileData("# Hello\n"));
	});

	test("consumes an exact self-write once", () => {
		const fileId = "consume-once";
		const hash = hashFileData("payload");
		markFlashtypeFileWrite(fileId, "payload", 1_000);

		expect(consumeRecentFlashtypeFileWrite(fileId, hash, 1_001)).toBe(true);
		expect(consumeRecentFlashtypeFileWrite(fileId, hash, 1_002)).toBe(false);
	});

	test("never consumes a different hash", () => {
		const fileId = "wrong-hash";
		markFlashtypeFileWrite(fileId, "payload", 1_000);
		expect(consumeRecentFlashtypeFileWrite(fileId, "deadbeef", 1_001)).toBe(
			false,
		);
		// The original is still pending and consumable.
		expect(
			consumeRecentFlashtypeFileWrite(fileId, hashFileData("payload"), 1_002),
		).toBe(true);
	});

	test("does not consume expired writes", () => {
		const fileId = "expired";
		const hash = hashFileData("payload");
		markFlashtypeFileWrite(fileId, "payload", 1_000);
		expect(consumeRecentFlashtypeFileWrite(fileId, hash, 20_000)).toBe(false);
	});

	test("the returned handle cancels the pending self-write", () => {
		const fileId = "cancelable";
		const hash = hashFileData("payload");
		const cancel = markFlashtypeFileWrite(fileId, "payload", 1_000);
		cancel();
		expect(consumeRecentFlashtypeFileWrite(fileId, hash, 1_001)).toBe(false);
	});

	test("canceling is idempotent and only affects its own entry", () => {
		const fileId = "cancel-one";
		const cancelFirst = markFlashtypeFileWrite(fileId, "first", 1_000);
		markFlashtypeFileWrite(fileId, "second", 1_000);
		cancelFirst();
		cancelFirst();

		expect(
			consumeRecentFlashtypeFileWrite(fileId, hashFileData("first"), 1_001),
		).toBe(false);
		expect(
			consumeRecentFlashtypeFileWrite(fileId, hashFileData("second"), 1_001),
		).toBe(true);
	});
});
