import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { FileText, Folder, FolderOpen } from "lucide-react";
import type { FilesystemTreeNode } from "@/widgets/files/build-filesystem-tree";

/** Children indent exactly one step from their parent (design: 9px + 17px). */
const ROW_BASE_PADDING_PX = 9;
const ROW_INDENT_STEP_PX = 17;

const rowIndentStyle = (depth: number) => ({
	paddingLeft: ROW_BASE_PADDING_PX + depth * ROW_INDENT_STEP_PX,
});

export type FileTreeDraft = {
	readonly kind: "file" | "directory";
	directoryPath: string;
	value: string;
	onChange: (next: string) => void;
	onCommit: () => void;
	onCancel: () => void;
};

export type FileTreeProps = {
	readonly nodes?: FilesystemTreeNode[];
	readonly openFileView?: (
		fileId: string,
		path: string,
	) => Promise<void> | void;
	readonly draft?: FileTreeDraft | null;
	readonly selectedPath?: string;
	readonly isPanelFocused?: boolean;
	readonly onSelectItem?: (path: string, kind: "file" | "directory") => void;
};

const sanitizeForTestId = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "") || "root";

/**
 * Minimal prototype file tree that mirrors the structure of the left sidebar.
 *
 * @example
 * <FileTree openFileView={(id) => console.log(id)} />
 */
export function FileTree({
	nodes = [],
	openFileView,
	draft,
	selectedPath,
	isPanelFocused = false,
	onSelectItem,
}: FileTreeProps) {
	const directoryPaths = useMemo(() => collectDirectoryPaths(nodes), [nodes]);
	const [openDirectories, setOpenDirectories] = useState(
		() => new Set(directoryPaths),
	);
	const knownDirectoryPathsRef = useRef(new Set(directoryPaths));

	useEffect(() => {
		const knownDirectoryPaths = knownDirectoryPathsRef.current;
		const nextDirectoryPaths = new Set(directoryPaths);
		const newDirectoryPaths = directoryPaths.filter(
			(path) => !knownDirectoryPaths.has(path),
		);
		knownDirectoryPathsRef.current = nextDirectoryPaths;
		if (newDirectoryPaths.length === 0) return;
		setOpenDirectories((prev) => {
			const next = new Set(prev);
			for (const path of newDirectoryPaths) {
				next.add(path);
			}
			return next;
		});
	}, [directoryPaths]);

	const sortedNodes = useMemo(() => sortNodes(nodes), [nodes]);

	const toggleDirectory = useCallback((path: string) => {
		setOpenDirectories((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	}, []);

	const isEmpty = sortedNodes.length === 0 && !draft;

	if (isEmpty) {
		// The "New file" row above the tree is the affordance; no extra copy.
		return null;
	}

	return (
		<ul className="space-y-px text-xs">
			{draft?.directoryPath === "/" ? (
				<DraftRow
					key="draft:root"
					draft={draft}
					depth={0}
					isPanelFocused={isPanelFocused}
				/>
			) : null}
			{sortedNodes.map((node) => (
				<FileTreeNode
					key={node.path}
					node={node}
					depth={0}
					onToggleDirectory={toggleDirectory}
					openDirectories={openDirectories}
					openFileView={openFileView}
					draft={draft}
					selectedPath={selectedPath}
					onSelectItem={onSelectItem}
					isPanelFocused={isPanelFocused}
				/>
			))}
		</ul>
	);
}

function FileTreeNode({
	node,
	depth,
	onToggleDirectory,
	openDirectories,
	openFileView,
	draft,
	selectedPath,
	onSelectItem,
	isPanelFocused,
}: {
	readonly node: FilesystemTreeNode;
	readonly depth: number;
	readonly onToggleDirectory: (path: string) => void;
	readonly openDirectories: Set<string>;
	readonly openFileView?: (
		fileId: string,
		path: string,
	) => Promise<void> | void;
	readonly draft?: FileTreeDraft | null;
	readonly selectedPath?: string;
	readonly onSelectItem?: (path: string, kind: "file" | "directory") => void;
	readonly isPanelFocused: boolean;
}) {
	if (node.type === "file") {
		const displayName = formatDisplayName(node.name);
		const isSelected = selectedPath === node.path;
		// Orange indicates the focused panel; inactive selections stay visible but quiet.
		const buttonClass = clsx(
			"flex h-7 w-full min-w-0 items-center gap-2 rounded-[7px] pr-2.25 text-left transition-[background-color,color,box-shadow] duration-100 ease-out [&_svg]:transition-colors [&_svg]:duration-100",
			isSelected && isPanelFocused
				? "bg-focus-tint font-semibold text-neutral-900 ring-1 ring-inset ring-focus-ring [&_svg]:text-brand-700"
				: isSelected
					? "bg-hover-soft font-semibold text-neutral-700 [&_svg]:text-neutral-500"
					: "text-neutral-600 hover:bg-hover-soft [&_svg]:text-neutral-400",
		);
		const itemTestId = `file-tree-item-${sanitizeForTestId(node.path)}`;
		return (
			<li>
				<button
					type="button"
					data-selected={isSelected ? "true" : undefined}
					data-testid={itemTestId}
					className={buttonClass}
					style={rowIndentStyle(depth)}
					onClick={() => {
						onSelectItem?.(node.path, "file");
						void openFileView?.(node.id, node.path);
					}}
				>
					<FileText className="size-3.25 shrink-0" strokeWidth={2} />
					<span className="min-w-0 flex-1 truncate" title={displayName}>
						{displayName}
					</span>
				</button>
			</li>
		);
	}

	const displayName = formatDisplayName(node.name);
	const containsDraft = draft?.directoryPath === node.path;
	const isOpen = containsDraft || openDirectories.has(node.path);
	const Icon = isOpen ? FolderOpen : Folder;
	const suppressSelection = Boolean(draft && draft.directoryPath === node.path);
	const isSelected = !suppressSelection && selectedPath === node.path;
	// Open/closed icons carry directory state. Selection stays quiet:
	// orange is reserved for the selected file row.
	const buttonClass = clsx(
		"flex h-7 w-full min-w-0 items-center gap-2 rounded-[7px] pr-2.25 text-left transition-colors hover:bg-hover-soft",
		isSelected && "bg-hover-soft",
		isOpen
			? "font-normal text-neutral-700 [&_svg]:text-neutral-500"
			: "text-neutral-600 [&_svg]:text-neutral-400",
	);

	return (
		<li>
			<button
				type="button"
				aria-expanded={isOpen}
				data-selected={isSelected ? "true" : undefined}
				data-testid={`file-tree-directory-${sanitizeForTestId(node.path)}`}
				className={buttonClass}
				style={rowIndentStyle(depth)}
				onClick={() => {
					onSelectItem?.(node.path, "directory");
					onToggleDirectory(node.path);
				}}
			>
				<Icon className="size-3.5 shrink-0" strokeWidth={2} />
				<span className="min-w-0 flex-1 truncate" title={displayName}>
					{displayName}
				</span>
			</button>
			{isOpen ? (
				<ul className="space-y-px">
					{containsDraft ? (
						<DraftRow
							key={`draft:${node.path}`}
							draft={draft!}
							depth={depth + 1}
							isPanelFocused={isPanelFocused}
						/>
					) : null}
					{sortNodes(node.children).map((child) => (
						<FileTreeNode
							key={child.path}
							node={child}
							depth={depth + 1}
							onToggleDirectory={onToggleDirectory}
							openDirectories={openDirectories}
							openFileView={openFileView}
							draft={draft}
							selectedPath={selectedPath}
							onSelectItem={onSelectItem}
							isPanelFocused={isPanelFocused}
						/>
					))}
				</ul>
			) : null}
		</li>
	);
}

function DraftRow({
	draft,
	depth,
	isPanelFocused,
}: {
	readonly draft: FileTreeDraft;
	readonly depth: number;
	readonly isPanelFocused: boolean;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const rowRef = useRef<HTMLDivElement | null>(null);
	const [value, setValue] = useState(draft.value);
	const [busy, setBusy] = useState(false);
	const isFile = draft.kind === "file";
	const Icon = isFile ? FileText : Folder;
	const suffix = isFile ? (
		<span className="shrink-0 text-neutral-400">.md</span>
	) : null;
	const ringClasses = isPanelFocused
		? "ring-1 ring-inset ring-focus-ring bg-focus-tint"
		: "ring-1 ring-inset ring-island-border";

	useEffect(() => {
		setValue(draft.value);
	}, [draft.value]);

	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);

	useEffect(() => {
		const handlePointerDown = (event: PointerEvent) => {
			if (!rowRef.current) return;
			const target = event.target as Node | null;
			if (target && rowRef.current.contains(target)) return;
			draft.onCancel();
		};
		document.addEventListener("pointerdown", handlePointerDown);
		return () => document.removeEventListener("pointerdown", handlePointerDown);
	}, [draft]);

	const handleCommit = useCallback(async () => {
		if (busy) return;
		setBusy(true);
		try {
			draft.onChange(value);
			await draft.onCommit();
		} finally {
			setBusy(false);
		}
	}, [busy, draft, value]);

	return (
		<li>
			<div
				ref={rowRef}
				className={clsx(
					"flex h-7 items-center gap-2 rounded-[7px] pr-2.25 text-left text-xs text-neutral-900",
					ringClasses,
				)}
				style={rowIndentStyle(depth)}
			>
				<Icon className="size-3.25 shrink-0 text-neutral-400" />
				<input
					ref={inputRef}
					data-testid="files-view-draft-input"
					className="min-w-0 flex-1 bg-transparent px-0 py-0 text-xs outline-none focus:outline-none"
					value={value}
					onChange={(event) => {
						const next = event.target.value.replaceAll("/", "");
						setValue(next);
						draft.onChange(next);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							void handleCommit();
						} else if (event.key === "Escape") {
							event.preventDefault();
							draft.onCancel();
						}
					}}
					disabled={busy}
				/>
				{suffix}
			</div>
		</li>
	);
}

function sortNodes(nodes: FilesystemTreeNode[]): FilesystemTreeNode[] {
	return [...nodes].sort((a, b) => {
		if (a.type === b.type) {
			return a.name.localeCompare(b.name);
		}
		return a.type === "directory" ? -1 : 1;
	});
}

function collectDirectoryPaths(nodes: FilesystemTreeNode[]): string[] {
	const paths: string[] = [];
	for (const node of nodes) {
		if (node.type === "directory") {
			paths.push(node.path);
			paths.push(...collectDirectoryPaths(node.children));
		}
	}
	return paths;
}

function formatDisplayName(name: string): string {
	return name;
}
