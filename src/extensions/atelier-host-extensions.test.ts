import { describe, expect, test } from "vitest";
import { createFlashTypeAtelierExtensions } from "./atelier-host-extensions";

describe("createFlashTypeAtelierExtensions", () => {
	test("registers filesystem and agent terminals", () => {
		const extensions = createFlashTypeAtelierExtensions({
			ephemeral: false,
			path: "/workspace",
			name: "workspace",
		});

		expect(extensions.map((extension) => extension.manifest.id)).toEqual([
			"atelier_files",
			"flashtype_claude",
			"flashtype_codex",
		]);
	});
});
