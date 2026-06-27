import { Suspense, act } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { KeyValueProvider } from "@/hooks/key-value/use-key-value";
import { KEY_VALUE_DEFINITIONS } from "@/hooks/key-value/schema";
import { openLix } from "@/test-utils/node-lix-sdk";
import { qb } from "@/lib/lix-kysely";
import { FILES_EXTENSION_KIND } from "@/extension-runtime/extension-instance-helpers";
import { resolveLixFileForOpen, V2LayoutShell } from "./layout-shell";
import type { FlashtypeUiState } from "./ui-state";
import type { Lix } from "@/lib/lix-types";

type DesktopMock = {
	readonly emitNewFile: () => Promise<void>;
	readonly onNewFile: ReturnType<typeof vi.fn>;
};

const originalDesktop = window.flashtypeDesktop;

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

		const input = (await screen.findByTestId(
			"files-view-draft-input",
		)) as HTMLInputElement;
		await waitFor(() => expect(document.activeElement).toBe(input));
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

		const input = await screen.findByTestId("files-view-draft-input");
		const remainingButton = screen.getByRole("button", { name: "New file" });
		expect(
			remainingButton.compareDocumentPosition(input) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(screen.getAllByTestId("files-view-draft-input")).toHaveLength(1);

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
		expect(screen.queryByTestId("files-view-draft-input")).toBeNull();

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
		expect(screen.queryByTestId("files-view-draft-input")).toBeNull();

		utils.unmount();
		await lix.close();
	});
});

async function renderShell(lix: Lix) {
	let result: ReturnType<typeof render> | undefined;
	await act(async () => {
		result = render(
			<LixProvider lix={lix}>
				<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
					<Suspense fallback={<div data-testid="loading" />}>
						<V2LayoutShell workspaceName="Workspace" />
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
