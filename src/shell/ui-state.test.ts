import { describe, expect, test } from "vitest";
import { FILES_EXTENSION_KIND } from "../extension-runtime/extension-instance-helpers";
import {
	coerceFlashtypeUiState,
	DEFAULT_FLASHTYPE_UI_STATE,
	type FlashtypeUiState,
} from "./ui-state";

describe("coerceFlashtypeUiState", () => {
	test("fresh defaults open Files only", () => {
		const state = coerceFlashtypeUiState(undefined);

		expect(state.panels.left.views.map((view) => view.kind)).toEqual([
			FILES_EXTENSION_KIND,
		]);
		expect(state.panels.left.activeInstance).toBe("files-default");
	});

	test("preserves persisted left panel views without adding History", () => {
		const persistedState: FlashtypeUiState = {
			focusedPanel: "left",
			panels: {
				left: {
					views: [{ instance: "files-left", kind: FILES_EXTENSION_KIND }],
					activeInstance: "files-left",
				},
				central: { views: [], activeInstance: null },
				right: { views: [], activeInstance: null },
			},
			layout: DEFAULT_FLASHTYPE_UI_STATE.layout,
		};

		const coerced = coerceFlashtypeUiState(persistedState);

		expect(coerced.panels.left.views.map((view) => view.kind)).toEqual([
			FILES_EXTENSION_KIND,
		]);
		expect(coerced.panels.left.activeInstance).toBe("files-left");
	});
});
