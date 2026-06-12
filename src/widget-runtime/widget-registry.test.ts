import { describe, expect, test } from "vitest";
import { Puzzle } from "lucide-react";
import { findFileHandlerWidget, normalizeFileExtensions } from "./file-handlers";
import type { WidgetDefinition } from "./types";

const baseWidget = {
	label: "Widget",
	description: "Widget",
	icon: Puzzle,
	render: () => {},
} satisfies Omit<WidgetDefinition, "kind">;

describe("findFileHandlerWidget", () => {
	test("returns the first widget that declares the file extension", () => {
		const markdown = {
			...baseWidget,
			kind: "markdown",
			fileExtensions: ["md", "markdown"],
		};
		const csv = {
			...baseWidget,
			kind: "csv",
			fileExtensions: ["csv"],
		};

		expect(findFileHandlerWidget([markdown, csv], "/data.CSV")).toBe(csv);
	});

	test("normalizes extension declarations before matching", () => {
		const csv = {
			...baseWidget,
			kind: "csv",
			fileExtensions: [" .CSV "],
		};

		expect(findFileHandlerWidget([csv], "/data.csv")).toBe(csv);
		expect(normalizeFileExtensions([" .CSV ", ".tsv", " "])).toEqual([
			"csv",
			"tsv",
		]);
	});

	test("returns undefined when no widget handles the extension", () => {
		const markdown = {
			...baseWidget,
			kind: "markdown",
			fileExtensions: ["md"],
		};

		expect(findFileHandlerWidget([markdown], "/data.txt")).toBeUndefined();
	});
});
