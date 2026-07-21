import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import type {
	FileTreeDirectoryHandle,
	FileTree as PierreFileTreeModel,
	FileTreeItemHandle,
	FileTreeRenameEvent,
	FileTreeRenamingItem,
	GitStatusEntry,
} from "@pierre/trees";
import type {
	FilesystemTreeNode,
	FilesystemTreeSource,
} from "@/extensions/files/build-filesystem-tree";

export type FileTreeCreateRequest = {
	readonly id: number;
	readonly kind: "file" | "directory";
	readonly directoryPath: string;
	readonly initialValue: string;
};

export type FileTreeRenameRequest = {
	readonly id?: string;
	readonly kind: "file" | "directory";
	readonly source: FilesystemTreeSource;
	readonly sourcePath: string;
	readonly destinationPath: string;
};

export type FileTreeProps = {
	readonly nodes?: FilesystemTreeNode[];
	readonly openFileView?: (
		fileId: string,
		path: string,
	) => Promise<void> | void;
	readonly createRequest?: FileTreeCreateRequest | null;
	readonly selectedPath?: string;
	readonly isPanelFocused?: boolean;
	readonly onSelectItem?: (
		path: string,
		kind: "file" | "directory",
		source?: FilesystemTreeSource,
	) => void;
	readonly openDirectories?: ReadonlySet<string>;
	readonly reviewPaths?: ReadonlySet<string>;
	readonly onOpenDirectoriesChange?: (paths: ReadonlySet<string>) => void;
	readonly onCreateCommit?: (
		request: FileTreeCreateRequest,
		value: string,
	) => Promise<void> | void;
	readonly onCreateCancel?: (request: FileTreeCreateRequest) => void;
	readonly onRenameCommit?: (
		request: FileTreeRenameRequest,
	) => Promise<void> | void;
};

type ReviewGitStatusEntry = {
	readonly path: string;
	readonly status: GitStatusEntry["status"];
};

type TreePathInfo = {
	readonly appPath: string;
	readonly kind: "file" | "directory";
	readonly id?: string;
	readonly createRequestId?: number;
	readonly source?: FilesystemTreeSource;
};

type TreeInput = {
	readonly paths: string[];
	readonly pathInfoByTreePath: Map<string, TreePathInfo>;
	readonly directoryTreePaths: string[];
	readonly realDirectoryTreePaths: string[];
	readonly createPlaceholderTreePath: string | null;
};

const FILE_TREE_UNSAFE_CSS = `
	[data-item-section='spacing-item'] {
		border-left-color: transparent;
		opacity: 0;
	}

	[data-type='item'][data-item-type='folder'] > [data-item-section='icon'] {
		color: var(--color-icon-secondary);
	}

	[data-type='item'][data-item-type='folder']
		> [data-item-section='icon']
		> [data-icon-name='file-tree-icon-chevron'] {
		display: none;
	}

	[data-type='item'][data-item-type='folder']
		> [data-item-section='icon']::before {
		content: "";
		display: block;
		width: var(--trees-icon-width);
		height: var(--trees-icon-width);
		background-color: currentColor;
		-webkit-mask: url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat;
		mask: url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat;
	}

	[data-type='item'][data-item-type='folder'][aria-expanded='true']
		> [data-item-section='icon']::before {
		-webkit-mask-image: url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='m6 14 1.5-2.9A2 2 0 0 1 9.24 9H20a2 2 0 0 1 1.74 3l-3.2 5.9A2 2 0 0 1 16.8 19H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v1' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		mask-image: url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='m6 14 1.5-2.9A2 2 0 0 1 9.24 9H20a2 2 0 0 1 1.74 3l-3.2 5.9A2 2 0 0 1 16.8 19H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v1' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
	}

	[data-type='item'][data-item-type='file'] > [data-item-section='icon'] {
		color: var(--color-icon-secondary);
	}

	[data-type='item'][data-item-type='file']
		> [data-item-section='icon']
		> [data-icon-name='file-tree-icon-file'] {
		display: none;
	}

	[data-type='item'][data-item-type='file']
		> [data-item-section='icon']::before {
		content: "";
		display: block;
		width: var(--trees-icon-width);
		height: var(--trees-icon-width);
		background-color: currentColor;
		-webkit-mask: url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M14 2v4a2 2 0 0 0 2 2h4' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat;
		mask: url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M14 2v4a2 2 0 0 0 2 2h4' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat;
	}

	[data-item-git-status='modified'] > [data-item-section='icon']
		> :where(:not([data-icon-name='file-tree-icon-chevron'])),
	[data-item-git-status='modified'] > [data-item-section='content'] {
		color: inherit;
	}

	[data-item-git-status='modified'] > [data-item-section='git'] {
		color: var(--color-warning-600);
		font-size: 0;
	}

	[data-item-git-status='modified'] > [data-item-section='git'] > span {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: currentColor;
	}

	[data-item-contains-git-change='true'] > [data-item-section='git'] {
		color: var(--color-warning-600);
		opacity: 0.75;
	}

	[data-type='item'][data-item-selected='true'][data-item-type='folder']
		> [data-item-section='icon'] {
		color: var(--color-icon-selection-current);
	}

	[data-type='item'][data-item-selected='true'][data-item-type='file']
		> [data-item-section='icon'] {
		color: var(--color-icon-selection-current);
	}

	[data-item-rename-input] {
		height: calc(var(--trees-row-height) - 6px);
		border: 1px solid var(--color-border-selection-current);
		border-radius: 6px;
		background: var(--color-bg-panel);
		box-shadow:
			0 0 0 2px var(--color-bg-selection-current),
			inset 0 1px 0 rgba(255, 255, 255, 0.72);
		color: var(--color-text-primary);
		caret-color: var(--color-icon-selection-current);
		padding-inline: 5px;
	}

	[data-item-rename-input]::selection {
		background: var(--color-border-selection-current);
		color: var(--color-text-primary);
	}
`;

/**
 * Adapter between Flashtype's workspace-path model and @pierre/trees.
 *
 * @example
 * <FileTree openFileView={(id) => console.log(id)} />
 */
export function FileTree({
	nodes = [],
	openFileView,
	createRequest,
	selectedPath,
	isPanelFocused = false,
	onSelectItem,
	openDirectories,
	reviewPaths,
	onOpenDirectoriesChange,
	onCreateCommit,
	onCreateCancel,
	onRenameCommit,
}: FileTreeProps) {
	const [internalOpenDirectories, setInternalOpenDirectories] = useState(
		() => new Set<string>(),
	);
	const resolvedOpenDirectories = openDirectories ?? internalOpenDirectories;
	const treeInput = useMemo(
		() => buildTreeInput(nodes, createRequest),
		[nodes, createRequest],
	);
	const treePathsKey = useMemo(
		() => treeInput.paths.join("\0"),
		[treeInput.paths],
	);
	const openDirectoryTreePaths = useMemo(() => {
		const next = new Set(
			[...resolvedOpenDirectories].map(appDirectoryPathToTreePath),
		);
		if (createRequest) {
			const parentTreePath = appDirectoryPathToTreePath(
				createRequest.directoryPath,
			);
			if (parentTreePath) {
				next.add(parentTreePath);
			}
		}
		return next;
	}, [createRequest, resolvedOpenDirectories]);
	const openDirectoryTreePathsKey = useMemo(
		() => [...openDirectoryTreePaths].sort().join("\0"),
		[openDirectoryTreePaths],
	);
	const reviewGitStatusEntries = useMemo(
		() => buildReviewGitStatusEntries(reviewPaths, treeInput),
		[reviewPaths, treeInput],
	);
	const reviewGitStatusKey = useMemo(
		() =>
			reviewGitStatusEntries
				.map((entry) => `${entry.path}:${entry.status}`)
				.join("\0"),
		[reviewGitStatusEntries],
	);
	const selectedTreePath = selectedPath
		? appPathToTreePath(selectedPath, selectedPath.endsWith("/"))
		: null;

	const stateRef = useRef({
		createRequest,
		openDirectories,
		openFileView,
		onCreateCancel,
		onCreateCommit,
		onOpenDirectoriesChange,
		onSelectItem,
		onRenameCommit,
		pathInfoByTreePath: treeInput.pathInfoByTreePath,
		realDirectoryTreePaths: treeInput.realDirectoryTreePaths,
		setInternalOpenDirectories,
	});
	stateRef.current = {
		createRequest,
		openDirectories,
		openFileView,
		onCreateCancel,
		onCreateCommit,
		onOpenDirectoriesChange,
		onSelectItem,
		onRenameCommit,
		pathInfoByTreePath: treeInput.pathInfoByTreePath,
		realDirectoryTreePaths: treeInput.realDirectoryTreePaths,
		setInternalOpenDirectories,
	};

	const modelRef = useRef<PierreFileTreeModel | null>(null);
	const suppressSelectionOpenRef = useRef(false);
	const suppressSelectionOpenForClickRef = useRef(false);
	const handleSelectionChangeRef = useRef(
		(_selectedTreePaths: readonly string[]) => {},
	);
	const handleRenameRef = useRef((_event: FileTreeRenameEvent) => {});
	const handleCanRenameRef = useRef(
		(_item: FileTreeRenamingItem): boolean => false,
	);

	handleSelectionChangeRef.current = (selectedTreePaths) => {
		const latestTreePath = selectedTreePaths.at(-1);
		if (!latestTreePath) return;
		const model = modelRef.current;
		if (model) {
			for (const treePath of selectedTreePaths) {
				if (treePath !== latestTreePath) {
					model.getItem(treePath)?.deselect();
				}
			}
		}
		const info = pathInfoForTreePath(
			stateRef.current.pathInfoByTreePath,
			latestTreePath,
		);
		if (info) {
			stateRef.current.onSelectItem?.(info.appPath, info.kind, info.source);
			if (
				!suppressSelectionOpenRef.current &&
				!suppressSelectionOpenForClickRef.current &&
				info.kind === "file" &&
				info.id
			) {
				void stateRef.current.openFileView?.(info.id, info.appPath);
			}
		}
	};

	handleCanRenameRef.current = (item) => {
		const request = stateRef.current.createRequest;
		const info = pathInfoForTreePath(
			stateRef.current.pathInfoByTreePath,
			item.path,
		);
		if (!info) return false;
		if (item.isFolder !== (info.kind === "directory")) return false;
		if (request) {
			return info.createRequestId === request.id;
		}
		if (info.createRequestId != null) return false;
		if (info.source === "watched") {
			return info.kind === "file";
		}
		return true;
	};

	handleRenameRef.current = (event) => {
		const request = stateRef.current.createRequest;
		const sourceInfo = pathInfoForTreePath(
			stateRef.current.pathInfoByTreePath,
			event.sourcePath,
		);
		if (!sourceInfo) return;
		if (request && sourceInfo.createRequestId === request.id) {
			void stateRef.current.onCreateCommit?.(
				request,
				leafNameFromTreePath(event.destinationPath),
			);
			return;
		}
		if (request) return;
		if (sourceInfo.createRequestId != null) {
			return;
		}
		if (sourceInfo.source === "watched" && sourceInfo.kind !== "file") {
			return;
		}
		void stateRef.current.onRenameCommit?.({
			destinationPath:
				sourceInfo.kind === "directory"
					? treeDirectoryPathToAppPath(event.destinationPath)
					: treeFilePathToAppPath(event.destinationPath),
			id: sourceInfo.id,
			kind: sourceInfo.kind,
			source: sourceInfo.source ?? "lix",
			sourcePath: sourceInfo.appPath,
		});
	};

	const handleTreeClickCapture = useCallback(() => {
		suppressSelectionOpenForClickRef.current = true;
		window.setTimeout(() => {
			suppressSelectionOpenForClickRef.current = false;
		}, 0);
	}, []);

	const openFileFromTreeEvent = useCallback((event: Event) => {
		const treePath = treePathFromComposedEvent(event);
		if (!treePath) return;
		const info = pathInfoForTreePath(
			stateRef.current.pathInfoByTreePath,
			treePath,
		);
		if (info?.kind !== "file" || !info.id) return;
		stateRef.current.onSelectItem?.(info.appPath, info.kind, info.source);
		void stateRef.current.openFileView?.(info.id, info.appPath);
	}, []);

	const { model } = useFileTree({
		dragAndDrop: false,
		flattenEmptyDirectories: false,
		icons: { set: "minimal", colored: false },
		gitStatus: reviewGitStatusEntries as GitStatusEntry[],
		initialExpansion: "closed",
		itemHeight: 28,
		onSelectionChange: (paths) => handleSelectionChangeRef.current(paths),
		paths: [],
		renaming: {
			canRename: (item) => handleCanRenameRef.current(item),
			onError: (error) => console.warn("File tree rename failed", error),
			onRename: (event) => handleRenameRef.current(event),
		},
		stickyFolders: false,
		unsafeCSS: FILE_TREE_UNSAFE_CSS,
	});
	modelRef.current = model;

	useEffect(() => {
		model.resetPaths(treeInput.paths, {
			initialExpandedPaths: [...openDirectoryTreePaths],
		});
	}, [model, treeInput.paths, treePathsKey]);

	useEffect(() => {
		model.setGitStatus(reviewGitStatusEntries as GitStatusEntry[]);
	}, [model, reviewGitStatusEntries, reviewGitStatusKey]);

	useEffect(() => {
		for (const directoryTreePath of treeInput.directoryTreePaths) {
			const item = toDirectoryHandle(model.getItem(directoryTreePath));
			if (!item) continue;
			const shouldBeOpen = openDirectoryTreePaths.has(directoryTreePath);
			if (shouldBeOpen && !item.isExpanded()) {
				item.expand();
			} else if (!shouldBeOpen && item.isExpanded()) {
				item.collapse();
			}
		}
	}, [
		model,
		openDirectoryTreePaths,
		openDirectoryTreePathsKey,
		treeInput.directoryTreePaths,
		treePathsKey,
	]);

	useEffect(() => {
		for (const treePath of model.getSelectedPaths()) {
			if (treePath !== selectedTreePath) {
				model.getItem(treePath)?.deselect();
			}
		}
		if (selectedTreePath && model.getItem(selectedTreePath)) {
			suppressSelectionOpenRef.current = true;
			try {
				model.getItem(selectedTreePath)?.select();
				model.focusPath(selectedTreePath);
			} finally {
				suppressSelectionOpenRef.current = false;
			}
		}
	}, [model, selectedTreePath, treePathsKey]);

	useEffect(() => {
		if (!createRequest || !treeInput.createPlaceholderTreePath) return;
		const item = model.getItem(treeInput.createPlaceholderTreePath);
		if (!item) return;
		model.focusPath(treeInput.createPlaceholderTreePath);
		model.startRenaming(treeInput.createPlaceholderTreePath, {
			removeIfCanceled: true,
		});
	}, [
		createRequest?.id,
		model,
		treeInput.createPlaceholderTreePath,
		treePathsKey,
	]);

	useEffect(() => {
		return model.onMutation("remove", (event) => {
			const request = stateRef.current.createRequest;
			if (!request) return;
			const info = pathInfoForTreePath(
				stateRef.current.pathInfoByTreePath,
				event.path,
			);
			if (info?.createRequestId === request.id) {
				stateRef.current.onCreateCancel?.(request);
			}
		});
	}, [model]);

	useEffect(() => {
		return model.subscribe(() => {
			const next = readExpandedAppDirectoryPaths(model, stateRef.current);
			const { openDirectories: controlledOpenDirectories } = stateRef.current;
			if (controlledOpenDirectories) {
				if (!sameDirectorySet(next, controlledOpenDirectories)) {
					stateRef.current.onOpenDirectoriesChange?.(next);
				}
				return;
			}
			stateRef.current.setInternalOpenDirectories((prev) =>
				sameDirectorySet(prev, next) ? prev : next,
			);
		});
	}, [model]);

	if (treeInput.paths.length === 0) {
		// The "New file" row above the tree is the affordance; no extra copy.
		return null;
	}

	return (
		<PierreFileTree
			aria-label="Files"
			model={model}
			onClick={(event) => openFileFromTreeEvent(event.nativeEvent)}
			onClickCapture={handleTreeClickCapture}
			style={treeHostStyle(isPanelFocused)}
		/>
	);
}

function buildTreeInput(
	nodes: readonly FilesystemTreeNode[],
	createRequest: FileTreeCreateRequest | null | undefined,
): TreeInput {
	const pathInfoByTreePath = new Map<string, TreePathInfo>();
	const paths: string[] = [];
	const directoryTreePaths: string[] = [];
	const realDirectoryTreePaths: string[] = [];

	const addPath = (treePath: string, info: TreePathInfo) => {
		if (!pathInfoByTreePath.has(treePath)) {
			paths.push(treePath);
			if (info.kind === "directory") {
				directoryTreePaths.push(treePath);
				if (info.createRequestId == null) {
					realDirectoryTreePaths.push(treePath);
				}
			}
		}
		pathInfoByTreePath.set(treePath, info);
	};

	const visit = (node: FilesystemTreeNode) => {
		if (node.type === "directory") {
			const treePath = appPathToTreePath(node.path, true);
			addPath(treePath, {
				appPath: node.path,
				id: node.id,
				kind: "directory",
				source: node.source,
			});
			for (const child of node.children) {
				visit(child);
			}
			return;
		}
		const treePath = appPathToTreePath(node.path, false);
		addPath(treePath, {
			appPath: node.path,
			id: node.id,
			kind: "file",
			source: node.source,
		});
	};

	for (const node of nodes) {
		visit(node);
	}

	let createPlaceholderTreePath: string | null = null;
	if (createRequest) {
		const placeholder = uniqueCreatePlaceholderPath(
			createRequest,
			pathInfoByTreePath,
		);
		createPlaceholderTreePath = placeholder.treePath;
		addPath(placeholder.treePath, {
			appPath: placeholder.appPath,
			createRequestId: createRequest.id,
			kind: createRequest.kind,
		});
	}

	return {
		createPlaceholderTreePath,
		directoryTreePaths,
		pathInfoByTreePath,
		paths,
		realDirectoryTreePaths,
	};
}

function buildReviewGitStatusEntries(
	reviewPaths: ReadonlySet<string> | undefined,
	treeInput: TreeInput,
): ReviewGitStatusEntry[] {
	if (!reviewPaths || reviewPaths.size === 0) {
		return [];
	}
	const entries: ReviewGitStatusEntry[] = [];
	for (const appPath of reviewPaths ?? []) {
		const treePath = appPathToTreePath(appPath, false);
		const info = treeInput.pathInfoByTreePath.get(treePath);
		if (!info || info.kind !== "file" || info.createRequestId != null) {
			continue;
		}
		entries.push({ path: treePath, status: "modified" });
	}
	return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function uniqueCreatePlaceholderPath(
	request: FileTreeCreateRequest,
	pathInfoByTreePath: ReadonlyMap<string, TreePathInfo>,
): { appPath: string; treePath: string } {
	let suffix = 1;
	while (suffix < 1000) {
		const value =
			suffix === 1 ? request.initialValue : `${request.initialValue}-${suffix}`;
		const appPath = childAppPath(request.directoryPath, value, request.kind);
		const treePath = appPathToTreePath(appPath, request.kind === "directory");
		if (!pathInfoByTreePath.has(treePath)) {
			return { appPath, treePath };
		}
		suffix += 1;
	}
	const fallback = childAppPath(
		request.directoryPath,
		`${request.initialValue}-${request.id}`,
		request.kind,
	);
	return {
		appPath: fallback,
		treePath: appPathToTreePath(fallback, request.kind === "directory"),
	};
}

function readExpandedAppDirectoryPaths(
	model: PierreFileTreeModel,
	state: {
		readonly pathInfoByTreePath: ReadonlyMap<string, TreePathInfo>;
		readonly realDirectoryTreePaths: readonly string[];
	},
): Set<string> {
	const next = new Set<string>();
	for (const treePath of state.realDirectoryTreePaths) {
		const item = toDirectoryHandle(model.getItem(treePath));
		if (!item?.isExpanded()) continue;
		const info = state.pathInfoByTreePath.get(treePath);
		next.add(info?.appPath ?? treeDirectoryPathToAppPath(treePath));
	}
	return next;
}

function toDirectoryHandle(
	item: FileTreeItemHandle | null | undefined,
): FileTreeDirectoryHandle | null {
	if (!item || !item.isDirectory()) return null;
	return item as FileTreeDirectoryHandle;
}

function treePathFromComposedEvent(event: Event): string | null {
	for (const target of event.composedPath()) {
		if (!(target instanceof Element)) continue;
		const item = target.closest("[data-type='item'][data-item-path]");
		const path = item?.getAttribute("data-item-path");
		if (path) return path;
	}
	return null;
}

function pathInfoForTreePath(
	pathInfoByTreePath: ReadonlyMap<string, TreePathInfo>,
	treePath: string,
): TreePathInfo | undefined {
	const exact = pathInfoByTreePath.get(treePath);
	if (exact) return exact;
	const alternate = treePath.endsWith("/")
		? treePath.slice(0, -1)
		: `${treePath}/`;
	return pathInfoByTreePath.get(alternate);
}

function treeHostStyle(isPanelFocused: boolean) {
	return {
		"--trees-bg-override": "transparent",
		"--trees-bg-muted-override": "var(--color-bg-hover)",
		"--trees-border-color-override": "transparent",
		"--trees-border-radius-override": "7px",
		"--trees-fg-muted-override": "var(--color-text-tertiary)",
		"--trees-fg-override": "var(--color-text-secondary)",
		"--trees-focus-ring-color-override": "var(--color-ring-focus-visible)",
		"--trees-font-family-override": "inherit",
		"--trees-font-size-override": "12px",
		"--trees-git-modified-color-override": "var(--color-warning-600)",
		"--trees-icon-width-override": "13px",
		"--trees-input-bg-override": "transparent",
		"--trees-item-margin-x-override": "0px",
		"--trees-item-padding-x-override": "9px",
		"--trees-level-gap-override": "7px",
		"--trees-padding-inline-override": "0px",
		"--trees-scrollbar-gutter-override": "0px",
		"--trees-selected-bg-override": isPanelFocused
			? "var(--color-bg-selection-current)"
			: "var(--color-bg-hover)",
		"--trees-selected-focused-border-color-override": isPanelFocused
			? "var(--color-border-selection-current)"
			: "transparent",
		"--trees-selected-fg-override": isPanelFocused
			? "var(--color-text-primary)"
			: "var(--color-text-secondary)",
		height: "100%",
		minHeight: 0,
		width: "100%",
	} as CSSProperties;
}

function appPathToTreePath(path: string, isDirectory: boolean): string {
	if (path === "/") return "";
	const withoutLeadingSlash = path.startsWith("/") ? path.slice(1) : path;
	const withoutDirectorySlash = withoutLeadingSlash.endsWith("/")
		? withoutLeadingSlash.slice(0, -1)
		: withoutLeadingSlash;
	return isDirectory ? `${withoutDirectorySlash}/` : withoutDirectorySlash;
}

function appDirectoryPathToTreePath(path: string): string {
	return appPathToTreePath(path, true);
}

function treeDirectoryPathToAppPath(path: string): string {
	if (!path) return "/";
	return `/${path.endsWith("/") ? path : `${path}/`}`;
}

function treeFilePathToAppPath(path: string): string {
	return path.startsWith("/") ? path : `/${path}`;
}

function childAppPath(
	directoryPath: string,
	name: string,
	kind: "file" | "directory",
): string {
	const directory =
		directoryPath === "/" ? "/" : ensureDirectoryPath(directoryPath);
	const childPath = `${directory}${name.replaceAll("/", "")}`;
	return kind === "directory" ? ensureDirectoryPath(childPath) : childPath;
}

function leafNameFromTreePath(path: string): string {
	const withoutDirectorySlash = path.endsWith("/") ? path.slice(0, -1) : path;
	const slashIndex = withoutDirectorySlash.lastIndexOf("/");
	return slashIndex === -1
		? withoutDirectorySlash
		: withoutDirectorySlash.slice(slashIndex + 1);
}

function sameDirectorySet(
	left: ReadonlySet<string>,
	right: ReadonlySet<string>,
): boolean {
	if (left.size !== right.size) return false;
	const normalizedRight = new Set([...right].map(normalizeDirectoryForCompare));
	for (const path of left) {
		if (!normalizedRight.has(normalizeDirectoryForCompare(path))) {
			return false;
		}
	}
	return true;
}

function normalizeDirectoryForCompare(path: string): string {
	return path === "/"
		? "/"
		: ensureDirectoryPath(path.startsWith("/") ? path : `/${path}`);
}

function ensureDirectoryPath(path: string): string {
	if (path === "/") return "/";
	return path.endsWith("/") ? path : `${path}/`;
}
