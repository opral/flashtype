import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { FilesystemTreeNode } from "@/extensions/files/build-filesystem-tree";
import { FileTree } from "./file-tree";

describe("FileTree", () => {
	test("renders directories and files", () => {
		const { container } = render(<FileTree nodes={mockTree} />);

		expect(getTreeItem(container, "docs/")).toHaveTextContent("docs");
		expect(queryTreeItem(container, "docs/guides/")).toBeNull();
		expect(queryTreeItem(container, "docs/guides/writing-style.md")).toBeNull();
	});

	test("starts directories collapsed", () => {
		const { container } = render(<FileTree nodes={mockTree} />);

		const docsToggle = getTreeItem(container, "docs/");
		expect(docsToggle).toHaveAttribute("aria-expanded", "false");
		expect(queryTreeItem(container, "docs/README.md")).toBeNull();
	});

	test("expands and collapses directories", async () => {
		const { container } = render(<FileTree nodes={mockTree} />);

		const docsToggle = getTreeItem(container, "docs/");
		fireEvent.click(docsToggle);

		await waitFor(() => {
			expect(getTreeItem(container, "docs/guides/")).toHaveAttribute(
				"aria-label",
				"guides",
			);
		});

		fireEvent.click(docsToggle);
		await waitFor(() => {
			expect(queryTreeItem(container, "docs/guides/")).toBeNull();
		});
	});

	test("supports controlled opened directories", async () => {
		const handleOpenDirectoriesChange = vi.fn();
		const { container, rerender } = render(
			<FileTree
				nodes={mockTree}
				openDirectories={new Set<string>()}
				onOpenDirectoriesChange={handleOpenDirectoriesChange}
			/>,
		);

		fireEvent.click(getTreeItem(container, "docs/"));

		expect(handleOpenDirectoriesChange).toHaveBeenCalledWith(
			new Set(["/docs"]),
		);
		expect(queryTreeItem(container, "docs/guides/")).toBeNull();

		rerender(
			<FileTree
				nodes={mockTree}
				openDirectories={new Set(["/docs"])}
				onOpenDirectoriesChange={handleOpenDirectoriesChange}
			/>,
		);
		await waitFor(() => {
			expect(getTreeItem(container, "docs/guides/")).toHaveAttribute(
				"aria-label",
				"guides",
			);
		});
	});

	test("preserves opened directories when the tree data refreshes", async () => {
		const { container, rerender } = render(<FileTree nodes={mockTree} />);

		fireEvent.click(getTreeItem(container, "docs/"));
		await waitFor(() => {
			expect(getTreeItem(container, "docs/guides/")).toBeInTheDocument();
		});
		fireEvent.click(getTreeItem(container, "docs/guides/"));

		await waitFor(() => {
			expect(
				getTreeItem(container, "docs/guides/writing-style.md"),
			).toBeInTheDocument();
		});

		rerender(<FileTree nodes={mockTreeWithExternalFile} />);

		await waitFor(() => {
			expect(getTreeItem(container, "docs/guides/")).toBeInTheDocument();
			expect(
				getTreeItem(container, "docs/guides/external.md"),
			).toBeInTheDocument();
		});
	});

	test("preserves collapsed directories when the tree data refreshes", () => {
		const { container, rerender } = render(<FileTree nodes={mockTree} />);

		expect(queryTreeItem(container, "docs/guides/")).toBeNull();

		rerender(<FileTree nodes={mockTreeWithExternalFile} />);

		expect(queryTreeItem(container, "docs/guides/")).toBeNull();
		expect(queryTreeItem(container, "docs/guides/external.md")).toBeNull();
		expect(getTreeItem(container, "docs/")).toHaveAttribute(
			"aria-expanded",
			"false",
		);
	});

	test("reports controlled open directory changes", () => {
		const handleOpenDirectoriesChange = vi.fn();
		const { container, rerender } = render(
			<FileTree
				nodes={mockTree}
				openDirectories={new Set()}
				onOpenDirectoriesChange={handleOpenDirectoriesChange}
			/>,
		);

		fireEvent.click(getTreeItem(container, "docs/"));
		expect([...handleOpenDirectoriesChange.mock.calls.at(-1)![0]]).toEqual([
			"/docs",
		]);

		rerender(
			<FileTree
				nodes={mockTree}
				openDirectories={new Set(["/docs", "/docs/guides"])}
				onOpenDirectoriesChange={handleOpenDirectoriesChange}
			/>,
		);
		fireEvent.click(getTreeItem(container, "docs/"));
		expect([...handleOpenDirectoriesChange.mock.calls.at(-1)![0]]).toEqual([
			"/docs/guides",
		]);
	});

	test("invokes openFileView when a file is selected", () => {
		const nodes: FilesystemTreeNode[] = [
			{
				type: "file",
				id: "file-readme",
				name: "README.md",
				path: "/README.md",
			},
		];

		const handleOpen = vi.fn();
		const { container } = render(
			<FileTree nodes={nodes} openFileView={handleOpen} />,
		);

		fireEvent.click(getTreeItem(container, "README.md"));

		expect(handleOpen).toHaveBeenCalledWith("file-readme", "/README.md");
	});

	test("commits native renames for lix-backed files", async () => {
		const nodes: FilesystemTreeNode[] = [
			{
				type: "file",
				id: "file-readme",
				name: "README.md",
				path: "/README.md",
				source: "lix",
			},
		];
		const handleRenameCommit = vi.fn();
		const { container } = render(
			<FileTree nodes={nodes} onRenameCommit={handleRenameCommit} />,
		);

		const input = await startTreeRename(container, "README.md");
		expect(input.value).toBe("README.md");

		fireEvent.input(input, { target: { value: "notes.md" } });
		fireEvent.keyDown(input, { key: "Enter" });

		await waitFor(() => {
			expect(handleRenameCommit).toHaveBeenCalledWith({
				destinationPath: "/notes.md",
				id: "file-readme",
				kind: "file",
				source: "lix",
				sourcePath: "/README.md",
			});
		});
	});

	test("commits native renames for watched-only files", async () => {
		const nodes: FilesystemTreeNode[] = [
			{
				type: "file",
				id: "watched:/README.md",
				name: "README.md",
				path: "/README.md",
				source: "watched",
			},
		];
		const handleRenameCommit = vi.fn();
		const { container } = render(
			<FileTree nodes={nodes} onRenameCommit={handleRenameCommit} />,
		);

		const input = await startTreeRename(container, "README.md");
		expect(input.value).toBe("README.md");

		fireEvent.input(input, { target: { value: "notes.md" } });
		fireEvent.keyDown(input, { key: "Enter" });

		await waitFor(() => {
			expect(handleRenameCommit).toHaveBeenCalledWith({
				destinationPath: "/notes.md",
				id: "watched:/README.md",
				kind: "file",
				source: "watched",
				sourcePath: "/README.md",
			});
		});
	});

	test("does not start native renames for watched-only directories", async () => {
		const nodes: FilesystemTreeNode[] = [
			{
				type: "directory",
				id: "watched:/docs/",
				name: "docs",
				path: "/docs/",
				source: "watched",
				children: [],
			},
		];
		const handleRenameCommit = vi.fn();
		const { container } = render(
			<FileTree nodes={nodes} onRenameCommit={handleRenameCommit} />,
		);

		fireEvent.click(getTreeItem(container, "docs/"));
		fireEvent.keyDown(
			getTreeRoot(container).activeElement ?? getTreeHost(container),
			{
				key: "F2",
			},
		);

		await waitFor(() => {
			expect(queryTreeRenameInput(container)).toBeNull();
		});
		expect(handleRenameCommit).not.toHaveBeenCalled();
	});

	test("keeps focus state on file tree rows instead of filename labels", async () => {
		const { container } = render(<FileTree nodes={mockTree} />);
		fireEvent.click(getTreeItem(container, "docs/"));

		const fileRow = await waitFor(() =>
			getTreeItem(container, "docs/README.md"),
		);
		const fileName = fileRow.querySelector("[data-item-section='content']");

		expect(fileRow).toHaveAttribute("data-type", "item");
		expect(fileRow).toHaveAttribute("role", "treeitem");
		expect(fileName).not.toHaveAttribute("tabindex");
	});

	test("renders percent text literally instead of URI-decoding filenames", () => {
		const { container } = render(
			<FileTree
				nodes={[
					{
						type: "file",
						id: "file-percent",
						name: "%61.md",
						path: "/%61.md",
					},
				]}
			/>,
		);

		expect(getTreeItem(container, "%61.md")).toHaveAttribute(
			"aria-label",
			"%61.md",
		);
		expect(getTreeRoot(container)).not.toHaveTextContent("a.md");
	});

	test("dims the selected file when the files panel is not focused", () => {
		const nodes: FilesystemTreeNode[] = [
			{
				type: "file",
				id: "file-readme",
				name: "README.md",
				path: "/README.md",
			},
		];

		const { container, rerender } = render(
			<FileTree
				nodes={nodes}
				selectedPath="/README.md"
				isPanelFocused={true}
			/>,
		);
		const host = getTreeHost(container);
		expect(getTreeItem(container, "README.md")).toHaveAttribute(
			"data-item-selected",
			"true",
		);
		expect(host.style.getPropertyValue("--trees-selected-bg-override")).toBe(
			"var(--color-bg-selection-current)",
		);

		rerender(
			<FileTree
				nodes={nodes}
				selectedPath="/README.md"
				isPanelFocused={false}
			/>,
		);
		expect(host.style.getPropertyValue("--trees-selected-bg-override")).toBe(
			"var(--color-bg-hover)",
		);
	});

	test("marks pending review files with the tree status lane", async () => {
		const nodes: FilesystemTreeNode[] = [
			{
				type: "directory",
				id: "dir-docs",
				name: "docs",
				path: "/docs/",
				children: [
					{
						type: "file",
						id: "file-review",
						name: "review.md",
						path: "/docs/review.md",
					},
					{
						type: "file",
						id: "file-clean",
						name: "clean.md",
						path: "/docs/clean.md",
					},
				],
			},
		];

		const { container, rerender } = render(
			<FileTree
				nodes={nodes}
				openDirectories={new Set(["/docs/"])}
				reviewPaths={new Set()}
			/>,
		);

		expect(getTreeItem(container, "docs/review.md")).not.toHaveAttribute(
			"data-item-git-status",
		);

		rerender(
			<FileTree
				nodes={nodes}
				openDirectories={new Set(["/docs/"])}
				reviewPaths={new Set(["/docs/review.md"])}
			/>,
		);

		await waitFor(() => {
			expect(getTreeItem(container, "docs/review.md")).toHaveAttribute(
				"data-item-git-status",
				"modified",
			);
		});
		expect(getTreeItem(container, "docs/")).toHaveAttribute(
			"data-item-contains-git-change",
			"true",
		);
		expect(getTreeItem(container, "docs/clean.md")).not.toHaveAttribute(
			"data-item-git-status",
		);
		expect(
			getTreeItem(container, "docs/review.md").querySelector(
				"[data-item-section='git']",
			),
		).toHaveTextContent("M");
		expect(
			getTreeHost(container).style.getPropertyValue(
				"--trees-git-modified-color-override",
			),
		).toBe("var(--color-warning-600)");
	});
});

function getTreeHost(container: HTMLElement): HTMLElement {
	const host = container.querySelector("file-tree-container");
	if (!(host instanceof HTMLElement)) {
		throw new Error("file tree host not found");
	}
	return host;
}

function getTreeRoot(container: HTMLElement): ShadowRoot {
	const root = getTreeHost(container).shadowRoot;
	if (!root) {
		throw new Error("file tree shadow root not found");
	}
	return root;
}

function getTreeItem(container: HTMLElement, path: string): HTMLElement {
	const item = queryTreeItem(container, path);
	if (!item) {
		const renderedPaths = [
			...getTreeRoot(container).querySelectorAll("[data-type='item']"),
		]
			.map((element) => element.getAttribute("data-item-path"))
			.join(", ");
		throw new Error(
			`file tree item not found: ${path}; rendered: ${renderedPaths}`,
		);
	}
	return item;
}

function queryTreeItem(
	container: HTMLElement,
	path: string,
): HTMLElement | null {
	return getTreeRoot(container).querySelector(
		`[data-type='item'][data-item-path='${CSS.escape(path)}']`,
	);
}

function queryTreeRenameInput(container: HTMLElement): HTMLInputElement | null {
	const input = getTreeRoot(container).querySelector(
		"[data-item-rename-input]",
	);
	return input instanceof HTMLInputElement ? input : null;
}

async function startTreeRename(
	container: HTMLElement,
	path: string,
): Promise<HTMLInputElement> {
	const item = getTreeItem(container, path);
	fireEvent.click(item);
	await waitFor(() => {
		expect(getTreeRoot(container).activeElement).toBe(item);
	});
	fireEvent.keyDown(item, { key: "F2" });
	return waitFor(() => {
		const input = queryTreeRenameInput(container);
		if (!input) {
			throw new Error("file tree rename input not found");
		}
		return input;
	});
}

const mockTree: FilesystemTreeNode[] = [
	{
		type: "directory",
		id: "dir-docs",
		name: "docs",
		path: "/docs",
		children: [
			{
				type: "directory",
				id: "dir-guides",
				name: "guides",
				path: "/docs/guides",
				children: [
					{
						type: "file",
						id: "file-writing",
						name: "writing-style.md",
						path: "/docs/guides/writing-style.md",
					},
				],
			},
			{
				type: "file",
				id: "file-readme",
				name: "README.md",
				path: "/docs/README.md",
			},
		],
	},
];

const mockTreeWithExternalFile: FilesystemTreeNode[] = [
	{
		type: "directory",
		id: "dir-docs",
		name: "docs",
		path: "/docs",
		children: [
			{
				type: "directory",
				id: "dir-guides",
				name: "guides",
				path: "/docs/guides",
				children: [
					{
						type: "file",
						id: "file-external",
						name: "external.md",
						path: "/docs/guides/external.md",
					},
					{
						type: "file",
						id: "file-writing",
						name: "writing-style.md",
						path: "/docs/guides/writing-style.md",
					},
				],
			},
			{
				type: "file",
				id: "file-readme",
				name: "README.md",
				path: "/docs/README.md",
			},
		],
	},
];
