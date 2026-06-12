import { describe, expect, test } from "vitest";
import type { WidgetInstance } from "./types";
import {
	FILE_WIDGET_KIND,
	activeMarkdownFileIdFromWidgetInstance,
} from "./widget-instance-helpers";

describe("activeMarkdownFileIdFromWidgetInstance", () => {
	test("returns the file id for markdown file widgets", () => {
		const entry: WidgetInstance = {
			instance: "file-widget:file_md",
			kind: FILE_WIDGET_KIND,
			state: {
				fileId: "file_md",
				filePath: "/notes/readme.md",
			},
		};

		expect(activeMarkdownFileIdFromWidgetInstance(entry)).toBe("file_md");
	});

	test("does not return an id for non-markdown file widgets", () => {
		const entry: WidgetInstance = {
			instance: "file-widget:file_csv",
			kind: FILE_WIDGET_KIND,
			state: {
				fileId: "file_csv",
				filePath: "/data.csv",
			},
		};

		expect(activeMarkdownFileIdFromWidgetInstance(entry)).toBeNull();
	});

	test("fails closed when the file path is missing", () => {
		const entry: WidgetInstance = {
			instance: "file-widget:file_unknown",
			kind: FILE_WIDGET_KIND,
			state: {
				fileId: "file_unknown",
			},
		};

		expect(activeMarkdownFileIdFromWidgetInstance(entry)).toBeNull();
	});
});
