import { describe, expect, test } from "vitest";
import type { ExtensionInstance } from "./types";
import {
	CSV_EXTENSION_KIND,
	FILE_EXTENSION_KIND,
	activeFileIdFromExtensionInstance,
	fileNameFromPath,
	fileLabelFromPath,
} from "./extension-instance-helpers";

describe("activeFileIdFromExtensionInstance", () => {
	test("returns the file id for document views", () => {
		const entry: ExtensionInstance = {
			instance: `${FILE_EXTENSION_KIND}:file_md`,
			kind: FILE_EXTENSION_KIND,
			state: {
				fileId: "file_md",
				filePath: "/notes/readme.md",
			},
		};

		expect(activeFileIdFromExtensionInstance(entry)).toBe("file_md");
	});

	test("returns the file id for non-markdown document views", () => {
		const entry: ExtensionInstance = {
			instance: `${CSV_EXTENSION_KIND}:file_csv`,
			kind: CSV_EXTENSION_KIND,
			state: {
				fileId: "file_csv",
				filePath: "/data.csv",
			},
		};

		expect(activeFileIdFromExtensionInstance(entry)).toBe("file_csv");
	});

	test("returns the file id when the file path is missing", () => {
		const entry: ExtensionInstance = {
			instance: `${FILE_EXTENSION_KIND}:file_unknown`,
			kind: FILE_EXTENSION_KIND,
			state: {
				fileId: "file_unknown",
			},
		};

		expect(activeFileIdFromExtensionInstance(entry)).toBe("file_unknown");
	});

	test("fails closed when the instance is not keyed by file id", () => {
		const entry: ExtensionInstance = {
			instance: "some-panel-view",
			kind: FILE_EXTENSION_KIND,
			state: {
				fileId: "file_unknown",
			},
		};

		expect(activeFileIdFromExtensionInstance(entry)).toBeNull();
	});

	test("derives labels from literal path text", () => {
		expect(fileNameFromPath("/docs/%61.md")).toBe("%61.md");
		expect(fileLabelFromPath("/docs/%61.md")).toBe("%61.md");
	});
});
