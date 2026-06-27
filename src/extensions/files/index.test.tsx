import React, { Suspense } from "react";
import { beforeAll, afterAll, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { FilesView } from "./index";
import type { ExtensionContext } from "../../extension-runtime/types";
import { qb } from "@/lib/lix-kysely";

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

		const input = (await utils!.findByTestId(
			"files-view-draft-input",
		)) as HTMLInputElement;
		expect(input.value).toBe("new-file");

		await act(async () => {
			fireEvent.change(input, { target: { value: "notes" } });
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

		const input = (await utils!.findByTestId(
			"files-view-draft-input",
		)) as HTMLInputElement;
		await waitFor(() => {
			expect(document.activeElement).toBe(input);
		});
		expect(input.value).toBe("new-file");
		expect(focusPanel).not.toHaveBeenCalled();

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

		await waitFor(() => {
			expect(utils!.getByText("hello.md")).toBeInTheDocument();
		});

		await act(async () => {
			fireEvent.click(utils!.getByText("hello.md"));
		});

		await act(async () => {
			fireEvent.keyDown(utils!.getByTestId("file-tree-item-hello-md"), {
				key: "Backspace",
				metaKey: true,
			});
		});

		await waitFor(async () => {
			const rows = await qb(lix)
				.selectFrom("lix_file")
				.select(["path"])
				.execute();
			expect(rows.filter((row) => isUserPath(row.path))).toHaveLength(0);
		});

		await waitFor(() => {
			expect(utils!.queryByText("hello.md")).toBeNull();
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
		const input = (await utils!.findByTestId(
			"files-view-draft-input",
		)) as HTMLInputElement;
		await act(async () => {
			fireEvent.change(input, { target: { value: "fresh" } });
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

		const file = await utils!.findByText("keep.md");
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

		const file = await utils!.findByText("spaces.md");
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

		const file = await utils!.findByText("rule.md");
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

		await waitFor(() => {
			expect(utils!.getByText("data.csv")).toBeInTheDocument();
		});

		await act(async () => {
			fireEvent.click(utils!.getByText("data.csv"));
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

		await waitFor(() => {
			expect(utils!.getByText("notes.txt")).toBeInTheDocument();
		});

		await act(async () => {
			fireEvent.click(utils!.getByText("notes.txt"));
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

			await waitFor(() => {
				expect(utils!.getByText("docs")).toBeInTheDocument();
				expect(utils!.getByText("notes.txt")).toBeInTheDocument();
			});
			expect(setEphemeralWatchedDirectories).toHaveBeenCalledWith({
				ownerId: "files-view:files-view-test",
				paths: ["/"],
			});

			await act(async () => {
				fireEvent.click(utils!.getByText("docs"));
			});
			await waitFor(() => {
				expect(setEphemeralWatchedDirectories).toHaveBeenCalledWith({
					ownerId: "files-view:files-view-test",
					paths: ["/", "/docs/"],
				});
				expect(utils!.getByText("nested.txt")).toBeInTheDocument();
			});

			await act(async () => {
				fireEvent.click(utils!.getByText("nested.txt"));
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
				fireEvent.click(utils!.getByText("docs"));
			});
			await waitFor(() => {
				expect(setEphemeralWatchedDirectories).toHaveBeenLastCalledWith({
					ownerId: "files-view:files-view-test",
					paths: ["/"],
				});
				expect(utils!.queryByText("nested.txt")).toBeNull();
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

		await waitFor(() => {
			expect(utils!.getByText("docs")).toBeInTheDocument();
		});

		await act(async () => {
			fireEvent.click(utils!.getByText("docs"));
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
			expect(utils!.queryByText("docs")).toBeNull();
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
			expect(utils!.getByText("visible.md")).toBeInTheDocument();
			expect(utils!.queryByText(".hidden.md")).toBeNull();
			expect(utils!.queryByText(".hidden-folder")).toBeNull();
			expect(utils!.queryByText("inside.md")).toBeNull();
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

			await waitFor(() => {
				expect(utils!.getByText("docs")).toBeInTheDocument();
				expect(utils!.getByText("loose.txt")).toBeInTheDocument();
			});
			expect(setEphemeralWatchedDirectories).toHaveBeenCalledWith({
				ownerId: "files-view:files-test",
				paths: ["/"],
			});

			await act(async () => {
				fireEvent.click(utils!.getByText("docs"));
			});
			await waitFor(() => {
				expect(utils!.getByText("nested.txt")).toBeInTheDocument();
			});
			expect(setEphemeralWatchedDirectories).toHaveBeenCalledWith({
				ownerId: "files-view:files-test",
				paths: ["/", "/docs/"],
			});

			await act(async () => {
				fireEvent.click(utils!.getByText("loose.txt"));
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

		await waitFor(() => {
			expect(utils!.getByText("file-01.md")).toBeInTheDocument();
		});

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

		const input = (await utils!.findByTestId(
			"files-view-draft-input",
		)) as HTMLInputElement;
		await act(async () => {
			fireEvent.change(input, { target: { value: "hello nice one" } });
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

		await waitFor(() => {
			expect(utils!.getByText("hello-nice-one.md")).toBeInTheDocument();
		});

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

		const input = (await utils!.findByTestId(
			"files-view-draft-input",
		)) as HTMLInputElement;
		expect(input.value).toBe("new-directory");

		await act(async () => {
			fireEvent.change(input, { target: { value: "docs" } });
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

		expect(utils!.queryByTestId("files-view-draft-input")).toBeNull();

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

		expect(utils!.queryByTestId("files-view-draft-input")).toBeNull();

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

		const input = (await utils!.findByTestId(
			"files-view-draft-input",
		)) as HTMLInputElement;

		await act(async () => {
			fireEvent.keyDown(input, { key: "Escape" });
		});

		await waitFor(() => {
			expect(utils!.queryByTestId("files-view-draft-input")).toBeNull();
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
