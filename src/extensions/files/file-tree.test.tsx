import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { FilesystemTreeNode } from "@/extensions/files/build-filesystem-tree";
import { FileTree } from "./file-tree";

describe("FileTree", () => {
	test("renders directories and files", () => {
		render(<FileTree nodes={mockTree} />);

		expect(screen.getByText("docs")).toBeInTheDocument();
		expect(screen.getByText("guides")).toBeInTheDocument();
		expect(screen.getByText("writing-style.md")).toBeInTheDocument();
	});

	test("collapses and expands directories", () => {
		render(<FileTree nodes={mockTree} />);

		const docsToggle = screen.getByRole("button", { name: /docs/i });
		fireEvent.click(docsToggle);

		expect(screen.queryByText("guides")).toBeNull();

		fireEvent.click(docsToggle);
		expect(screen.getByText("guides")).toBeInTheDocument();
	});

	test("preserves collapsed directories when the tree data refreshes", () => {
		const { rerender } = render(<FileTree nodes={mockTree} />);

		fireEvent.click(screen.getByRole("button", { name: /docs/i }));
		expect(screen.queryByText("guides")).toBeNull();

		rerender(<FileTree nodes={mockTreeWithExternalFile} />);

		expect(screen.queryByText("guides")).toBeNull();
		expect(screen.queryByText("external.md")).toBeNull();
		expect(screen.getByRole("button", { name: /docs/i })).toHaveAttribute(
			"aria-expanded",
			"false",
		);
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
		expect(selectedFile).toHaveClass("bg-focus-tint");
		expect(selectedFile).toHaveClass("ring-focus-ring");

		rerender(
			<FileTree
				nodes={nodes}
				selectedPath="/README.md"
				isPanelFocused={false}
			/>,
		);
		expect(selectedFile).toHaveClass("bg-hover-soft");
		expect(selectedFile).not.toHaveClass("bg-focus-tint");
		expect(selectedFile).not.toHaveClass("ring-focus-ring");
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
