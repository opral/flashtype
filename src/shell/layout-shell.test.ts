import { describe, expect, test } from "vitest";
import { Puzzle } from "lucide-react";
import { hydratePanelForExtensions } from "./layout-shell";
import type {
	ExtensionDefinition,
	PanelState,
} from "../extension-runtime/types";

const installedExtension = {
	kind: "installed_notes",
	label: "Notes",
	description: "Installed notes view",
	icon: Puzzle,
	render: () => {},
} satisfies ExtensionDefinition;

describe("hydratePanelForExtensions", () => {
	test("preserves unknown persisted views before installed extensions load", () => {
		const panel: PanelState = {
			views: [{ instance: "notes-1", kind: installedExtension.kind }],
			activeInstance: "notes-1",
		};

		expect(
			hydratePanelForExtensions(panel, new Map(), {
				preserveUnknownKinds: true,
			}),
		).toEqual(panel);
	});

	test("keeps installed views after their definitions load", () => {
		const panel: PanelState = {
			views: [{ instance: "notes-1", kind: installedExtension.kind }],
			activeInstance: "notes-1",
		};

		expect(
			hydratePanelForExtensions(
				panel,
				new Map([[installedExtension.kind, installedExtension]]),
			),
		).toEqual(panel);
	});

	test("drops stale unknown views after installed extension loading completes", () => {
		const panel: PanelState = {
			views: [{ instance: "missing-1", kind: "missing_extension" }],
			activeInstance: "missing-1",
		};

		expect(hydratePanelForExtensions(panel, new Map())).toEqual({
			views: [],
			activeInstance: null,
		});
	});
});
