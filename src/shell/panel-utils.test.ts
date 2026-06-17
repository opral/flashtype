import { describe, expect, test } from "vitest";
import {
	cloneExtensionInstance,
	reorderPanelExtensionsByIndex,
} from "./panel-utils";
import type { PanelState, ExtensionInstance } from "../extension-runtime/types";
import { FILES_EXTENSION_KIND } from "../extension-runtime/extension-instance-helpers";

const TEST_SEARCH_EXTENSION_KIND = "test_search";
const TEST_TASKS_EXTENSION_KIND = "test_tasks";

describe("cloneViewInstanceByKey", () => {
	test("clones the matched view and its state", () => {
		const originalState = { label: "Files", filePath: "/docs/readme.md" };
		const panelState: PanelState = {
			views: [
				{
					instance: "files-1",
					kind: FILES_EXTENSION_KIND,
					isPending: true,
					state: originalState,
				} satisfies ExtensionInstance,
			],
			activeInstance: "files-1",
		};

		const cloned = cloneExtensionInstance(panelState, "files-1");

		expect(cloned).not.toBeNull();
		expect(cloned).toEqual(panelState.views[0]);
		expect(cloned).not.toBe(panelState.views[0]);
		expect(cloned?.state).not.toBe(originalState);
	});

	test("deep clones nested state and launch args", () => {
		const query = () => null;
		const panelState: PanelState = {
			views: [
				{
					instance: "files-1",
					kind: FILES_EXTENSION_KIND,
					state: { diff: { query, metadata: { nested: true } } },
					launchArgs: { initial: { path: "/docs" } },
				} satisfies ExtensionInstance,
			],
			activeInstance: "files-1",
		};

		const cloned = cloneExtensionInstance(panelState, "files-1");

		expect(cloned).not.toBeNull();
		const clonedState = (cloned as ExtensionInstance).state as any;
		const originalState = panelState.views[0].state as any;
		expect(clonedState).not.toBe(originalState);
		expect(clonedState.diff).not.toBe(originalState.diff);
		expect(clonedState.diff.query).toBe(query);
		expect(clonedState.diff.metadata).not.toBe(originalState.diff.metadata);
		const clonedLaunchArgs = (cloned as ExtensionInstance).launchArgs as any;
		const originalLaunchArgs = panelState.views[0].launchArgs as any;
		expect(clonedLaunchArgs).not.toBe(originalLaunchArgs);
		expect(clonedLaunchArgs.initial).not.toBe(originalLaunchArgs.initial);
	});

	test("returns null when no matching view is found", () => {
		const panelState: PanelState = { views: [], activeInstance: null };

		const cloned = cloneExtensionInstance(panelState, "missing");

		expect(cloned).toBeNull();
	});
});

describe("panel view reordering", () => {
	const samplePanel: PanelState = {
		views: [
			{ instance: "files-1", kind: FILES_EXTENSION_KIND },
			{ instance: "search-1", kind: TEST_SEARCH_EXTENSION_KIND },
			{ instance: "tasks-1", kind: TEST_TASKS_EXTENSION_KIND },
		],
		activeInstance: "files-1",
	};

	test("reorderPanelExtensionsByIndex moves an item to the requested index", () => {
		const result = reorderPanelExtensionsByIndex(samplePanel, 0, 2);
		expect(result.views.map((entry) => entry.instance)).toEqual([
			"search-1",
			"tasks-1",
			"files-1",
		]);
	});

	test("reorderPanelExtensionsByIndex ignores invalid indices", () => {
		const unchanged = reorderPanelExtensionsByIndex(samplePanel, -1, 2);
		expect(unchanged).toEqual(samplePanel);
	});
});
