import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { FilesystemEntryRow } from "@/queries";
import { SidePanel } from "./side-panel";
import { WidgetHostRegistryProvider } from "../widget-runtime/widget-host-registry";
import type { PanelState, WidgetContext } from "../widget-runtime/types";
import {
	FILES_WIDGET_KIND,
	FILE_WIDGET_KIND,
	fileWidgetInstance,
} from "../widget-runtime/widget-instance-helpers";
import type { Lix } from "@/lib/lix-types";

const mockEntries: FilesystemEntryRow[] = [
	{
		id: "dir_root",
		parent_id: null,
		path: "/",
		display_name: "/",
		kind: "directory",
	},
	{
		id: "dir_docs",
		parent_id: "dir_root",
		path: "/docs/",
		display_name: "docs",
		kind: "directory",
	},
	{
		id: "dir_guides",
		parent_id: "dir_docs",
		path: "/docs/guides/",
		display_name: "guides",
		kind: "directory",
	},
	{
		id: "file_writing",
		parent_id: "dir_guides",
		path: "/docs/guides/writing-style.md",
		display_name: "writing-style.md",
		kind: "file",
	},
	{
		id: "file_readme",
		parent_id: "dir_docs",
		path: "/docs/README.md",
		display_name: "README.md",
		kind: "file",
	},
];

vi.mock("@/lib/lix-react", async () => {
	const actual =
		await vi.importActual<typeof import("@/lib/lix-react")>("@/lib/lix-react");
	return {
		...actual,
		useQuery: () => mockEntries,
		useLix: () => ({}) as any,
	};
});

vi.mock("../widget-runtime/widget-registry", async () => {
	const definitions = [
		{
			kind: "flashtype_files" as const,
			label: "Files",
			description: "Files view",
			icon: () => <svg></svg>,
			render: ({
				context,
				target,
			}: {
				context: WidgetContext;
				target: HTMLElement;
			}) => {
				const button = document.createElement("button");
				button.type = "button";
				button.textContent = "writing-style.md";
				button.addEventListener("click", () => {
					context.openWidget?.({
						panel: "central",
						kind: "flashtype_file",
						instance: "flashtype_file:file-writing",
						state: {
							fileId: "file-writing",
							filePath: "/docs/guides/writing-style.md",
							flashtype: { label: "writing-style.md" },
						},
						focus: false,
					});
				});
				target.replaceChildren(button);
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

const mockLix = {} as Lix;

const createViewContext = (
	overrides: Partial<WidgetContext> = {},
): WidgetContext => ({
	lix: mockLix,
	isPanelFocused: false,
	setTabBadgeCount: () => {},
	...overrides,
});

describe("SidePanel", () => {
	test("renders the empty state helper when nothing is open", () => {
		const emptyPanel: PanelState = { views: [], activeInstance: null };

		render(
			<WidgetHostRegistryProvider>
				<DndContext>
					<SidePanel
						side="left"
						title="Navigator"
						panel={emptyPanel}
						onSelectWidget={() => {}}
						onAddView={() => {}}
						onRemoveWidget={() => {}}
						viewContext={createViewContext()}
						isFocused={false}
						onFocusPanel={vi.fn()}
					/>
				</DndContext>
			</WidgetHostRegistryProvider>,
		);

		expect(screen.getByText("No view open")).toBeInTheDocument();
		expect(screen.getByLabelText("Add view")).toBeInTheDocument();
	});

	test("renders the active view and forwards interactions", async () => {
		const panelState: PanelState = {
			views: [{ instance: "files-1", kind: FILES_WIDGET_KIND }],
			activeInstance: "files-1",
		};
		const handleSelect = vi.fn();
		const handleAdd = vi.fn();
		const handleRemove = vi.fn();
		const handleOpenFile = vi.fn();
		const viewContext = createViewContext({
			openWidget: handleOpenFile,
			isPanelFocused: true,
		});

		render(
			<WidgetHostRegistryProvider>
				<DndContext>
					<SidePanel
						side="left"
						title="Navigator"
						panel={panelState}
						onSelectWidget={handleSelect}
						onAddView={handleAdd}
						onRemoveWidget={handleRemove}
						viewContext={viewContext}
						isFocused={true}
						onFocusPanel={vi.fn()}
					/>
				</DndContext>
			</WidgetHostRegistryProvider>,
		);

		const filesTab = await screen.findByRole("button", { name: "Files" });

		fireEvent.click(filesTab);
		expect(handleSelect).toHaveBeenCalledWith("files-1");

		expect(filesTab.getAttribute("data-focused")).toBe("true");

		const fileRow = await screen.findByRole(
			"button",
			{ name: "writing-style.md" },
			{ timeout: 5000 },
		);
		fireEvent.click(fileRow);
		expect(handleOpenFile).toHaveBeenCalledWith({
			panel: "central",
			kind: FILE_WIDGET_KIND,
			instance: fileWidgetInstance("file-writing"),
			state: {
				fileId: "file-writing",
				filePath: "/docs/guides/writing-style.md",
				flashtype: { label: "writing-style.md" },
			},
			focus: false,
		});
	});

	test("removes focus flag when panel not focused", async () => {
		const panelState: PanelState = {
			views: [{ instance: "files-1", kind: FILES_WIDGET_KIND }],
			activeInstance: "files-1",
		};

		render(
			<WidgetHostRegistryProvider>
				<DndContext>
					<SidePanel
						side="left"
						title="Navigator"
						panel={panelState}
						onSelectWidget={() => {}}
						onAddView={() => {}}
						onRemoveWidget={() => {}}
						viewContext={createViewContext()}
						isFocused={false}
						onFocusPanel={vi.fn()}
					/>
				</DndContext>
			</WidgetHostRegistryProvider>,
		);

		const filesTab = await screen.findByRole("button", { name: "Files" });
		expect(filesTab.getAttribute("data-focused")).toBeNull();
	});
});
