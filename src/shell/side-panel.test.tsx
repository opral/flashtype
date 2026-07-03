import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { FilesystemEntryRow } from "@/queries";
import { SidePanel } from "./side-panel";
import { ExtensionHostRegistryProvider } from "../extension-runtime/extension-host-registry";
import type { PanelState, ExtensionContext } from "../extension-runtime/types";
import {
	FILES_EXTENSION_KIND,
	FILE_EXTENSION_KIND,
	fileExtensionInstance,
} from "../extension-runtime/extension-instance-helpers";
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

vi.mock("../extension-runtime/extension-registry", async () => {
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
				context: ExtensionContext;
				target: HTMLElement;
			}) => {
				const button = document.createElement("button");
				button.type = "button";
				button.textContent = "writing-style.md";
				button.addEventListener("click", () => {
					context.openExtension?.({
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
		EXTENSION_DEFINITIONS: definitions,
		EXTENSION_MAP: new Map(definitions.map((def) => [def.kind, def])),
		useExtensionRegistry: () => ({
			visibleExtensions: definitions,
			extensionMap: new Map(definitions.map((def) => [def.kind, def])),
			installedExtensions: [],
			replaceInstalledExtensions: () => {},
			clearInstalledExtensions: () => {},
		}),
	};
});

const mockLix = {} as Lix;

const createViewContext = (
	overrides: Partial<ExtensionContext> = {},
): ExtensionContext => ({
	lix: mockLix,
	isPanelFocused: false,
	setTabBadgeCount: () => {},
	...overrides,
});

describe("SidePanel", () => {
	test("renders stable analytics selectors for agent invite CTAs", () => {
		const emptyPanel: PanelState = { views: [], activeInstance: null };

		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<SidePanel
						side="right"
						title="Agent"
						panel={emptyPanel}
						onSelectView={() => {}}
						onAddView={() => {}}
						onRemoveView={() => {}}
						viewContext={createViewContext()}
						isFocused={false}
						onFocusPanel={vi.fn()}
					/>
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		expect(
			screen.getByText("Your agent writes here").closest("[data-attr]"),
		).toHaveAttribute("data-attr", "agent-panel");
		expect(
			screen.getByRole("button", { name: /start claude code/i }),
		).toHaveAttribute("data-attr", "agent-start-claude");
		expect(
			screen.getByRole("button", { name: /use codex instead/i }),
		).toHaveAttribute("data-attr", "agent-start-codex");
	});

	test("renders preferred Codex as the primary agent invite CTA", () => {
		const emptyPanel: PanelState = { views: [], activeInstance: null };

		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<SidePanel
						side="right"
						title="Agent"
						panel={emptyPanel}
						onSelectView={() => {}}
						onAddView={() => {}}
						onRemoveView={() => {}}
						viewContext={createViewContext()}
						isFocused={false}
						onFocusPanel={vi.fn()}
						preferredAgent="codex"
					/>
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		expect(
			screen.getByText("Your agent writes here").closest("[data-attr]"),
		).toHaveAttribute("data-attr", "agent-panel");
		expect(
			screen.getByRole("button", { name: /start codex/i }),
		).toHaveAttribute("data-attr", "agent-start-codex");
		expect(
			screen.getByRole("button", { name: /use claude code instead/i }),
		).toHaveAttribute("data-attr", "agent-start-claude");
	});

	test("renders the empty state helper when nothing is open", () => {
		const emptyPanel: PanelState = { views: [], activeInstance: null };

		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<SidePanel
						side="left"
						title="Navigator"
						panel={emptyPanel}
						onSelectView={() => {}}
						onAddView={() => {}}
						onRemoveView={() => {}}
						viewContext={createViewContext()}
						isFocused={false}
						onFocusPanel={vi.fn()}
					/>
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		expect(screen.getByText("No view open")).toBeInTheDocument();
		expect(screen.getByLabelText("Add view")).toBeInTheDocument();
	});

	test("renders the active view and forwards interactions", async () => {
		const panelState: PanelState = {
			views: [{ instance: "files-1", kind: FILES_EXTENSION_KIND }],
			activeInstance: "files-1",
		};
		const handleSelect = vi.fn();
		const handleAdd = vi.fn();
		const handleRemove = vi.fn();
		const handleOpenFile = vi.fn();
		const viewContext = createViewContext({
			openExtension: handleOpenFile,
			isPanelFocused: true,
		});

		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<SidePanel
						side="left"
						title="Navigator"
						panel={panelState}
						onSelectView={handleSelect}
						onAddView={handleAdd}
						onRemoveView={handleRemove}
						viewContext={viewContext}
						isFocused={true}
						onFocusPanel={vi.fn()}
					/>
				</DndContext>
			</ExtensionHostRegistryProvider>,
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
			kind: FILE_EXTENSION_KIND,
			instance: fileExtensionInstance("file-writing"),
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
			views: [{ instance: "files-1", kind: FILES_EXTENSION_KIND }],
			activeInstance: "files-1",
		};

		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<SidePanel
						side="left"
						title="Navigator"
						panel={panelState}
						onSelectView={() => {}}
						onAddView={() => {}}
						onRemoveView={() => {}}
						viewContext={createViewContext()}
						isFocused={false}
						onFocusPanel={vi.fn()}
					/>
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		const filesTab = await screen.findByRole("button", { name: "Files" });
		expect(filesTab.getAttribute("data-focused")).toBeNull();
	});
});
