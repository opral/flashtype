import { describe, expect, test } from "vitest";
import {
	consumeRecentFlashtypeMarkdownWrite,
	hashMarkdownData,
	markFlashtypeMarkdownWrite,
} from "./external-write-tracking";

describe("external markdown write tracking", () => {
	test("hashes decoded markdown data consistently", () => {
		const bytes = new TextEncoder().encode("# Hello\n");
		expect(hashMarkdownData(bytes)).toBe(hashMarkdownData("# Hello\n"));
	});

	test("consumes a recent Flashtype write once", () => {
		const fileId = "markdown-self-write-once";
		const hash = hashMarkdownData("hello");
		markFlashtypeMarkdownWrite(fileId, "hello", 1_000);

		expect(consumeRecentFlashtypeMarkdownWrite(fileId, hash, 1_001)).toBe(true);
		expect(consumeRecentFlashtypeMarkdownWrite(fileId, hash, 1_002)).toBe(
			false,
		);
	});

	test("does not consume expired Flashtype writes", () => {
		const fileId = "markdown-self-write-expired";
		const hash = hashMarkdownData("hello");
		markFlashtypeMarkdownWrite(fileId, "hello", 1_000);

		expect(consumeRecentFlashtypeMarkdownWrite(fileId, hash, 12_000)).toBe(
			false,
		);
	});
});
