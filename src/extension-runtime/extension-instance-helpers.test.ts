import { describe, expect, test } from "vitest";
import type { ExtensionInstance } from "./types";
import {
	FILE_EXTENSION_KIND,
	activeMarkdownFileIdFromExtensionInstance,
	diffLabelFromPath,
	fileLabelFromPath,
} from "./extension-instance-helpers";

describe("activeMarkdownFileIdFromExtensionInstance", () => {
	test("returns the file id for markdown file extensions", () => {
		const entry: ExtensionInstance = {
			instance: "file-extension:file_md",
			kind: FILE_EXTENSION_KIND,
			state: {
				fileId: "file_md",
				filePath: "/notes/readme.md",
			},
		};

		expect(activeMarkdownFileIdFromExtensionInstance(entry)).toBe("file_md");
	});

	test("does not return an id for non-markdown file extensions", () => {
		const entry: ExtensionInstance = {
			instance: "file-extension:file_csv",
			kind: FILE_EXTENSION_KIND,
			state: {
				fileId: "file_csv",
				filePath: "/data.csv",
			},
		};

		expect(activeMarkdownFileIdFromExtensionInstance(entry)).toBeNull();
	});

	test("fails closed when the file path is missing", () => {
		const entry: ExtensionInstance = {
			instance: "file-extension:file_unknown",
			kind: FILE_EXTENSION_KIND,
			state: {
				fileId: "file_unknown",
			},
		};

		expect(activeMarkdownFileIdFromExtensionInstance(entry)).toBeNull();
	});

	test("derives labels from literal path text", () => {
		expect(diffLabelFromPath("/docs/%61.md")).toBe("%61.md");
		expect(fileLabelFromPath("/docs/%61.md")).toBe("%61.md");
	});
});
