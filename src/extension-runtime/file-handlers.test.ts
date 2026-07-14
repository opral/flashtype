import { describe, expect, test } from "vitest";
import { fileExtensionFromPath, isMarkdownFilePath } from "./file-handlers";

describe("file handlers", () => {
	test("reads literal file extensions without URL decoding", () => {
		expect(fileExtensionFromPath("/docs/readme.MD")).toBe("md");
		expect(fileExtensionFromPath("/docs/readme")).toBeUndefined();
		expect(fileExtensionFromPath("/docs/readme.")).toBeUndefined();
	});

	test("detects supported Markdown paths", () => {
		expect(isMarkdownFilePath("/docs/readme.MD")).toBe(true);
		expect(isMarkdownFilePath("/docs/%6d.md")).toBe(true);
		expect(isMarkdownFilePath("/docs/readme.md%20")).toBe(false);
	});
});
