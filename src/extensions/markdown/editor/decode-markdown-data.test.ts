import { describe, expect, test } from "vitest";
import { decodeMarkdownData } from "./decode-markdown-data";

describe("decodeMarkdownData", () => {
	test("decodes Uint8Array bytes", () => {
		const value = new TextEncoder().encode("hello");
		expect(decodeMarkdownData(value)).toBe("hello");
	});

	test("decodes hex string values", () => {
		expect(decodeMarkdownData("0x68656c6c6f")).toBe("hello");
	});

	test("decodes canonical text wrapper", () => {
		expect(decodeMarkdownData({ kind: "text", value: "hello" })).toBe("hello");
	});

	test("decodes canonical blob base64 wrapper", () => {
		expect(decodeMarkdownData({ kind: "blob", base64: "aGVsbG8=" })).toBe(
			"hello",
		);
	});

	test("decodes canonical blob value wrapper", () => {
		expect(decodeMarkdownData({ kind: "blob", value: "aGVsbG8=" })).toBe(
			"hello",
		);
	});

	test("decodes empty canonical blob as empty text", () => {
		expect(decodeMarkdownData({ kind: "blob", base64: "" })).toBe("");
	});
});
