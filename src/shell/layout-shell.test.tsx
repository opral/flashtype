import { Suspense, act } from "react";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { KeyValueProvider } from "@/hooks/key-value/use-key-value";
import {
	ACTIVE_FILE_ID_KEY,
	KEY_VALUE_DEFINITIONS,
} from "@/hooks/key-value/schema";
import { openLix } from "@/test-utils/node-lix-sdk";
import { qb } from "@/lib/lix-kysely";
import { FILES_EXTENSION_KIND } from "@/extension-runtime/extension-instance-helpers";
import { resolveLixFileForOpen, V2LayoutShell } from "./layout-shell";
import type { FlashtypeUiState } from "./ui-state";
import type { Lix } from "@/lib/lix-types";
import { appendAgentTurnCommitRange } from "./agent-turn-review-range";

type DesktopMock = {
	readonly emitNewFile: () => Promise<void>;
	readonly onNewFile: ReturnType<typeof vi.fn>;
};

type AgentHooksDesktopMock = {
	readonly emitTurnEvent: (event: AgentHookTestEvent) => Promise<void>;
	readonly onTurnEvent: ReturnType<typeof vi.fn>;
	readonly setActiveFilePath: ReturnType<typeof vi.fn>;
	readonly setOpenFilePaths: ReturnType<typeof vi.fn>;
};

type AgentHookTestEvent = {
	readonly id: string;
	readonly instanceId?: string;
	readonly agent: "claude" | "codex";
	readonly phase: "turn-start" | "turn-stop";
	readonly sessionId?: string;
	readonly turnId?: string;
	readonly createdAt: number;
};

const originalDesktop = window.flashtypeDesktop;
const encoder = new TextEncoder();

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
	for (const portal of document.querySelectorAll("[data-base-ui-portal]")) {
		portal.remove();
	}
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

describe("V2LayoutShell agent reviews", () => {
	test("opens the changed file diff when an agent turn changes an unopened file", async () => {
		const desktop = installAgentHooksDesktopMock();
		const lix = await openLix({
			keyValues: [uiStateKeyValue(noFilesViewState())],
		});
		vi.spyOn(lix, "syncDiskToLix").mockResolvedValue(undefined);
		await writeFile(lix, "agent-review-file", "/agent-review.md", "# Before");

		const utils = await renderShell(lix);
		await screen.findByTestId("central-panel-empty-state");
		await waitFor(() => expect(desktop.onTurnEvent).toHaveBeenCalled());

		await act(async () => {
			await desktop.emitTurnEvent(agentTurnEvent("turn-start"));
		});
		await act(async () => {
			await writeFile(lix, "agent-review-file", "/agent-review.md", "# After");
		});
		await act(async () => {
			await desktop.emitTurnEvent(agentTurnEvent("turn-stop"));
		});

		const keepButton = await screen.findByRole("button", { name: /keep/i });
		expect(keepButton).toHaveAttribute("data-attr", "diff-accept");
		expect(screen.getByRole("button", { name: /undo/i })).toHaveAttribute(
			"data-attr",
			"diff-reject",
		);
		await act(async () => {
			fireEvent.click(keepButton);
		});
		await screen.findByTestId("central-panel-empty-state");
		await waitFor(() =>
			expect(desktop.setActiveFilePath).toHaveBeenLastCalledWith({
				filePath: null,
			}),
		);
		await waitFor(async () => {
			expect(await readActiveFileId(lix)).toBeNull();
		});

		utils.unmount();
		await lix.close();
	});

	test("switches from an already open document to the changed file diff", async () => {
		const desktop = installAgentHooksDesktopMock();
		const lix = await openLix();
		vi.spyOn(lix, "syncDiskToLix").mockResolvedValue(undefined);
		await writeFile(lix, "open-document-file", "/open.md", "# Open");
		await writeFile(lix, "agent-review-file", "/agent-review.md", "# Before");

		const utils = await renderShell(lix, { pendingOpenFilePaths: ["open.md"] });
		await screen.findByTestId("tiptap-editor");
		await waitFor(() =>
			expect(desktop.setActiveFilePath).toHaveBeenCalledWith({
				filePath: "/open.md",
			}),
		);
		await waitFor(() => expect(desktop.onTurnEvent).toHaveBeenCalled());

		await act(async () => {
			await desktop.emitTurnEvent(agentTurnEvent("turn-start"));
		});
		await act(async () => {
			await writeFile(lix, "agent-review-file", "/agent-review.md", "# After");
		});
		await act(async () => {
			await desktop.emitTurnEvent(agentTurnEvent("turn-stop"));
		});

		const keepButton = await screen.findByRole("button", { name: /keep/i });
		expect(keepButton).toHaveAttribute("data-attr", "diff-accept");
		expect(screen.getByRole("button", { name: /undo/i })).toHaveAttribute(
			"data-attr",
			"diff-reject",
		);
		await waitFor(() =>
			expect(desktop.setActiveFilePath).toHaveBeenLastCalledWith({
				filePath: "/agent-review.md",
			}),
		);
		await waitFor(async () => {
			expect(await readActiveFileId(lix)).toBe("agent-review-file");
		});
		await act(async () => {
			fireEvent.click(keepButton);
		});
		await waitFor(() =>
			expect(desktop.setActiveFilePath).toHaveBeenLastCalledWith({
				filePath: "/open.md",
			}),
		);
		await waitFor(async () => {
			expect(await readActiveFileId(lix)).toBe("open-document-file");
		});
		await waitFor(() => {
			const lastCall = desktop.setOpenFilePaths.mock.calls.at(-1)?.[0] as
				| { filePaths?: string[] }
				| undefined;
			expect([...(lastCall?.filePaths ?? [])].sort()).toEqual([
				"agent-review.md",
				"open.md",
			]);
		});

		utils.unmount();
		await lix.close();
	});

	test("does not open a file when a new range clears the aggregate review", async () => {
		const desktop = installAgentHooksDesktopMock();
		const lix = await openLix();
		vi.spyOn(lix, "syncDiskToLix").mockResolvedValue(undefined);
		try {
			await writeFile(lix, "open-document-file", "/open.md", "# Open");
			await writeFile(lix, "agent-review-file", "/agent-review.md", "# Before");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, "agent-review-file", "/agent-review.md", "# After");
			const middleCommitId = await activeCommitId(lix);
			await appendAgentTurnCommitRange(lix, {
				id: "seeded-range",
				agent: "codex",
				beforeCommitId,
				afterCommitId: middleCommitId,
				startedAt: 1,
				completedAt: 2,
			});

			const utils = await renderShell(lix, {
				pendingOpenFilePaths: ["open.md"],
			});
			await screen.findByTestId("tiptap-editor");
			await waitFor(() =>
				expect(desktop.setActiveFilePath).toHaveBeenLastCalledWith({
					filePath: "/open.md",
				}),
			);
			await waitFor(() => expect(desktop.onTurnEvent).toHaveBeenCalled());

			await act(async () => {
				await desktop.emitTurnEvent(agentTurnEvent("turn-start"));
			});
			await act(async () => {
				await writeFile(
					lix,
					"agent-review-file",
					"/agent-review.md",
					"# Before",
				);
			});
			await act(async () => {
				await desktop.emitTurnEvent(agentTurnEvent("turn-stop"));
			});

			await waitFor(async () => {
				expect(await readActiveFileId(lix)).toBe("open-document-file");
			});
			expect(
				screen.queryByRole("group", { name: "External write review actions" }),
			).toBeNull();
			expect(desktop.setActiveFilePath).toHaveBeenLastCalledWith({
				filePath: "/open.md",
			});

			utils.unmount();
		} finally {
			await lix.close();
		}
	});
});

async function renderShell(
	lix: Lix,
	props: Partial<Parameters<typeof V2LayoutShell>[0]> = {},
) {
	let result: ReturnType<typeof render> | undefined;
	await act(async () => {
		result = render(
			<LixProvider lix={lix}>
				<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
					<Suspense fallback={<div data-testid="loading" />}>
						<V2LayoutShell workspaceName="Workspace" {...props} />
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

async function writeFile(
	lix: Lix,
	id: string,
	path: string,
	text: string,
): Promise<void> {
	await qb(lix)
		.insertInto("lix_file")
		.values({ id, path, data: encoder.encode(text) })
		.onConflict((oc) =>
			oc.column("id").doUpdateSet({ path, data: encoder.encode(text) }),
		)
		.execute();
}

async function activeCommitId(lix: Lix): Promise<string> {
	const result = await lix.execute(
		"SELECT lix_active_branch_commit_id() AS commit_id",
	);
	const commitId = result.rows[0]?.get("commit_id");
	if (typeof commitId !== "string") {
		throw new Error("Missing active commit id");
	}
	return commitId;
}

async function readActiveFileId(lix: Lix): Promise<unknown> {
	const row = await qb(lix)
		.selectFrom("lix_key_value_by_branch")
		.select("value")
		.where("key", "=", ACTIVE_FILE_ID_KEY)
		.where("lixcol_branch_id", "=", "global")
		.executeTakeFirst();
	return row?.value;
}

function installDesktopMock(): DesktopMock {
	let listener: (() => void | Promise<void>) | null = null;
	const onNewFile = vi.fn((nextListener: () => void | Promise<void>) => {
		listener = nextListener;
		return () => {
			if (listener === nextListener) {
				listener = null;
			}
		};
	});
	window.flashtypeDesktop = {
		workspace: {
			onNewFile,
			setActiveFilePath: vi.fn(),
			setOpenFilePaths: vi.fn(),
		},
	} as unknown as Window["flashtypeDesktop"];
	return {
		emitNewFile: async () => {
			if (!listener) {
				throw new Error("native New File listener was not registered");
			}
			await listener();
		},
		onNewFile,
	};
}

function installAgentHooksDesktopMock(): AgentHooksDesktopMock {
	let listener: ((event: unknown) => void | Promise<void>) | null = null;
	const setActiveFilePath = vi.fn();
	const setOpenFilePaths = vi.fn();
	const onTurnEvent = vi.fn(
		(nextListener: (event: unknown) => void | Promise<void>) => {
			listener = nextListener;
			return () => {
				if (listener === nextListener) {
					listener = null;
				}
			};
		},
	);
	window.flashtypeDesktop = {
		workspace: {
			setActiveFilePath,
			setOpenFilePaths,
		},
		agentHooks: {
			onTurnEvent,
		},
	} as unknown as Window["flashtypeDesktop"];
	return {
		emitTurnEvent: async (event) => {
			if (!listener) {
				throw new Error("agent turn listener was not registered");
			}
			await listener(event);
		},
		onTurnEvent,
		setActiveFilePath,
		setOpenFilePaths,
	};
}

function agentTurnEvent(phase: "turn-start" | "turn-stop"): AgentHookTestEvent {
	return {
		id: `agent-review-${phase}`,
		instanceId: "agent-review-instance",
		agent: "codex",
		phase,
		sessionId: "agent-review-session",
		turnId: "agent-review-turn",
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

function ephemeralWorkspace() {
	return {
		ephemeral: true,
		path: "/workspace",
		name: "workspace",
		openFilePaths: [],
	} as const;
}
