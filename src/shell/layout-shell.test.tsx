import { Suspense, act } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { KeyValueProvider } from "@/hooks/key-value/use-key-value";
import { KEY_VALUE_DEFINITIONS } from "@/hooks/key-value/schema";
import { openLix } from "@/test-utils/node-lix-sdk";
import { qb } from "@/lib/lix-kysely";
import {
	FILE_EXTENSION_KIND,
	FILES_EXTENSION_KIND,
	fileExtensionInstanceForKind,
} from "@/extension-runtime/extension-instance-helpers";
import type { WorkspaceContext } from "@/extension-runtime/types";
import { resolveLixFileForOpen, V2LayoutShell } from "./layout-shell";
import type { FlashtypeUiState } from "./ui-state";
import type { Lix } from "@/lib/lix-types";

type DesktopMock = {
	readonly emitCloseFile: () => Promise<void>;
	readonly emitNewFile: () => Promise<void>;
	readonly onCloseFile: ReturnType<typeof vi.fn>;
	readonly onNewFile: ReturnType<typeof vi.fn>;
	readonly setActiveFilePath: ReturnType<typeof vi.fn>;
	readonly setOpenFilePaths: ReturnType<typeof vi.fn>;
};

type AgentHooksDesktopMock = {
	readonly emitTurnEvent: (event: AgentHookTurnEventInput) => Promise<unknown>;
	readonly onTurnEvent: ReturnType<typeof vi.fn>;
	readonly setActiveFilePath: ReturnType<typeof vi.fn>;
};

type AgentHookTurnEventInput = {
	readonly id: string;
	readonly instanceId?: string;
	readonly agent: "claude" | "codex";
	readonly phase: "turn-start" | "turn-stop";
	readonly sessionId?: string;
	readonly turnId?: string;
	readonly cwd?: string;
	readonly createdAt: number;
};

const originalDesktop = window.flashtypeDesktop;

function queryFileTreeHosts(container: HTMLElement): NodeListOf<HTMLElement> {
	return container.querySelectorAll<HTMLElement>("file-tree-container");
}

function queryFilesViewRenameInputs(
	container: HTMLElement,
): HTMLInputElement[] {
	const inputs: HTMLInputElement[] = [];
	for (const host of queryFileTreeHosts(container)) {
		const input = host.shadowRoot?.querySelector("[data-item-rename-input]");
		if (input instanceof HTMLInputElement) inputs.push(input);
	}
	return inputs;
}

function queryFilesViewRenameInput(
	container: HTMLElement,
): HTMLInputElement | null {
	return queryFilesViewRenameInputs(container)[0] ?? null;
}

function queryFilesViewTreeItemByPath(
	container: HTMLElement,
	path: string,
): HTMLElement | null {
	for (const host of queryFileTreeHosts(container)) {
		const item = host.shadowRoot?.querySelector(
			`[data-type='item'][data-item-path='${CSS.escape(path)}']`,
		);
		if (item instanceof HTMLElement) return item;
	}
	return null;
}

async function findFilesViewRenameInput(
	container: HTMLElement,
): Promise<HTMLInputElement> {
	return waitFor(() => {
		const input = queryFilesViewRenameInput(container);
		if (!input) {
			throw new Error("file tree rename input not found");
		}
		return input;
	});
}

function getFileTreeHostForShadowElement(
	container: HTMLElement,
	element: Element,
): HTMLElement {
	for (const host of queryFileTreeHosts(container)) {
		if (host.shadowRoot?.contains(element)) return host;
	}
	throw new Error("file tree host for shadow element not found");
}

afterEach(() => {
	cleanup();
	window.flashtypeDesktop = originalDesktop;
});

describe("resolveLixFileForOpen", () => {
	test("uses the existing Lix row for normalized file paths", async () => {
		const lix = await openLix();
		const importFilesystemPaths = vi.spyOn(lix, "importFilesystemPaths");
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "real_file",
				path: "/docs/readme.md",
				data: new TextEncoder().encode("Lix content"),
			})
			.execute();

		const resolved = await resolveLixFileForOpen({
			lix,
			workspace: ephemeralWorkspace(),
			filePath: "docs/./readme.md",
		});

		expect(resolved).toEqual({ id: "real_file", path: "/docs/readme.md" });
		expect(importFilesystemPaths).not.toHaveBeenCalled();
		await lix.close();
	});

	test("preserves backslashes as filename characters in Lix paths", async () => {
		const lix = await openLix();
		const importFilesystemPaths = vi.spyOn(lix, "importFilesystemPaths");
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "backslash_file",
				path: "/erjtyjtyr\\treytj.md",
				data: new TextEncoder().encode("Lix content"),
			})
			.execute();

		const resolved = await resolveLixFileForOpen({
			lix,
			workspace: ephemeralWorkspace(),
			filePath: "/erjtyjtyr\\treytj.md",
		});

		expect(resolved).toEqual({
			id: "backslash_file",
			path: "/erjtyjtyr\\treytj.md",
		});
		expect(importFilesystemPaths).not.toHaveBeenCalled();
		await lix.close();
	});

	test("preserves surrounding whitespace in Lix path segments", async () => {
		const lix = await openLix();
		const importFilesystemPaths = vi.spyOn(lix, "importFilesystemPaths");
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "spaced_file",
				path: "/ notes.md ",
				data: new TextEncoder().encode("Lix content"),
			})
			.execute();

		const resolved = await resolveLixFileForOpen({
			lix,
			workspace: ephemeralWorkspace(),
			filePath: "/ notes.md ",
		});

		expect(resolved).toEqual({
			id: "spaced_file",
			path: "/ notes.md ",
		});
		expect(importFilesystemPaths).not.toHaveBeenCalled();
		await lix.close();
	});

	test("imports an ephemeral disk file and returns the inserted Lix id", async () => {
		const lix = await openLix();
		const importFilesystemPaths = vi
			.spyOn(lix, "importFilesystemPaths")
			.mockImplementation(async ([path]) => {
				await qb(lix)
					.insertInto("lix_file")
					.values({
						path,
						data: new TextEncoder().encode("# Imported"),
					})
					.execute();
			});

		const resolved = await resolveLixFileForOpen({
			lix,
			workspace: ephemeralWorkspace(),
			filePath: "/notes.md",
		});

		expect(importFilesystemPaths).toHaveBeenCalledWith(["/notes.md"]);
		expect(resolved?.path).toBe("/notes.md");
		expect(resolved?.id).toBeTruthy();
		const row = await qb(lix)
			.selectFrom("lix_file")
			.select(["id", "path", "data"])
			.where("path", "=", "/notes.md")
			.executeTakeFirstOrThrow();
		expect(row.id).toBe(resolved?.id);
		expect(new TextDecoder().decode(row.data as Uint8Array)).toBe("# Imported");
		await lix.close();
	});

	test("does not overwrite a Lix row created while importing", async () => {
		const lix = await openLix();
		vi.spyOn(lix, "importFilesystemPaths").mockImplementation(async () => {
			await qb(lix)
				.insertInto("lix_file")
				.values({
					id: "raced_file",
					path: "/race.md",
					data: new TextEncoder().encode("Existing Lix data"),
				})
				.execute();
		});

		const resolved = await resolveLixFileForOpen({
			lix,
			workspace: ephemeralWorkspace(),
			filePath: "/race.md",
		});

		expect(resolved).toEqual({ id: "raced_file", path: "/race.md" });
		const row = await qb(lix)
			.selectFrom("lix_file")
			.select(["data"])
			.where("path", "=", "/race.md")
			.executeTakeFirstOrThrow();
		expect(new TextDecoder().decode(row.data as Uint8Array)).toBe(
			"Existing Lix data",
		);
		await lix.close();
	});

	test("refuses files that cannot be found or imported", async () => {
		const lix = await openLix();
		const importFilesystemPaths = vi
			.spyOn(lix, "importFilesystemPaths")
			.mockResolvedValue();

		await expect(
			resolveLixFileForOpen({
				lix,
				workspace: {
					ephemeral: false,
					path: "/workspace/.lix",
					name: "workspace",
				},
				filePath: "/missing.md",
			}),
		).resolves.toBeNull();
		expect(importFilesystemPaths).not.toHaveBeenCalled();

		await expect(
			resolveLixFileForOpen({
				lix,
				workspace: ephemeralWorkspace(),
				filePath: "/missing.md",
			}),
		).resolves.toBeNull();
		expect(importFilesystemPaths).toHaveBeenCalledWith(["/missing.md"]);
		await lix.close();
	});
});

describe("V2LayoutShell branch status", () => {
	test("renders enabled branch UI without an explicit workspace context", async () => {
		const lix = await openLix();
		const utils = await renderShell(lix);

		const trigger = await screen.findByRole("button", {
			name: "Select branch",
		});
		expect(trigger).toBeEnabled();
		expect(trigger).toHaveTextContent("main");
		expect(trigger).not.toHaveAttribute(
			"data-attr",
			"branch-switcher-disabled",
		);

		await unmountShell(utils);
		await lix.close();
	});

	test("renders enabled branch UI for persistent workspaces", async () => {
		const lix = await openLix();
		const utils = await renderShell(lix, {
			workspace: persistentWorkspace(),
		});

		const trigger = await screen.findByRole("button", {
			name: "Select branch",
		});
		expect(trigger).toBeEnabled();
		expect(trigger).toHaveTextContent("main");
		expect(trigger).not.toHaveAttribute(
			"data-attr",
			"branch-switcher-disabled",
		);

		await unmountShell(utils);
		await lix.close();
	});

	test("renders disabled branch UI for ephemeral workspaces", async () => {
		const lix = await openLix();
		const utils = await renderShell(lix, {
			workspace: ephemeralWorkspace(),
		});

		const trigger = await screen.findByRole("button", {
			name: "Select branch",
		});
		expect(trigger).toBeDisabled();
		expect(trigger).toHaveTextContent("No branch");
		expect(trigger).toHaveAttribute("data-attr", "branch-switcher-disabled");

		await unmountShell(utils);
		await lix.close();
	});
});

describe("V2LayoutShell native New File", () => {
	test("routes to the active FilesView draft before creating directly", async () => {
		const desktop = installDesktopMock();
		const lix = await openLix();

		const utils = await renderShell(lix);
		await screen.findByRole("button", { name: "New file" });
		await waitFor(() => expect(desktop.onNewFile).toHaveBeenCalled());

		await act(async () => {
			await desktop.emitNewFile();
		});

		const input = await findFilesViewRenameInput(utils.container);
		const inputHost = getFileTreeHostForShadowElement(utils.container, input);
		await waitFor(() =>
			expect(inputHost.shadowRoot?.activeElement).toBe(input),
		);
		expect(input.value).toBe("new-file");
		await expect(findFilePath(lix, "/new-file.md")).resolves.toBeUndefined();

		utils.unmount();
		await lix.close();
	});

	test("prefers the focused panel when more than one FilesView is active", async () => {
		const desktop = installDesktopMock();
		const lix = await openLix({
			keyValues: [uiStateKeyValue(twoFilesViewsState())],
		});

		const utils = await renderShell(lix);
		await waitFor(() => {
			expect(screen.getAllByRole("button", { name: "New file" })).toHaveLength(
				2,
			);
		});
		await waitFor(() => expect(desktop.onNewFile).toHaveBeenCalled());

		await act(async () => {
			await desktop.emitNewFile();
		});

		const input = await findFilesViewRenameInput(utils.container);
		const inputHost = getFileTreeHostForShadowElement(utils.container, input);
		const remainingButton = screen.getByRole("button", { name: "New file" });
		expect(
			remainingButton.compareDocumentPosition(inputHost) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(queryFilesViewRenameInputs(utils.container)).toHaveLength(1);

		utils.unmount();
		await lix.close();
	});

	test("falls back to direct file creation when no FilesView is active", async () => {
		const desktop = installDesktopMock();
		const lix = await openLix({
			keyValues: [uiStateKeyValue(noFilesViewState())],
		});

		const utils = await renderShell(lix);
		await screen.findByTestId("central-panel-empty-state");
		await waitFor(() => expect(desktop.onNewFile).toHaveBeenCalled());

		await act(async () => {
			await desktop.emitNewFile();
		});

		await expectNewFileCreatedAndOpened(lix);
		expect(queryFilesViewRenameInput(utils.container)).toBeNull();

		utils.unmount();
		await lix.close();
	});

	test("falls back to direct file creation when the active FilesView is collapsed", async () => {
		const desktop = installDesktopMock();
		const lix = await openLix({
			keyValues: [uiStateKeyValue(collapsedFilesViewState())],
		});

		const utils = await renderShell(lix);
		await screen.findByRole("button", { name: "New file" });
		await waitFor(() => expect(desktop.onNewFile).toHaveBeenCalled());

		await act(async () => {
			await desktop.emitNewFile();
		});

		await expectNewFileCreatedAndOpened(lix);
		expect(queryFilesViewRenameInput(utils.container)).toBeNull();

		utils.unmount();
		await lix.close();
	});
});

describe("V2LayoutShell native Close File", () => {
	test("closes the active central document", async () => {
		const desktop = installDesktopMock();
		const lix = await openLix({
			keyValues: [uiStateKeyValue(openFileState("file_active", "/active.md"))],
		});
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_active",
				path: "/active.md",
				data: new TextEncoder().encode("# Active"),
			})
			.execute();

		const utils = await renderShell(lix);
		await screen.findByTestId("tiptap-editor");
		await waitFor(() => expect(desktop.onCloseFile).toHaveBeenCalled());

		await act(async () => {
			await desktop.emitCloseFile();
		});

		await screen.findByTestId("central-panel-empty-state");
		expect(screen.queryByTestId("tiptap-editor")).toBeNull();

		utils.unmount();
		await lix.close();
	});
});

describe("V2LayoutShell active file sidebar highlight", () => {
	test("highlights the active central file in the Files view", async () => {
		const lix = await openLix({
			keyValues: [
				uiStateKeyValue(
					filesViewWithOpenFileState("file_active", "/docs/readme.md"),
				),
			],
		});
		await qb(lix)
			.insertInto("lix_directory")
			.values({ path: "/docs/" } as any)
			.execute();
		await writeReviewFile(lix, "file_active", "/docs/readme.md", "# Readme");

		const utils = await renderShell(lix);

		await waitFor(() => {
			expect(
				queryFilesViewTreeItemByPath(utils.container, "docs/readme.md"),
			).toHaveAttribute("data-item-selected", "true");
		});

		await unmountShell(utils);
		await lix.close();
	});
});

describe("V2LayoutShell central file views", () => {
	test("collapses stale persisted central files to the active view", async () => {
		const desktop = installDesktopMock();
		const lix = await openLix({
			keyValues: [uiStateKeyValue(multipleCentralFilesState())],
		});
		await writeReviewFile(lix, "file_stale", "/stale.md", "# Stale");
		await writeReviewFile(lix, "file_active", "/active.md", "# Active");

		const utils = await renderShell(lix);

		await waitFor(() =>
			expect(desktop.setOpenFilePaths).toHaveBeenCalledWith({
				filePaths: ["active.md"],
			}),
		);
		await waitFor(async () => {
			expect(centralFilePaths(await readPersistedUiState(lix))).toEqual([
				"/active.md",
			]);
		});

		await unmountShell(utils);
		await lix.close();
	});

	test("opening multiple startup files leaves only the selected file open", async () => {
		const desktop = installDesktopMock();
		const handledFilePaths: string[] = [];
		const lix = await openLix({
			keyValues: [uiStateKeyValue(noFilesViewState())],
		});
		await writeReviewFile(lix, "file_a", "/a.md", "# A");
		await writeReviewFile(lix, "file_b", "/b.md", "# B");

		const utils = await renderShell(lix, {
			pendingOpenFilePaths: ["a.md", "b.md"],
			onPendingOpenFileHandled: (filePath) => {
				handledFilePaths.push(filePath);
			},
		});

		await waitFor(() => expect(handledFilePaths).toEqual(["a.md", "b.md"]));
		await waitFor(() =>
			expect(desktop.setOpenFilePaths).toHaveBeenCalledWith({
				filePaths: ["a.md"],
			}),
		);
		await waitFor(async () => {
			expect(centralFilePaths(await readPersistedUiState(lix))).toEqual([
				"/a.md",
			]);
		});

		await unmountShell(utils);
		await lix.close();
	});
});

describe("V2LayoutShell agent review auto-open", () => {
	test("returns current active file context from turn-start hooks", async () => {
		const desktop = installAgentHooksDesktopMock();
		const lix = await openLix({
			keyValues: [
				uiStateKeyValue(openFileState("file_current", "/current.md")),
			],
		});
		vi.spyOn(lix, "syncDiskToLix").mockResolvedValue();
		await writeReviewFile(lix, "file_current", "/current.md", "# Current");

		const utils = await renderShell(lix);
		await waitFor(() => expect(desktop.onTurnEvent).toHaveBeenCalled());

		let result: unknown;
		await act(async () => {
			result = await desktop.emitTurnEvent(agentTurnEvent("turn-start"));
		});

		expect(result).toEqual({
			additionalContext: "The current document is: ./current.md",
		});

		await unmountShell(utils);
		await lix.close();
	});

	test("leaves the current file open when it already has a pending review", async () => {
		const desktop = installAgentHooksDesktopMock();
		const lix = await openLix({
			keyValues: [
				uiStateKeyValue(openFileState("file_current", "/current.md")),
			],
		});
		vi.spyOn(lix, "syncDiskToLix").mockResolvedValue();
		await writeReviewFile(lix, "file_a", "/a.md", "# A before");
		await writeReviewFile(
			lix,
			"file_current",
			"/current.md",
			"# Current before",
		);

		const utils = await renderShell(lix);
		await waitFor(() => expect(desktop.onTurnEvent).toHaveBeenCalled());
		await waitFor(() =>
			expect(desktop.setActiveFilePath).toHaveBeenCalledWith({
				filePath: "/current.md",
			}),
		);

		await act(async () => {
			await desktop.emitTurnEvent(agentTurnEvent("turn-start"));
			await writeReviewFile(lix, "file_a", "/a.md", "# A after");
			await writeReviewFile(
				lix,
				"file_current",
				"/current.md",
				"# Current after",
			);
			await desktop.emitTurnEvent(agentTurnEvent("turn-stop"));
		});

		expect(
			await screen.findByRole("button", { name: /keep/i }),
		).toHaveAttribute("data-attr", "diff-accept");
		expect(desktop.setActiveFilePath).not.toHaveBeenCalledWith({
			filePath: "/a.md",
		});

		await unmountShell(utils);
		await lix.close();
	});

	test("opens the first edited review file when the current file has no pending review", async () => {
		const desktop = installAgentHooksDesktopMock();
		const lix = await openLix({
			keyValues: [
				uiStateKeyValue(openFileState("file_current", "/current.md")),
			],
		});
		vi.spyOn(lix, "syncDiskToLix").mockResolvedValue();
		await writeReviewFile(lix, "file_current", "/current.md", "# Current");
		await writeReviewFile(lix, "file_b", "/b.md", "# B before");
		await writeReviewFile(lix, "file_a", "/a.md", "# A before");

		const utils = await renderShell(lix);
		await waitFor(() => expect(desktop.onTurnEvent).toHaveBeenCalled());
		await waitFor(() =>
			expect(desktop.setActiveFilePath).toHaveBeenCalledWith({
				filePath: "/current.md",
			}),
		);

		await act(async () => {
			await desktop.emitTurnEvent(agentTurnEvent("turn-start"));
			await writeReviewFile(lix, "file_b", "/b.md", "# B after");
			await writeReviewFile(lix, "file_a", "/a.md", "# A after");
			await desktop.emitTurnEvent(agentTurnEvent("turn-stop"));
		});

		await waitFor(() =>
			expect(desktop.setActiveFilePath).toHaveBeenCalledWith({
				filePath: "/a.md",
			}),
		);
		expect(
			await screen.findByRole("button", { name: /keep/i }),
		).toHaveAttribute("data-attr", "diff-accept");
		await waitForPersistedActiveState(lix, "file_a", "/a.md");

		await unmountShell(utils);
		await lix.close();
	});
});

async function renderShell(
	lix: Lix,
	options: {
		readonly workspace?: WorkspaceContext;
		readonly pendingOpenFilePaths?: readonly string[];
		readonly onPendingOpenFileHandled?: (filePath: string) => void;
	} = {},
) {
	let result: ReturnType<typeof render> | undefined;
	await act(async () => {
		result = render(
			<LixProvider lix={lix}>
				<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
					<Suspense fallback={<div data-testid="loading" />}>
						<V2LayoutShell
							workspace={options.workspace}
							workspaceName="Workspace"
							pendingOpenFilePaths={options.pendingOpenFilePaths}
							onPendingOpenFileHandled={options.onPendingOpenFileHandled}
						/>
					</Suspense>
				</KeyValueProvider>
			</LixProvider>,
		);
	});
	return result!;
}

async function expectNewFileCreatedAndOpened(lix: Lix) {
	await waitFor(async () => {
		expect(await findFilePath(lix, "/new-file.md")).toBeDefined();
	});
	await screen.findByTestId("tiptap-editor");
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

async function unmountShell(utils: ReturnType<typeof render>): Promise<void> {
	await act(async () => {
		utils.unmount();
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

function installDesktopMock(): DesktopMock {
	let newFileListener: (() => void | Promise<void>) | null = null;
	let closeFileListener: (() => void | Promise<void>) | null = null;
	const setActiveFilePath = vi.fn();
	const setOpenFilePaths = vi.fn();
	const onNewFile = vi.fn((nextListener: () => void | Promise<void>) => {
		newFileListener = nextListener;
		return () => {
			if (newFileListener === nextListener) {
				newFileListener = null;
			}
		};
	});
	const onCloseFile = vi.fn(
		(nextListener: () => void | Promise<void>) => {
			closeFileListener = nextListener;
			return () => {
				if (closeFileListener === nextListener) {
					closeFileListener = null;
				}
			};
		},
	);
	window.flashtypeDesktop = {
		workspace: {
			onCloseFile,
			onNewFile,
			setActiveFilePath,
			setOpenFilePaths,
		},
	} as unknown as Window["flashtypeDesktop"];
	return {
		emitCloseFile: async () => {
			if (!closeFileListener) {
				throw new Error("native Close File listener was not registered");
			}
			await closeFileListener();
		},
		emitNewFile: async () => {
			if (!newFileListener) {
				throw new Error("native New File listener was not registered");
			}
			await newFileListener();
		},
		onCloseFile,
		onNewFile,
		setActiveFilePath,
		setOpenFilePaths,
	};
}

function installAgentHooksDesktopMock(): AgentHooksDesktopMock {
	let listener: ((event: unknown) => unknown | Promise<unknown>) | null = null;
	const onTurnEvent = vi.fn(
		(nextListener: (event: unknown) => unknown | Promise<unknown>) => {
			listener = nextListener;
			return () => {
				if (listener === nextListener) {
					listener = null;
				}
			};
		},
	);
	const setActiveFilePath = vi.fn();
	window.flashtypeDesktop = {
		workspace: {
			setActiveFilePath,
			setOpenFilePaths: vi.fn(),
		},
		agentHooks: {
			onTurnEvent,
		},
	} as unknown as Window["flashtypeDesktop"];
	return {
		emitTurnEvent: async (event) => {
			if (!listener) {
				throw new Error("agent hook listener was not registered");
			}
			return await listener(event);
		},
		onTurnEvent,
		setActiveFilePath,
	};
}

function agentTurnEvent(
	phase: AgentHookTurnEventInput["phase"],
): AgentHookTurnEventInput {
	return {
		id: `event-${phase}`,
		instanceId: "test-instance",
		agent: "codex",
		phase,
		sessionId: "test-session",
		turnId: "test-turn",
		createdAt: phase === "turn-start" ? 1 : 2,
	};
}

function uiStateKeyValue(value: FlashtypeUiState) {
	return {
		key: "flashtype_ui_state",
		value,
		lixcol_branch_id: "global",
		lixcol_global: true,
		lixcol_untracked: true,
	};
}

function noFilesViewState(): FlashtypeUiState {
	return {
		focusedPanel: "central",
		panels: {
			left: { views: [], activeInstance: null },
			central: { views: [], activeInstance: null },
			right: { views: [], activeInstance: null },
		},
		layout: { sizes: { left: 20, central: 50, right: 30 } },
	};
}

function twoFilesViewsState(): FlashtypeUiState {
	return {
		focusedPanel: "right",
		panels: {
			left: {
				views: [{ instance: "files-left", kind: FILES_EXTENSION_KIND }],
				activeInstance: "files-left",
			},
			central: { views: [], activeInstance: null },
			right: {
				views: [{ instance: "files-right", kind: FILES_EXTENSION_KIND }],
				activeInstance: "files-right",
			},
		},
		layout: { sizes: { left: 20, central: 50, right: 30 } },
	};
}

function collapsedFilesViewState(): FlashtypeUiState {
	return {
		focusedPanel: "left",
		panels: {
			left: {
				views: [{ instance: "files-left", kind: FILES_EXTENSION_KIND }],
				activeInstance: "files-left",
			},
			central: { views: [], activeInstance: null },
			right: { views: [], activeInstance: null },
		},
		layout: { sizes: { left: 0, central: 70, right: 30 } },
	};
}

function filesViewWithOpenFileState(
	fileId: string,
	filePath: string,
): FlashtypeUiState {
	const state = openFileState(fileId, filePath);
	return {
		...state,
		panels: {
			...state.panels,
			left: {
				views: [{ instance: "files-left", kind: FILES_EXTENSION_KIND }],
				activeInstance: "files-left",
			},
		},
	};
}

function openFileState(fileId: string, filePath: string): FlashtypeUiState {
	const instance = fileExtensionInstanceForKind(FILE_EXTENSION_KIND, fileId);
	return {
		focusedPanel: "central",
		panels: {
			left: { views: [], activeInstance: null },
			central: {
				views: [
					{
						instance,
						kind: FILE_EXTENSION_KIND,
						state: {
							fileId,
							filePath,
							flashtype: {
								label: filePath.split("/").filter(Boolean).pop() ?? filePath,
							},
						},
					},
				],
				activeInstance: instance,
			},
			right: { views: [], activeInstance: null },
		},
		layout: { sizes: { left: 20, central: 50, right: 30 } },
	};
}

function multipleCentralFilesState(): FlashtypeUiState {
	const active = openFileState("file_active", "/active.md");
	const staleInstance = fileExtensionInstanceForKind(
		FILE_EXTENSION_KIND,
		"file_stale",
	);
	return {
		...active,
		panels: {
			...active.panels,
			central: {
				views: [
					{
						instance: staleInstance,
						kind: FILE_EXTENSION_KIND,
						state: {
							fileId: "file_stale",
							filePath: "/stale.md",
							flashtype: { label: "stale.md" },
						},
					},
					...active.panels.central.views,
				],
				activeInstance: fileExtensionInstanceForKind(
					FILE_EXTENSION_KIND,
					"file_active",
				),
			},
		},
	};
}

async function readPersistedUiState(
	lix: Lix,
): Promise<FlashtypeUiState | undefined> {
	const row = await qb(lix)
		.selectFrom("lix_key_value_by_branch")
		.select("value")
		.where("key", "=", "flashtype_ui_state")
		.where("lixcol_branch_id", "=", "global")
		.executeTakeFirst();
	return row?.value as FlashtypeUiState | undefined;
}

function centralFilePaths(uiState: FlashtypeUiState | undefined): string[] {
	return (
		uiState?.panels.central.views
			.map((entry) => entry.state?.filePath)
			.filter((filePath): filePath is string => typeof filePath === "string") ??
		[]
	);
}

async function findFilePath(
	lix: Lix,
	path: string,
): Promise<string | undefined> {
	return (
		await qb(lix)
			.selectFrom("lix_file")
			.select("path")
			.where("path", "=", path)
			.executeTakeFirst()
	)?.path;
}

async function writeReviewFile(
	lix: Lix,
	id: string,
	path: string,
	text: string,
): Promise<void> {
	await qb(lix)
		.insertInto("lix_file")
		.values({ id, path, data: new TextEncoder().encode(text) })
		.onConflict((oc) =>
			oc.column("id").doUpdateSet({
				path,
				data: new TextEncoder().encode(text),
			}),
		)
		.execute();
}

async function waitForPersistedActiveState(
	lix: Lix,
	fileId: string,
	filePath: string,
): Promise<void> {
	await waitFor(async () => {
		const activeFileRow = await qb(lix)
			.selectFrom("lix_key_value_by_branch")
			.select("value")
			.where("key", "=", "flashtype_active_file_id")
			.where("lixcol_branch_id", "=", "global")
			.executeTakeFirst();
		expect(activeFileRow?.value).toBe(fileId);

		const uiStateRow = await qb(lix)
			.selectFrom("lix_key_value_by_branch")
			.select("value")
			.where("key", "=", "flashtype_ui_state")
			.where("lixcol_branch_id", "=", "global")
			.executeTakeFirst();
		const uiState = uiStateRow?.value as FlashtypeUiState | undefined;
		const activeInstance = uiState?.panels.central.activeInstance;
		const activeEntry = uiState?.panels.central.views.find(
			(entry) => entry.instance === activeInstance,
		);
		expect(activeEntry?.state?.filePath).toBe(filePath);
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

function ephemeralWorkspace() {
	return {
		ephemeral: true,
		path: "/workspace",
		name: "workspace",
		openFilePaths: [],
	} as const;
}

function persistentWorkspace() {
	return {
		ephemeral: false,
		path: "/workspace",
		name: "workspace",
	} as const;
}
