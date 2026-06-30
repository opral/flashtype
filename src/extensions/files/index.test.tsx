import React, { Suspense } from "react";
import { beforeAll, afterAll, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { FilesView } from "./index";
import type { ExtensionContext } from "../../extension-runtime/types";
import { qb } from "@/lib/lix-kysely";
import {
	appendAgentTurnCommitRange,
	type AgentTurnCommitRange,
} from "@/shell/agent-turn-review-range";
import type {
	CheckpointDiff,
	CheckpointDiffFile,
} from "@/extension-runtime/checkpoint-diff";

const createViewContext = (
	lix: Awaited<ReturnType<typeof openLix>>,
	overrides: Partial<ExtensionContext> = {},
): ExtensionContext => ({
	setTabBadgeCount: () => {},
	lix,
	...overrides,
});

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
	window.navigator,
	"platform",
);

function setNavigatorPlatform(value: string) {
	Object.defineProperty(window.navigator, "platform", {
		value,
		configurable: true,
	});
}

function isUserPath(path: string): boolean {
	return !path.startsWith("/.lix/");
}

async function waitForFilesViewReady(utils: ReturnType<typeof render>) {
	for (let i = 0; i < 20; i += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		const button = utils.queryByRole("button", { name: "New file" });
		if (button) return button;
	}
	throw new Error("Files view did not finish loading");
}

function queryFilesTreeHost(
	utils: ReturnType<typeof render>,
): HTMLElement | null {
	const host = utils.container.querySelector("file-tree-container");
	return host instanceof HTMLElement ? host : null;
}

function getFilesTreeHost(utils: ReturnType<typeof render>): HTMLElement {
	const host = queryFilesTreeHost(utils);
	if (!host) {
		throw new Error("file tree host not found");
	}
	return host;
}

function queryFilesTreeRoot(
	utils: ReturnType<typeof render>,
): ShadowRoot | null {
	return queryFilesTreeHost(utils)?.shadowRoot ?? null;
}

function getFilesTreeRoot(utils: ReturnType<typeof render>): ShadowRoot {
	const root = queryFilesTreeRoot(utils);
	if (!root) {
		throw new Error("file tree shadow root not found");
	}
	return root;
}

function queryTreeItemByLabel(
	utils: ReturnType<typeof render>,
	label: string,
): HTMLElement | null {
	const root = queryFilesTreeRoot(utils);
	if (!root) return null;
	for (const item of root.querySelectorAll("[data-type='item']")) {
		if (
			item instanceof HTMLElement &&
			item.getAttribute("aria-label") === label
		) {
			return item;
		}
	}
	return null;
}

function queryTreeItemByPath(
	utils: ReturnType<typeof render>,
	path: string,
): HTMLElement | null {
	const root = queryFilesTreeRoot(utils);
	if (!root) return null;
	const item = root.querySelector(
		`[data-type='item'][data-item-path='${CSS.escape(path)}']`,
	);
	return item instanceof HTMLElement ? item : null;
}

async function findTreeItemByPath(
	utils: ReturnType<typeof render>,
	path: string,
): Promise<HTMLElement> {
	return waitFor(() => {
		const item = queryTreeItemByPath(utils, path);
		if (!item) {
			throw new Error(`file tree item not found: ${path}`);
		}
		return item;
	});
}

async function findTreeItemByLabel(
	utils: ReturnType<typeof render>,
	label: string,
): Promise<HTMLElement> {
	return waitFor(() => {
		const item = queryTreeItemByLabel(utils, label);
		if (!item) {
			throw new Error(`file tree item not found: ${label}`);
		}
		return item;
	});
}

function queryTreeRenameInput(
	utils: ReturnType<typeof render>,
): HTMLInputElement | null {
	const input = queryFilesTreeRoot(utils)?.querySelector(
		"[data-item-rename-input]",
	);
	return input instanceof HTMLInputElement ? input : null;
}

async function findTreeRenameInput(
	utils: ReturnType<typeof render>,
): Promise<HTMLInputElement> {
	return waitFor(() => {
		const input = queryTreeRenameInput(utils);
		if (!input) {
			throw new Error("file tree rename input not found");
		}
		return input;
	});
}

async function startTreeRenameByLabel(
	utils: ReturnType<typeof render>,
	label: string,
): Promise<HTMLInputElement> {
	const item = await findTreeItemByLabel(utils, label);
	await act(async () => {
		fireEvent.click(item);
	});
	await act(async () => {
		fireEvent.keyDown(getFilesTreeRoot(utils).activeElement ?? item, {
			key: "F2",
		});
	});
	return findTreeRenameInput(utils);
}

describe("FilesView", () => {
	beforeAll(() => {
		setNavigatorPlatform("MacIntel");
	});

	afterAll(() => {
		if (originalPlatformDescriptor) {
			Object.defineProperty(
				window.navigator,
				"platform",
				originalPlatformDescriptor,
			);
		}
	});

	test("prevents text selection on the new file row", async () => {
		const lix = await openLix();

		let utils: ReturnType<typeof render> | null = null;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix)} />
					</Suspense>
				</LixProvider>,
			);
		});

		await waitForFilesViewReady(utils!);
		expect(utils!.getByRole("button", { name: "New file" })).toHaveClass(
			"select-none",
		);
		expect(utils!.getByRole("button", { name: "New file" })).toHaveAttribute(
			"data-attr",
			"file-new",
		);
		expect(utils!.getByTestId("files-view-tree-scroll")).toHaveAttribute(
			"data-attr",
			"file-tree",
		);

		utils!.unmount();
		await lix.close();
	});

	test("creates an inline draft when Cmd+. is pressed", async () => {
		const lix = await openLix();
		const openFile = vi.fn();

		let utils: ReturnType<typeof render> | null = null;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { openFile })} />
					</Suspense>
				</LixProvider>,
			);
		});
		await waitForFilesViewReady(utils!);

		await waitForFilesViewReady(utils!);

		const initialRows = await qb(lix)
			.selectFrom("lix_file")
			.select(["id", "path"])
			.execute();
		expect(initialRows.filter((row) => isUserPath(row.path))).toHaveLength(0);

		await act(async () => {
			fireEvent.keyDown(document, { key: ".", metaKey: true });
		});

		const input = await findTreeRenameInput(utils!);
		expect(input.value).toBe("new-file");

		await act(async () => {
			fireEvent.input(input, { target: { value: "notes" } });
		});

		await act(async () => {
			fireEvent.keyDown(input, { key: "Enter" });
		});

		await waitFor(async () => {
			const rows = await qb(lix)
				.selectFrom("lix_file")
				.select(["id", "path"])
				.execute();
			const userRows = rows.filter((row) => isUserPath(row.path));
			expect(userRows).toHaveLength(1);
			expect(userRows[0]?.path).toBe("/notes.md");
			const createdId = userRows[0]?.id as string;
			expect(openFile).toHaveBeenCalledWith({
				panel: "central",
				fileId: createdId,
				filePath: "/notes.md",
				state: { focusOnLoad: true, defaultBlock: "heading1" },
				focus: true,
				documentOrigin: "new",
			});
		});

		utils!.unmount();
		await lix.close();
	});

	test("does not subscribe to the native New File menu item directly", async () => {
		const lix = await openLix();
		const originalDesktop = window.flashtypeDesktop;
		const onNewFile = vi.fn();
		window.flashtypeDesktop = {
			workspace: {
				onNewFile,
			},
		} as unknown as Window["flashtypeDesktop"];

		let utils: ReturnType<typeof render>;
		try {
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<FilesView context={createViewContext(lix)} />
						</Suspense>
					</LixProvider>,
				);
			});
			await waitForFilesViewReady(utils!);

			expect(onNewFile).not.toHaveBeenCalled();

			utils!.unmount();
		} finally {
			window.flashtypeDesktop = originalDesktop;
			await lix.close();
		}
	});

	test("moves the highlighted file when the active file path changes", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values([
				{
					id: "file_alpha",
					path: "/alpha.md",
					data: new Uint8Array(),
				},
				{
					id: "file_beta",
					path: "/beta.md",
					data: new Uint8Array(),
				},
			])
			.execute();

		const renderFilesView = (activeFilePath: string | null) => (
			<LixProvider lix={lix}>
				<Suspense fallback={null}>
					<FilesView
						context={createViewContext(lix, {
							activeFilePath,
						})}
					/>
				</Suspense>
			</LixProvider>
		);

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(renderFilesView("/alpha.md"));
		});

		await waitFor(() => {
			expect(queryTreeItemByPath(utils!, "alpha.md")).toHaveAttribute(
				"data-item-selected",
				"true",
			);
		});
		expect(queryTreeItemByPath(utils!, "beta.md")).not.toHaveAttribute(
			"data-item-selected",
			"true",
		);

		await act(async () => {
			utils!.rerender(renderFilesView("/beta.md"));
		});

		await waitFor(() => {
			expect(queryTreeItemByPath(utils!, "beta.md")).toHaveAttribute(
				"data-item-selected",
				"true",
			);
			expect(queryTreeItemByPath(utils!, "alpha.md")).not.toHaveAttribute(
				"data-item-selected",
				"true",
			);
		});

		utils!.unmount();
		await lix.close();
	});

	test("opens parent directories for the active file highlight", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_directory")
			.values({ path: "/docs/" } as any)
			.execute();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_nested_active",
				path: "/docs/readme.md",
				data: new Uint8Array(),
			})
			.execute();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView
							context={createViewContext(lix, {
								activeFilePath: "/docs/readme.md",
							})}
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		const nestedItem = await findTreeItemByPath(utils!, "docs/readme.md");
		expect(nestedItem).toHaveAttribute("data-item-selected", "true");

		utils!.unmount();
		await lix.close();
	});

	test("focuses the inline draft without forcing the left panel", async () => {
		const lix = await openLix();
		const focusPanel = vi.fn();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { focusPanel })} />
					</Suspense>
				</LixProvider>,
			);
		});
		const newFileButton = await waitForFilesViewReady(utils!);

		await act(async () => {
			fireEvent.click(newFileButton);
		});

		const input = await findTreeRenameInput(utils!);
		await waitFor(() => {
			expect(getFilesTreeRoot(utils!).activeElement).toBe(input);
		});
		expect(input.value).toBe("new-file");
		expect(focusPanel).not.toHaveBeenCalled();

		utils!.unmount();
		await lix.close();
	});

	test("renames selected files with F2", async () => {
		const lix = await openLix();
		const openFile = vi.fn();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_rename",
				path: "/draft.md",
				data: new Uint8Array(),
			})
			.execute();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { openFile })} />
					</Suspense>
				</LixProvider>,
			);
		});

		const input = await startTreeRenameByLabel(utils!, "draft.md");
		expect(input.value).toBe("draft.md");
		openFile.mockClear();

		await act(async () => {
			fireEvent.input(input, { target: { value: "renamed.md" } });
		});
		await act(async () => {
			fireEvent.keyDown(input, { key: "Enter" });
		});

		await waitFor(async () => {
			const rows = await qb(lix)
				.selectFrom("lix_file")
				.select(["id", "path"])
				.execute();
			expect(rows.some((row) => row.path === "/draft.md")).toBe(false);
			expect(
				rows.some(
					(row) => row.id === "file_rename" && row.path === "/renamed.md",
				),
			).toBe(true);
			expect(queryTreeItemByLabel(utils!, "draft.md")).toBeNull();
			expect(queryTreeItemByLabel(utils!, "renamed.md")).toBeInTheDocument();
		});
		expect(openFile).toHaveBeenCalledWith({
			panel: "central",
			fileId: "file_rename",
			filePath: "/renamed.md",
			focus: false,
			trackTelemetry: false,
		});

		utils!.unmount();
		await lix.close();
	});

	test("renames selected directories with F2", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_directory")
			.values({ path: "/docs/" } as any)
			.execute();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_nested",
				path: "/docs/readme.md",
				data: new Uint8Array(),
			})
			.execute();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix)} />
					</Suspense>
				</LixProvider>,
			);
		});

		const input = await startTreeRenameByLabel(utils!, "docs");
		expect(input.value).toBe("docs");

		await act(async () => {
			fireEvent.input(input, { target: { value: "notes" } });
		});
		await act(async () => {
			fireEvent.keyDown(input, { key: "Enter" });
		});

		await waitFor(async () => {
			const directoryRows = await qb(lix)
				.selectFrom("lix_directory")
				.select(["path"])
				.execute();
			const fileRows = await qb(lix)
				.selectFrom("lix_file")
				.select(["id", "path"])
				.execute();
			expect(directoryRows.some((row) => row.path === "/docs/")).toBe(false);
			expect(directoryRows.some((row) => row.path === "/notes/")).toBe(true);
			expect(fileRows.some((row) => row.path === "/docs/readme.md")).toBe(
				false,
			);
			expect(
				fileRows.some(
					(row) => row.id === "file_nested" && row.path === "/notes/readme.md",
				),
			).toBe(true);
			expect(queryTreeItemByLabel(utils!, "docs")).toBeNull();
			expect(queryTreeItemByLabel(utils!, "notes")).toBeInTheDocument();
		});

		utils!.unmount();
		await lix.close();
	});

	test("Cmd+Backspace deletes the selected file from the focused file row", async () => {
		const lix = await openLix();
		const closeFileViews = vi.fn();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_1",
				path: "/hello.md",
				data: new Uint8Array(),
			})
			.execute();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { closeFileViews })} />
					</Suspense>
				</LixProvider>,
			);
		});

		await findTreeItemByLabel(utils!, "hello.md");

		await act(async () => {
			fireEvent.click(await findTreeItemByLabel(utils!, "hello.md"));
		});

		await act(async () => {
			fireEvent.keyDown(document, { key: "Backspace", metaKey: true });
		});

		await waitFor(async () => {
			const rows = await qb(lix)
				.selectFrom("lix_file")
				.select(["path"])
				.execute();
			expect(rows.filter((row) => isUserPath(row.path))).toHaveLength(0);
		});

		await waitFor(() => {
			expect(queryTreeItemByLabel(utils!, "hello.md")).toBeNull();
		});
		expect(closeFileViews).toHaveBeenCalledWith({ fileId: "file_1" });

		utils!.unmount();
		await lix.close();
	});

	test("Cmd+Backspace in an empty editor keeps a newly created selected file and editor event", async () => {
		const lix = await openLix();
		const openFile = vi.fn();
		const closeFileViews = vi.fn();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView
							context={createViewContext(lix, { closeFileViews, openFile })}
						/>
					</Suspense>
				</LixProvider>,
			);
		});
		await waitForFilesViewReady(utils!);

		await waitForFilesViewReady(utils!);

		await act(async () => {
			fireEvent.keyDown(document, { key: ".", metaKey: true });
		});
		const input = await findTreeRenameInput(utils!);
		await act(async () => {
			fireEvent.input(input, { target: { value: "fresh" } });
		});
		await act(async () => {
			fireEvent.keyDown(input, { key: "Enter" });
		});

		await waitFor(() => {
			expect(openFile).toHaveBeenCalled();
		});

		const emptyEditor = document.createElement("div");
		emptyEditor.contentEditable = "true";
		document.body.append(emptyEditor);
		let emptyEditorEvent: KeyboardEvent;
		await act(async () => {
			emptyEditorEvent = new KeyboardEvent("keydown", {
				key: "Backspace",
				metaKey: true,
				bubbles: true,
				cancelable: true,
			});
			expect(emptyEditor.dispatchEvent(emptyEditorEvent)).toBe(true);
		});
		expect(emptyEditorEvent!.defaultPrevented).toBe(false);

		const rows = await qb(lix)
			.selectFrom("lix_file")
			.select(["path"])
			.execute();
		expect(rows.some((row) => row.path === "/fresh.md")).toBe(true);
		expect(closeFileViews).not.toHaveBeenCalled();
		emptyEditor.remove();

		utils!.unmount();
		await lix.close();
	});

	test("Cmd+Backspace in a non-empty editor keeps the selected file and editor event", async () => {
		const lix = await openLix();
		const closeFileViews = vi.fn();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_with_text",
				path: "/keep.md",
				data: new TextEncoder().encode("Keep me"),
			})
			.execute();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { closeFileViews })} />
					</Suspense>
				</LixProvider>,
			);
		});

		const file = await findTreeItemByLabel(utils!, "keep.md");
		await act(async () => {
			fireEvent.click(file);
		});

		const editor = document.createElement("div");
		editor.contentEditable = "true";
		editor.textContent = "Keep me";
		document.body.append(editor);
		let editorEvent: KeyboardEvent;
		await act(async () => {
			editorEvent = new KeyboardEvent("keydown", {
				key: "Backspace",
				metaKey: true,
				bubbles: true,
				cancelable: true,
			});
			expect(editor.dispatchEvent(editorEvent)).toBe(true);
		});
		expect(editorEvent!.defaultPrevented).toBe(false);

		const rows = await qb(lix)
			.selectFrom("lix_file")
			.select(["path"])
			.execute();
		expect(rows.some((row) => row.path === "/keep.md")).toBe(true);
		expect(closeFileViews).not.toHaveBeenCalled();

		editor.remove();
		utils!.unmount();
		await lix.close();
	});

	test("Cmd+Backspace in a whitespace-only editor keeps the selected file and editor event", async () => {
		const lix = await openLix();
		const closeFileViews = vi.fn();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_with_spaces",
				path: "/spaces.md",
				data: new TextEncoder().encode("   "),
			})
			.execute();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { closeFileViews })} />
					</Suspense>
				</LixProvider>,
			);
		});

		const file = await findTreeItemByLabel(utils!, "spaces.md");
		await act(async () => {
			fireEvent.click(file);
		});

		const editor = document.createElement("div");
		editor.contentEditable = "true";
		editor.textContent = "   \n";
		document.body.append(editor);
		let editorEvent: KeyboardEvent;
		await act(async () => {
			editorEvent = new KeyboardEvent("keydown", {
				key: "Backspace",
				metaKey: true,
				bubbles: true,
				cancelable: true,
			});
			expect(editor.dispatchEvent(editorEvent)).toBe(true);
		});
		expect(editorEvent!.defaultPrevented).toBe(false);

		const rows = await qb(lix)
			.selectFrom("lix_file")
			.select(["path"])
			.execute();
		expect(rows.some((row) => row.path === "/spaces.md")).toBe(true);
		expect(closeFileViews).not.toHaveBeenCalled();

		editor.remove();
		utils!.unmount();
		await lix.close();
	});

	test("Cmd+Backspace in an editor with non-text content keeps the selected file and editor event", async () => {
		const lix = await openLix();
		const closeFileViews = vi.fn();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_with_rule",
				path: "/rule.md",
				data: new TextEncoder().encode("---"),
			})
			.execute();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { closeFileViews })} />
					</Suspense>
				</LixProvider>,
			);
		});

		const file = await findTreeItemByLabel(utils!, "rule.md");
		await act(async () => {
			fireEvent.click(file);
		});

		const editor = document.createElement("div");
		editor.contentEditable = "true";
		editor.innerHTML = "<hr>";
		document.body.append(editor);
		let editorEvent: KeyboardEvent;
		await act(async () => {
			editorEvent = new KeyboardEvent("keydown", {
				key: "Backspace",
				metaKey: true,
				bubbles: true,
				cancelable: true,
			});
			expect(editor.dispatchEvent(editorEvent)).toBe(true);
		});
		expect(editorEvent!.defaultPrevented).toBe(false);

		const rows = await qb(lix)
			.selectFrom("lix_file")
			.select(["path"])
			.execute();
		expect(rows.some((row) => row.path === "/rule.md")).toBe(true);
		expect(closeFileViews).not.toHaveBeenCalled();

		editor.remove();
		utils!.unmount();
		await lix.close();
	});

	test("asks the host to open CSV files", async () => {
		const lix = await openLix();
		const openFile = vi.fn();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_csv",
				path: "/data.csv",
				data: new TextEncoder().encode("name,value\nalpha,1"),
			})
			.execute();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { openFile })} />
					</Suspense>
				</LixProvider>,
			);
		});

		await findTreeItemByLabel(utils!, "data.csv");

		await act(async () => {
			fireEvent.click(await findTreeItemByLabel(utils!, "data.csv"));
		});

		expect(openFile).toHaveBeenCalledWith({
			panel: "central",
			fileId: "file_csv",
			filePath: "/data.csv",
			focus: false,
		});

		utils!.unmount();
		await lix.close();
	});

	test("asks the host to open unsupported files", async () => {
		const lix = await openLix();
		const openFile = vi.fn();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_txt",
				path: "/notes.txt",
				data: new TextEncoder().encode("hello"),
			})
			.execute();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { openFile })} />
					</Suspense>
				</LixProvider>,
			);
		});

		await findTreeItemByLabel(utils!, "notes.txt");

		await act(async () => {
			fireEvent.click(await findTreeItemByLabel(utils!, "notes.txt"));
		});

		expect(openFile).toHaveBeenCalledWith({
			panel: "central",
			fileId: "file_txt",
			filePath: "/notes.txt",
			focus: false,
		});

		utils!.unmount();
		await lix.close();
	});

	test("marks files with pending external write reviews", async () => {
		const lix = await openLix();
		try {
			await qb(lix)
				.insertInto("lix_directory")
				.values({ path: "/docs/" } as any)
				.execute();
			await writeReviewFile(lix, "file_review", "/docs/review.md", "before");
			await writeReviewFile(lix, "file_clean", "/docs/clean.md", "same");
			const beforeCommitId = await activeCommitId(lix);
			await writeReviewFile(lix, "file_review", "/docs/review.md", "after");
			await writeReviewFile(lix, "file_clean", "/docs/clean.md", "same");
			const afterCommitId = await activeCommitId(lix);
			await appendAgentTurnCommitRange(
				lix,
				agentRange({
					id: "range-files-tree-review",
					beforeCommitId,
					afterCommitId,
				}),
			);

			let utils: ReturnType<typeof render>;
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<FilesView context={createViewContext(lix)} />
						</Suspense>
					</LixProvider>,
				);
			});

			await findTreeItemByLabel(utils!, "docs");
			await act(async () => {
				fireEvent.click(await findTreeItemByLabel(utils!, "docs"));
			});

			await waitFor(() => {
				expect(queryTreeItemByLabel(utils!, "review.md")).toHaveAttribute(
					"data-item-git-status",
					"modified",
				);
			});
			expect(queryTreeItemByLabel(utils!, "clean.md")).not.toHaveAttribute(
				"data-item-git-status",
			);
			expect(queryTreeItemByLabel(utils!, "docs")).toHaveAttribute(
				"data-item-contains-git-change",
				"true",
			);

			utils!.unmount();
		} finally {
			await lix.close();
		}
	});

	test("marks checkpoint diff files and opens virtual paths as checkpoint tabs", async () => {
		const lix = await openLix();
		const openFile = vi.fn();
		try {
			await qb(lix)
				.insertInto("lix_directory")
				.values({ path: "/docs/" } as any)
				.execute();
			await writeReviewFile(lix, "file_live", "/docs/live.md", "after");

			let utils: ReturnType<typeof render>;
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<FilesView
								context={createViewContext(lix, {
									openFile,
									checkpointDiff: checkpointDiff({
										files: [
											checkpointDiffFile({
												fileId: "file_live",
												path: "/docs/live.md",
												reviewId: "checkpoint:live",
											}),
											checkpointDiffFile({
												fileId: "file_added",
												path: "/docs/added.md",
												reviewId: "checkpoint:added",
												status: "added",
											}),
										],
									}),
								})}
							/>
						</Suspense>
					</LixProvider>,
				);
			});

			await findTreeItemByLabel(utils!, "docs");
			await act(async () => {
				fireEvent.click(await findTreeItemByLabel(utils!, "docs"));
			});

			await waitFor(() => {
				expect(queryTreeItemByLabel(utils!, "live.md")).toHaveAttribute(
					"data-item-git-status",
					"modified",
				);
				expect(queryTreeItemByLabel(utils!, "added.md")).toHaveAttribute(
					"data-item-git-status",
					"modified",
				);
			});

			await act(async () => {
				fireEvent.click(await findTreeItemByLabel(utils!, "added.md"));
			});

			expect(openFile).toHaveBeenCalledWith({
				panel: "central",
				fileId: "file_added",
				filePath: "/docs/added.md",
				state: {
					checkpointDiffReviewId: "checkpoint:added",
					checkpointDiffBranchId: "checkpoint-after",
				},
				focus: false,
				trackTelemetry: false,
				trackDocumentOpenAttempt: false,
				trackDocumentViewed: false,
			});

			utils!.unmount();
		} finally {
			await lix.close();
		}
	});

	test("does not delete selected checkpoint diff files", async () => {
		const lix = await openLix();
		try {
			await writeReviewFile(lix, "file_live", "/live.md", "after");

			let utils: ReturnType<typeof render>;
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<FilesView
								context={createViewContext(lix, {
									checkpointDiff: checkpointDiff({
										files: [
											checkpointDiffFile({
												fileId: "file_live",
												path: "/live.md",
												reviewId: "checkpoint:live",
											}),
										],
									}),
								})}
							/>
						</Suspense>
					</LixProvider>,
				);
			});

			await findTreeItemByLabel(utils!, "live.md");
			await act(async () => {
				fireEvent.click(await findTreeItemByLabel(utils!, "live.md"));
			});
			await act(async () => {
				fireEvent.keyDown(document, { key: "Backspace", metaKey: true });
			});

			const row = await qb(lix)
				.selectFrom("lix_file")
				.select("path")
				.where("id", "=", "file_live")
				.executeTakeFirst();
			expect(row?.path).toBe("/live.md");

			utils!.unmount();
		} finally {
			await lix.close();
		}
	});

	test("watches transient directories on demand and delegates watched-only file opens", async () => {
		const lix = await openLix();
		const originalDesktop = window.flashtypeDesktop;
		const openFile = vi.fn();
		const rootEntries = [
			{
				id: "watched:/docs/",
				parent_id: null,
				path: "/docs/",
				display_name: "docs",
				kind: "directory" as const,
				source: "watched" as const,
			},
			{
				id: "watched:/notes.txt",
				parent_id: null,
				path: "/notes.txt",
				display_name: "notes.txt",
				kind: "file" as const,
				source: "watched" as const,
			},
		];
		const nestedEntries = [
			...rootEntries,
			{
				id: "watched:/docs/nested.txt",
				parent_id: "watched:/docs/",
				path: "/docs/nested.txt",
				display_name: "nested.txt",
				kind: "file" as const,
				source: "watched" as const,
			},
		];
		const setEphemeralWatchedDirectories = vi.fn(
			async ({ paths }: { paths: string[] }) =>
				paths.includes("/docs/") ? nestedEntries : rootEntries,
		);
		window.flashtypeDesktop = {
			workspace: {
				setEphemeralWatchedDirectories,
				onEphemeralWatchedFileTreeChanged: vi.fn(() => () => {}),
			},
		} as unknown as Window["flashtypeDesktop"];

		let utils: ReturnType<typeof render>;
		let cleanup: (() => void) | undefined;
		try {
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<FilesView
								context={createViewContext(lix, {
									openFile,
									viewInstance: "files-view-test",
									workspace: {
										ephemeral: true,
										path: "/workspace",
										name: "workspace",
										openFilePaths: [],
									},
								})}
							/>
						</Suspense>
					</LixProvider>,
				);
				cleanup = () => utils.unmount();
			});

			await findTreeItemByLabel(utils!, "docs");
			await findTreeItemByLabel(utils!, "notes.txt");
			expect(setEphemeralWatchedDirectories).toHaveBeenCalledWith({
				ownerId: "files-view:files-view-test",
				paths: ["/"],
			});

			await act(async () => {
				fireEvent.click(await findTreeItemByLabel(utils!, "docs"));
			});
			await waitFor(() => {
				expect(setEphemeralWatchedDirectories).toHaveBeenCalledWith({
					ownerId: "files-view:files-view-test",
					paths: ["/", "/docs/"],
				});
				expect(queryTreeItemByLabel(utils!, "nested.txt")).toBeInTheDocument();
			});

			await act(async () => {
				fireEvent.click(await findTreeItemByLabel(utils!, "nested.txt"));
			});

			await waitFor(async () => {
				const file = await qb(lix)
					.selectFrom("lix_file")
					.select(["id", "path", "data"])
					.where("path", "=", "/docs/nested.txt")
					.executeTakeFirst();
				expect(file).toBeUndefined();
				expect(openFile).toHaveBeenCalledWith({
					panel: "central",
					fileId: "watched:/docs/nested.txt",
					filePath: "/docs/nested.txt",
					focus: false,
				});
			});

			await act(async () => {
				fireEvent.click(await findTreeItemByLabel(utils!, "docs"));
			});
			await waitFor(() => {
				expect(setEphemeralWatchedDirectories).toHaveBeenLastCalledWith({
					ownerId: "files-view:files-view-test",
					paths: ["/"],
				});
				expect(queryTreeItemByLabel(utils!, "nested.txt")).toBeNull();
			});
		} finally {
			cleanup?.();
			window.flashtypeDesktop = originalDesktop;
			await lix.close();
		}
	});

	test("Cmd+Backspace deletes the selected directory", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_directory")
			.values({ path: "/docs/" } as any)
			.execute();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView />
					</Suspense>
				</LixProvider>,
			);
		});

		await findTreeItemByLabel(utils!, "docs");

		await act(async () => {
			fireEvent.click(await findTreeItemByLabel(utils!, "docs"));
		});

		await act(async () => {
			fireEvent.keyDown(document, { key: "Backspace", metaKey: true });
		});

		await waitFor(async () => {
			const rows = await qb(lix)
				.selectFrom("lix_directory")
				.select(["path"])
				.execute();
			expect(rows.some((row) => row.path === "/docs/")).toBe(false);
		});

		await waitFor(() => {
			expect(queryTreeItemByLabel(utils!, "docs")).toBeNull();
		});

		utils!.unmount();
		await lix.close();
	});

	test("hides dot-prefixed files and folder descendants", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_directory")
			.values({ path: "/.hidden-folder/" } as any)
			.execute();
		await qb(lix)
			.insertInto("lix_file")
			.values([
				{
					id: "visible_file",
					path: "/visible.md",
					data: new Uint8Array(),
				},
				{
					id: "dot_file",
					path: "/.hidden.md",
					data: new Uint8Array(),
				},
				{
					id: "dot_folder_child",
					path: "/.hidden-folder/inside.md",
					data: new Uint8Array(),
				},
			])
			.execute();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView />
					</Suspense>
				</LixProvider>,
			);
		});

		await waitFor(() => {
			expect(queryTreeItemByLabel(utils!, "visible.md")).toBeInTheDocument();
			expect(queryTreeItemByLabel(utils!, ".hidden.md")).toBeNull();
			expect(queryTreeItemByLabel(utils!, ".hidden-folder")).toBeNull();
			expect(queryTreeItemByLabel(utils!, "inside.md")).toBeNull();
		});

		utils!.unmount();
		await lix.close();
	});

	test("lists ephemeral watched directories and delegates watched-only file opens", async () => {
		const lix = await openLix();
		const originalDesktop = window.flashtypeDesktop;
		const openFile = vi.fn();
		const rootEntries = [
			{
				id: "watched:/docs/",
				parent_id: null,
				path: "/docs/",
				display_name: "docs",
				kind: "directory" as const,
				source: "watched" as const,
			},
			{
				id: "watched:/loose.txt",
				parent_id: null,
				path: "/loose.txt",
				display_name: "loose.txt",
				kind: "file" as const,
				source: "watched" as const,
			},
		];
		const nestedEntries = [
			...rootEntries,
			{
				id: "watched:/docs/nested.txt",
				parent_id: "watched:/docs/",
				path: "/docs/nested.txt",
				display_name: "nested.txt",
				kind: "file" as const,
				source: "watched" as const,
			},
		];
		const setEphemeralWatchedDirectories = vi.fn(
			async ({ paths }: { paths: string[] }) =>
				paths.includes("/docs/") ? nestedEntries : rootEntries,
		);
		window.flashtypeDesktop = {
			workspace: {
				setEphemeralWatchedDirectories,
				onEphemeralWatchedFileTreeChanged: vi.fn(() => () => {}),
			},
		} as unknown as Window["flashtypeDesktop"];

		let utils: ReturnType<typeof render>;
		try {
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<FilesView
								context={createViewContext(lix, {
									openFile,
									viewInstance: "files-test",
									workspace: {
										ephemeral: true,
										path: "/tmp/workspace",
										name: "workspace",
										openFilePaths: [],
									},
								})}
							/>
						</Suspense>
					</LixProvider>,
				);
			});

			await findTreeItemByLabel(utils!, "docs");
			await findTreeItemByLabel(utils!, "loose.txt");
			expect(setEphemeralWatchedDirectories).toHaveBeenCalledWith({
				ownerId: "files-view:files-test",
				paths: ["/"],
			});

			await act(async () => {
				fireEvent.click(await findTreeItemByLabel(utils!, "docs"));
			});
			await waitFor(() => {
				expect(queryTreeItemByLabel(utils!, "nested.txt")).toBeInTheDocument();
			});
			expect(setEphemeralWatchedDirectories).toHaveBeenCalledWith({
				ownerId: "files-view:files-test",
				paths: ["/", "/docs/"],
			});

			await act(async () => {
				fireEvent.click(await findTreeItemByLabel(utils!, "loose.txt"));
			});

			await waitFor(async () => {
				const row = await qb(lix)
					.selectFrom("lix_file")
					.select(["id", "path"])
					.where("path", "=", "/loose.txt")
					.executeTakeFirst();
				expect(row).toBeUndefined();
				expect(openFile).toHaveBeenCalledWith({
					panel: "central",
					fileId: "watched:/loose.txt",
					filePath: "/loose.txt",
					focus: false,
				});
			});

			utils!.unmount();
		} finally {
			window.flashtypeDesktop = originalDesktop;
			await lix.close();
		}
	});

	test("renames watched-only files by importing them into Lix", async () => {
		const lix = await openLix();
		const originalDesktop = window.flashtypeDesktop;
		const openFile = vi.fn();
		const importFilesystemPaths = vi
			.spyOn(lix, "importFilesystemPaths")
			.mockImplementation(async ([path]) => {
				if (!path) return;
				await qb(lix)
					.insertInto("lix_file")
					.values({
						id: "imported_loose",
						path,
						data: new TextEncoder().encode("from disk"),
					})
					.execute();
			});
		const rootEntries = [
			{
				id: "watched:/loose.txt",
				parent_id: null,
				path: "/loose.txt",
				display_name: "loose.txt",
				kind: "file" as const,
				source: "watched" as const,
			},
		];
		const setEphemeralWatchedDirectories = vi.fn(async () => rootEntries);
		window.flashtypeDesktop = {
			workspace: {
				setEphemeralWatchedDirectories,
				onEphemeralWatchedFileTreeChanged: vi.fn(() => () => {}),
			},
		} as unknown as Window["flashtypeDesktop"];

		let utils: ReturnType<typeof render>;
		try {
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<FilesView
								context={createViewContext(lix, {
									openFile,
									viewInstance: "files-rename-watched",
									workspace: {
										ephemeral: true,
										path: "/tmp/workspace",
										name: "workspace",
										openFilePaths: [],
									},
								})}
							/>
						</Suspense>
					</LixProvider>,
				);
			});

			await findTreeItemByLabel(utils!, "loose.txt");
			const input = await startTreeRenameByLabel(utils!, "loose.txt");
			expect(input.value).toBe("loose.txt");
			openFile.mockClear();

			await act(async () => {
				fireEvent.input(input, { target: { value: "renamed.txt" } });
			});
			await act(async () => {
				fireEvent.keyDown(input, { key: "Enter" });
			});

			await waitFor(async () => {
				const rows = await qb(lix)
					.selectFrom("lix_file")
					.select(["id", "path", "data"])
					.execute();
				expect(rows.some((row) => row.path === "/loose.txt")).toBe(false);
				expect(
					rows.some(
						(row) => row.id === "imported_loose" && row.path === "/renamed.txt",
					),
				).toBe(true);
				expect(queryTreeItemByLabel(utils!, "loose.txt")).toBeNull();
				expect(queryTreeItemByLabel(utils!, "renamed.txt")).toBeInTheDocument();
			});
			expect(importFilesystemPaths).toHaveBeenCalledWith(["/loose.txt"]);
			expect(openFile).toHaveBeenCalledWith({
				panel: "central",
				fileId: "imported_loose",
				filePath: "/renamed.txt",
				focus: false,
				trackTelemetry: false,
			});

			utils!.unmount();
		} finally {
			window.flashtypeDesktop = originalDesktop;
			await lix.close();
		}
	});

	test("renders the file tree inside a vertical scroll region", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values(
				Array.from({ length: 20 }, (_, index) => ({
					id: `file_${index}`,
					path: `/file-${String(index + 1).padStart(2, "0")}.md`,
					data: new Uint8Array(),
				})),
			)
			.execute();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView />
					</Suspense>
				</LixProvider>,
			);
		});

		await findTreeItemByLabel(utils!, "file-01.md");

		const scrollRegion = utils!.getByTestId("files-view-tree-scroll");
		expect(scrollRegion).toHaveClass("min-h-0");
		expect(scrollRegion).toHaveClass("flex-1");
		expect(scrollRegion).toHaveClass("overflow-y-auto");
		expect(scrollRegion).toHaveClass("overflow-x-hidden");

		utils!.unmount();
		await lix.close();
	});

	test("replaces whitespace with dashes when creating files", async () => {
		const lix = await openLix();
		const openExtension = vi.fn();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { openExtension })} />
					</Suspense>
				</LixProvider>,
			);
		});
		await waitForFilesViewReady(utils!);

		await waitForFilesViewReady(utils!);

		await act(async () => {
			fireEvent.keyDown(document, { key: ".", metaKey: true });
		});

		const input = await findTreeRenameInput(utils!);
		await act(async () => {
			fireEvent.input(input, { target: { value: "hello nice one" } });
		});

		await act(async () => {
			fireEvent.keyDown(input, { key: "Enter" });
		});

		await waitFor(async () => {
			const rows = await qb(lix)
				.selectFrom("lix_file")
				.select(["path"])
				.execute();
			const userRows = rows.filter((row) => isUserPath(row.path));
			expect(userRows).toHaveLength(1);
			expect(userRows[0]?.path).toBe("/hello-nice-one.md");
		});

		await findTreeItemByLabel(utils!, "hello-nice-one.md");

		utils!.unmount();
		await lix.close();
	});

	test("creates an inline directory draft when Shift+Cmd+. is pressed", async () => {
		const lix = await openLix();
		const openExtension = vi.fn();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { openExtension })} />
					</Suspense>
				</LixProvider>,
			);
		});
		await waitForFilesViewReady(utils!);

		await waitForFilesViewReady(utils!);

		await act(async () => {
			fireEvent.keyDown(document, {
				key: ">",
				code: "Period",
				metaKey: true,
				shiftKey: true,
			});
		});

		const input = await findTreeRenameInput(utils!);
		expect(input.value).toBe("new-directory");

		await act(async () => {
			fireEvent.input(input, { target: { value: "docs" } });
		});

		await act(async () => {
			fireEvent.keyDown(input, { key: "Enter" });
		});

		await waitFor(async () => {
			const rows = await qb(lix)
				.selectFrom("lix_directory")
				.select(["path"])
				.execute();
			expect(rows.some((row) => row.path === "/docs/")).toBe(true);
		});

		expect(openExtension).not.toHaveBeenCalled();

		utils!.unmount();
		await lix.close();
	});

	test("ignores Ctrl+. on macOS", async () => {
		const lix = await openLix();
		const openExtension = vi.fn();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { openExtension })} />
					</Suspense>
				</LixProvider>,
			);
		});
		await waitForFilesViewReady(utils!);

		await waitForFilesViewReady(utils!);

		await act(async () => {
			fireEvent.keyDown(document, { key: ".", ctrlKey: true });
		});

		expect(queryTreeRenameInput(utils!)).toBeNull();

		const rows = await qb(lix)
			.selectFrom("lix_file")
			.select(["path"])
			.execute();
		expect(rows.filter((row) => isUserPath(row.path))).toHaveLength(0);
		expect(openExtension).not.toHaveBeenCalled();

		utils!.unmount();
		await lix.close();
	});

	test("ignores Ctrl+Shift+. on macOS", async () => {
		const lix = await openLix();
		const openExtension = vi.fn();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { openExtension })} />
					</Suspense>
				</LixProvider>,
			);
		});
		await waitForFilesViewReady(utils!);

		await waitForFilesViewReady(utils!);

		await act(async () => {
			fireEvent.keyDown(document, {
				key: ">",
				code: "Period",
				ctrlKey: true,
				shiftKey: true,
			});
		});

		expect(queryTreeRenameInput(utils!)).toBeNull();

		const rows = await qb(lix)
			.selectFrom("lix_directory")
			.select(["path"])
			.execute();
		expect(rows.filter((row) => isUserPath(row.path))).toHaveLength(0);
		expect(openExtension).not.toHaveBeenCalled();

		utils!.unmount();
		await lix.close();
	});

	test("cancels the draft when Escape is pressed", async () => {
		const lix = await openLix();
		const openExtension = vi.fn();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { openExtension })} />
					</Suspense>
				</LixProvider>,
			);
		});
		await waitForFilesViewReady(utils!);

		await waitForFilesViewReady(utils!);

		await act(async () => {
			fireEvent.keyDown(document, { key: ".", metaKey: true });
		});

		const input = await findTreeRenameInput(utils!);

		await act(async () => {
			fireEvent.keyDown(input, { key: "Escape" });
		});

		await waitFor(() => {
			expect(queryTreeRenameInput(utils!)).toBeNull();
		});

		const rows = await qb(lix)
			.selectFrom("lix_file")
			.select(["path"])
			.execute();
		expect(rows.filter((row) => isUserPath(row.path))).toHaveLength(0);
		expect(openExtension).not.toHaveBeenCalled();

		utils!.unmount();
		await lix.close();
	});
});

async function writeReviewFile(
	lix: Awaited<ReturnType<typeof openLix>>,
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

async function activeCommitId(
	lix: Awaited<ReturnType<typeof openLix>>,
): Promise<string> {
	const result = await lix.execute(
		"SELECT lix_active_branch_commit_id() AS commit_id",
	);
	const commitId = result.rows[0]?.get("commit_id");
	if (typeof commitId !== "string") {
		throw new Error("Missing active commit id");
	}
	return commitId;
}

function agentRange(
	overrides: Pick<
		AgentTurnCommitRange,
		"id" | "beforeCommitId" | "afterCommitId"
	>,
): AgentTurnCommitRange {
	return {
		agent: "codex",
		sessionId: "session-1",
		turnId: "turn-1",
		startedAt: 1,
		completedAt: 2,
		...overrides,
	};
}

function checkpointDiff(
	overrides: Partial<CheckpointDiff> = {},
): CheckpointDiff {
	return {
		branchId: "checkpoint-after",
		branchName: "After",
		beforeBranchId: "checkpoint-before",
		beforeBranchName: "Before",
		beforeCommitId: "before-commit",
		afterCommitId: "after-commit",
		files: [],
		...overrides,
	};
}

function checkpointDiffFile(
	overrides: Partial<CheckpointDiffFile> &
		Pick<CheckpointDiffFile, "fileId" | "path" | "reviewId">,
): CheckpointDiffFile {
	const { fileId, path, reviewId, ...rest } = overrides;
	return {
		fileId,
		path,
		beforePath: path,
		afterPath: path,
		beforeData: new TextEncoder().encode("before"),
		afterData: new TextEncoder().encode("after"),
		beforeCommitId: "before-commit",
		afterCommitId: "after-commit",
		reviewId,
		status: "modified",
		...rest,
	};
}
