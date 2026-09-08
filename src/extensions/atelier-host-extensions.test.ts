import { describe, expect, test, vi } from "vitest";
import { createFlashTypeAtelierExtensions } from "./atelier-host-extensions";

describe("createFlashTypeAtelierExtensions", () => {
	test("registers agent terminals and the host-composed History view", () => {
		const extensions = createFlashTypeAtelierExtensions();

		expect(extensions.map((extension) => extension.manifest.id)).toEqual([
			"flashtype_claude",
			"flashtype_codex",
			"atelier_history",
		]);
	});
});

vi.mock("@opral/atelier", () => ({
	Atelier: { History: () => null },
	ATELIER_BUILTIN_EXTENSION_IDS: { history: "atelier_history" },
}));
