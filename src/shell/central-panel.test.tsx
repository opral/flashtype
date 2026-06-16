import { Suspense, act, type ReactNode } from "react";
import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { CentralPanel } from "./central-panel";
import type { PanelState, WidgetContext } from "../widget-runtime/types";
import { openLix } from "@/test-utils/node-lix-sdk";
import { WidgetHostRegistryProvider } from "../widget-runtime/widget-host-registry";

const TEST_SEARCH_WIDGET_KIND = "test_search";

vi.mock("../widget-runtime/widget-registry", () => {
	const definitions = [
		{
			kind: "test_search" as const,
			label: "Search",
			description: "Search view",
			icon: () => <svg></svg>,
			render: ({
				context,
				target,
			}: {
				context: WidgetContext;
				target: HTMLElement;
			}) => {
				const input = document.createElement("input");
				input.setAttribute("data-testid", "search-view-input");
				input.setAttribute("placeholder", "Search project...");
				input.addEventListener("pointerdown", () => {
					context.openWidget?.({
						panel: "central",
						kind: "test_search",
						instance: "search-view",
						focus: false,
					});
				});
				target.replaceChildren(input);
				return () => {
					target.replaceChildren();
				};
			},
		},
	];
	return {
		WIDGET_DEFINITIONS: definitions,
		WIDGET_MAP: new Map(definitions.map((def) => [def.kind, def])),
		useWidgetRegistry: () => ({
			visibleWidgets: definitions,
			widgetMap: new Map(definitions.map((def) => [def.kind, def])),
			installedWidgets: [],
			replaceInstalledWidgets: () => {},
			clearInstalledWidgets: () => {},
		}),
	};
});

let lix: Awaited<ReturnType<typeof openLix>> | null = null;

beforeAll(async () => {
	lix = await openLix();
});

afterAll(async () => {
	await lix?.close();
	lix = null;
});

const renderWithProviders = async (ui: ReactNode) => {
	let result: ReturnType<typeof render> | undefined;
	await act(async () => {
		result = render(
			<WidgetHostRegistryProvider>
				<Suspense fallback={<div data-testid="loading-state" />}>{ui}</Suspense>
			</WidgetHostRegistryProvider>,
		);
	});
	return result!;
};

const createViewContext = (
	overrides: Partial<WidgetContext> = {},
): WidgetContext => ({
	lix:
		lix ??
		(() => {
			throw new Error("Lix instance not initialized");
		})(),
	isPanelFocused: false,
	setTabBadgeCount: () => {},
	...overrides,
});

describe("CentralPanel", () => {
	test("renders the active view without a tab strip", async () => {
		// The central editor hides tabs; files are switched from the left list.
		const panelState: PanelState = {
			views: [{ instance: "search-1", kind: TEST_SEARCH_WIDGET_KIND }],
			activeInstance: "search-1",
		};

		await renderWithProviders(
			<DndContext>
				<CentralPanel
					panel={panelState}
					onSelectWidget={() => {}}
					onRemoveWidget={() => {}}
					viewContext={createViewContext({ isPanelFocused: true })}
					isFocused={true}
					onFocusPanel={vi.fn()}
				/>
			</DndContext>,
		);

		expect(await screen.findByTestId("search-view-input")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
	});

	test("finalizes pending view when interacting with content", async () => {
		const panelState: PanelState = {
			views: [
				{
					instance: "search-1",
					kind: TEST_SEARCH_WIDGET_KIND,
					isPending: true,
				},
			],
			activeInstance: "search-1",
		};
		const handleFinalize = vi.fn();

		await renderWithProviders(
			<DndContext>
				<CentralPanel
					panel={panelState}
					onSelectWidget={() => {}}
					onRemoveWidget={() => {}}
					viewContext={createViewContext({ isPanelFocused: true })}
					isFocused={true}
					onFocusPanel={vi.fn()}
					onFinalizePendingView={handleFinalize}
				/>
			</DndContext>,
		);

		const input = await screen.findByTestId("search-view-input");
		fireEvent.pointerDown(input);

		expect(handleFinalize).toHaveBeenCalledWith("search-1");
	});
});
