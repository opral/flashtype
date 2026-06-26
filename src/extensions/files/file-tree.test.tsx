import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { FilesystemTreeNode } from "@/extensions/files/build-filesystem-tree";
import { FileTree } from "./file-tree";

describe("FileTree", () => {
	test("renders directories and files", () => {
		render(<FileTree nodes={mockTree} />);

		expect(screen.getByText("docs")).toBeInTheDocument();
		expect(screen.queryByText("guides")).toBeNull();
		expect(screen.queryByText("writing-style.md")).toBeNull();
	});

	test("starts directories collapsed", () => {
		render(<FileTree nodes={mockTree} />);

		const docsToggle = screen.getByRole("button", { name: /docs/i });
		expect(docsToggle).toHaveAttribute("aria-expanded", "false");
		expect(screen.queryByText("README.md")).toBeNull();
	});

	test("expands and collapses directories", () => {
		render(<FileTree nodes={mockTree} />);

		const docsToggle = screen.getByRole("button", { name: /docs/i });
		fireEvent.click(docsToggle);

		expect(screen.getByText("guides")).toBeInTheDocument();

		fireEvent.click(docsToggle);
		expect(screen.queryByText("guides")).toBeNull();
	});

	test("supports controlled opened directories", () => {
		const handleOpenDirectoriesChange = vi.fn();
		const { rerender } = render(
			<FileTree
				nodes={mockTree}
				openDirectories={new Set<string>()}
				onOpenDirectoriesChange={handleOpenDirectoriesChange}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /docs/i }));

		expect(handleOpenDirectoriesChange).toHaveBeenCalledWith(
			new Set(["/docs"]),
		);
		expect(screen.queryByText("guides")).toBeNull();

		rerender(
			<FileTree
				nodes={mockTree}
				openDirectories={new Set(["/docs"])}
				onOpenDirectoriesChange={handleOpenDirectoriesChange}
			/>,
		);
		expect(screen.getByText("guides")).toBeInTheDocument();
	});

	test("preserves opened directories when the tree data refreshes", () => {
		const { rerender } = render(<FileTree nodes={mockTree} />);

		const docsToggle = screen.getByRole("button", { name: /docs/i });
		fireEvent.click(docsToggle);
		const guidesToggle = screen.getByRole("button", { name: /guides/i });
		fireEvent.click(guidesToggle);

		expect(screen.getByText("writing-style.md")).toBeInTheDocument();

		rerender(<FileTree nodes={mockTreeWithExternalFile} />);

		expect(screen.getByText("guides")).toBeInTheDocument();
		expect(screen.getByText("external.md")).toBeInTheDocument();
	});

	test("preserves collapsed directories when the tree data refreshes", () => {
		const { rerender } = render(<FileTree nodes={mockTree} />);

		expect(screen.queryByText("guides")).toBeNull();

		rerender(<FileTree nodes={mockTreeWithExternalFile} />);

		expect(screen.queryByText("guides")).toBeNull();
		expect(screen.queryByText("external.md")).toBeNull();
		expect(screen.getByRole("button", { name: /docs/i })).toHaveAttribute(
			"aria-expanded",
			"false",
		);
	});

	test("reports controlled open directory changes", () => {
		const handleOpenDirectoriesChange = vi.fn();
		const { rerender } = render(
			<FileTree
				nodes={mockTree}
				openDirectories={new Set()}
				onOpenDirectoriesChange={handleOpenDirectoriesChange}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /docs/i }));
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
		fireEvent.click(screen.getByRole("button", { name: /docs/i }));
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
		render(<FileTree nodes={nodes} openFileView={handleOpen} />);

		fireEvent.click(screen.getByRole("button", { name: /README.md/i }));

		expect(handleOpen).toHaveBeenCalledWith("file-readme", "/README.md");
	});

	test("keeps focus styling on file tree rows instead of filename labels", () => {
		render(<FileTree nodes={mockTree} />);
		fireEvent.click(screen.getByRole("button", { name: /docs/i }));

		const fileRow = screen.getByRole("button", { name: /README.md/i });
		const fileName = screen.getByText("README.md");

		expect(fileRow).toHaveClass(
			"focus-visible:ring-[var(--color-ring-focus-visible)]",
		);
		expect(fileRow).toHaveClass("select-none");
		expect(fileName).not.toHaveClass(
			"focus-visible:ring-[var(--color-ring-focus-visible)]",
		);
	});

	test("renders percent text literally instead of URI-decoding filenames", () => {
		render(
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

		expect(screen.getByText("%61.md")).toBeInTheDocument();
		expect(screen.queryByText("a.md")).toBeNull();
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

		const { rerender } = render(
			<FileTree
				nodes={nodes}
				selectedPath="/README.md"
				isPanelFocused={true}
			/>,
		);
		const selectedFile = screen.getByRole("button", { name: /README.md/i });
		expect(selectedFile).toHaveClass("bg-[var(--color-bg-selection-current)]");
		expect(selectedFile).toHaveClass(
			"ring-[var(--color-border-selection-current)]",
		);

		rerender(
			<FileTree
				nodes={nodes}
				selectedPath="/README.md"
				isPanelFocused={false}
			/>,
		);
		expect(selectedFile).toHaveClass("bg-[var(--color-bg-hover)]");
		expect(selectedFile).not.toHaveClass(
			"bg-[var(--color-bg-selection-current)]",
		);
		expect(selectedFile).not.toHaveClass(
			"ring-[var(--color-border-selection-current)]",
		);
	});
});

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
