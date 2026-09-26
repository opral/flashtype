import { expect, test, vi } from "vitest";
import { createMemorySessionStateStore } from "@opral/atelier/state-adapters";
import { createDesktopDocumentCommands } from "./atelier-desktop-commands";
import type { Lix } from "./lix-types";

test("new document skips an existing filename rather than overwriting it", async () => {
	const execute = vi
		.fn()
		.mockResolvedValueOnce({ rows: [] })
		.mockResolvedValueOnce({ rows: [{ id: "new" }] });
	const navigate = vi.fn();
	const commands = createDesktopDocumentCommands({
		lix: { execute } as unknown as Lix,
		store: createMemorySessionStateStore(),
		navigate,
	});
	await commands.startNew();
	expect(execute.mock.calls[0]?.[1]?.[0]).toBe("/Untitled.md");
	expect(navigate).toHaveBeenCalledWith({ path: "/Untitled 1.md" });
});

test("close preserves other areas and selects the remaining tab", async () => {
	const store = createMemorySessionStateStore({
		focusedArea: "main",
		areas: {
			left: {
				views: [{ instance: "files", kind: "atelier_files" }],
				activeInstance: "files",
			},
			right: { views: [], activeInstance: null },
			main: {
				views: [
					{ instance: "a", kind: "markdown" },
					{ instance: "b", kind: "markdown" },
				],
				activeInstance: "b",
			},
		},
	});
	const commands = createDesktopDocumentCommands({
		lix: {} as Lix,
		store,
		navigate: vi.fn(),
	});
	await commands.closeActive();
	expect(store.getSnapshot()?.areas.main.activeInstance).toBe("a");
	expect(store.getSnapshot()?.areas.main.views).toHaveLength(1);
	expect(store.getSnapshot()?.areas.left.activeInstance).toBe("files");
});

test("repeated external open activates a document after an internal tab switch", async () => {
	const store = createMemorySessionStateStore({
		focusedArea: "main",
		areas: {
			left: { views: [], activeInstance: null },
			right: { views: [], activeInstance: null },
			main: {
				views: [
					{ instance: "a", kind: "atelier_file", state: { filePath: "/a.md" } },
					{ instance: "b", kind: "atelier_file", state: { filePath: "/b.md" } },
				],
				activeInstance: "a",
			},
		},
	});
	const navigate = vi.fn();
	const commands = createDesktopDocumentCommands({
		lix: {} as Lix,
		store,
		navigate,
	});
	await commands.open("/a.md");
	const state = store.getSnapshot()!;
	store.setSnapshot({
		...state,
		areas: {
			...state.areas,
			main: { ...state.areas.main, activeInstance: "b" },
		},
	});
	await commands.open("/a.md");
	expect(store.getSnapshot()?.areas.main.activeInstance).toBe("a");
	expect(navigate).toHaveBeenLastCalledWith({ path: "/a.md" });
});
