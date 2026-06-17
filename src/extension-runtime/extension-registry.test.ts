import { describe, expect, test } from "vitest";
import { Puzzle } from "lucide-react";
import {
	findFileHandlerExtension,
	isMarkdownFilePath,
	normalizeFileExtensions,
} from "./file-handlers";
import type { ExtensionDefinition } from "./types";

const baseExtension = {
	label: "Extension",
	description: "Extension",
	icon: Puzzle,
	render: () => {},
} satisfies Omit<ExtensionDefinition, "kind">;

describe("findFileHandlerExtension", () => {
	test("returns the first extension that declares the file extension", () => {
		const markdown = {
			...baseExtension,
			kind: "markdown",
			fileExtensions: ["md", "markdown"],
		};
		const csv = {
			...baseExtension,
			kind: "csv",
			fileExtensions: ["csv"],
		};

		expect(findFileHandlerExtension([markdown, csv], "/data.CSV")).toBe(csv);
	});

	test("normalizes extension declarations before matching", () => {
		const csv = {
			...baseExtension,
			kind: "csv",
			fileExtensions: [" .CSV "],
		};

		expect(findFileHandlerExtension([csv], "/data.csv")).toBe(csv);
		expect(normalizeFileExtensions([" .CSV ", ".tsv", " "])).toEqual([
			"csv",
			"tsv",
		]);
	});

	test("returns undefined when no extension handles the extension", () => {
		const markdown = {
			...baseExtension,
			kind: "markdown",
			fileExtensions: ["md"],
		};

		expect(findFileHandlerExtension([markdown], "/data.txt")).toBeUndefined();
	});

	test("detects markdown extensions from literal path text", () => {
		expect(isMarkdownFilePath("/docs/readme.MD")).toBe(true);
		expect(isMarkdownFilePath("/docs/%6d.md")).toBe(true);
		expect(isMarkdownFilePath("/docs/readme.md%20")).toBe(false);
	});
});
