import { describe, expect, test } from "vitest";
import { createFlashTypeAtelierExtensions } from "./atelier-host-extensions";

describe("createFlashTypeAtelierExtensions", () => {
	test("registers only the agent terminals (Files is atelier's bundled view)", () => {
		const extensions = createFlashTypeAtelierExtensions();

		expect(extensions.map((extension) => extension.manifest.id)).toEqual([
			"flashtype_claude",
			"flashtype_codex",
		]);
	});
});
