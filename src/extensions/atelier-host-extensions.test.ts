import { describe, expect, test, vi } from "vitest";
import { createFlashTypeAtelierExtensions } from "./atelier-host-extensions";

describe("createFlashTypeAtelierExtensions", () => {
	test("registers agent terminals, welcome panel, and History view", () => {
		const extensions = createFlashTypeAtelierExtensions();

		expect(extensions.map((extension) => extension.id)).toEqual([
			"flashtype_claude",
			"flashtype_codex",
			"flashtype_agents",
			"atelier_history",
		]);
	});
});

vi.mock("@opral/atelier", () => ({
	Atelier: { History: () => null },
	ATELIER_BUILTIN_EXTENSION_IDS: { history: "atelier_history" },
}));
