import { describe, expect, test } from "vitest";
import { createFlashTypeAtelierExtensions } from "./atelier-host-extensions";

describe("createFlashTypeAtelierExtensions", () => {
	test("registers filesystem, Electron-aware history, and agent terminals", () => {
		const extensions = createFlashTypeAtelierExtensions({
			ephemeral: false,
			path: "/workspace",
			name: "workspace",
		});

		expect(extensions.map((extension) => extension.manifest.id)).toEqual([
			"atelier_files",
			"atelier_history",
			"flashtype_claude",
			"flashtype_codex",
		]);
	});
});
