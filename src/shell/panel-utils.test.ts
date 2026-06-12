import { describe, expect, test } from "vitest";
import { cloneWidgetInstance, reorderPanelWidgetsByIndex } from "./panel-utils";
import type { PanelState, WidgetInstance } from "../widget-runtime/types";
import { FILES_WIDGET_KIND } from "../widget-runtime/widget-instance-helpers";

const TEST_SEARCH_WIDGET_KIND = "test_search";
const TEST_TASKS_WIDGET_KIND = "test_tasks";

describe("cloneViewInstanceByKey", () => {
	test("clones the matched view and its state", () => {
		const originalState = { label: "Files", filePath: "/docs/readme.md" };
		const panelState: PanelState = {
			views: [
				{
					instance: "files-1",
					kind: FILES_WIDGET_KIND,
					isPending: true,
					state: originalState,
				} satisfies WidgetInstance,
			],
			activeInstance: "files-1",
		};

		const cloned = cloneWidgetInstance(panelState, "files-1");

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
					kind: FILES_WIDGET_KIND,
					state: { diff: { query, metadata: { nested: true } } },
					launchArgs: { initial: { path: "/docs" } },
				} satisfies WidgetInstance,
			],
			activeInstance: "files-1",
		};

		const cloned = cloneWidgetInstance(panelState, "files-1");

		expect(cloned).not.toBeNull();
		const clonedState = (cloned as WidgetInstance).state as any;
		const originalState = panelState.views[0].state as any;
		expect(clonedState).not.toBe(originalState);
		expect(clonedState.diff).not.toBe(originalState.diff);
		expect(clonedState.diff.query).toBe(query);
		expect(clonedState.diff.metadata).not.toBe(originalState.diff.metadata);
		const clonedLaunchArgs = (cloned as WidgetInstance).launchArgs as any;
		const originalLaunchArgs = panelState.views[0].launchArgs as any;
		expect(clonedLaunchArgs).not.toBe(originalLaunchArgs);
		expect(clonedLaunchArgs.initial).not.toBe(originalLaunchArgs.initial);
	});

	test("returns null when no matching view is found", () => {
		const panelState: PanelState = { views: [], activeInstance: null };

		const cloned = cloneWidgetInstance(panelState, "missing");

		expect(cloned).toBeNull();
	});
});

describe("panel view reordering", () => {
	const samplePanel: PanelState = {
		views: [
			{ instance: "files-1", kind: FILES_WIDGET_KIND },
			{ instance: "search-1", kind: TEST_SEARCH_WIDGET_KIND },
			{ instance: "tasks-1", kind: TEST_TASKS_WIDGET_KIND },
		],
		activeInstance: "files-1",
	};

	test("reorderPanelWidgetsByIndex moves an item to the requested index", () => {
		const result = reorderPanelWidgetsByIndex(samplePanel, 0, 2);
		expect(result.views.map((entry) => entry.instance)).toEqual([
			"search-1",
			"tasks-1",
			"files-1",
		]);
	});

	test("reorderPanelWidgetsByIndex ignores invalid indices", () => {
		const unchanged = reorderPanelWidgetsByIndex(samplePanel, -1, 2);
		expect(unchanged).toEqual(samplePanel);
	});
});
