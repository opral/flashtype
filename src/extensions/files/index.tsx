import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Files, FileUp, FilePlus, Github } from "lucide-react";
import {
	LixProvider,
	useLix,
	useQuery,
	useQueryTakeFirst,
} from "@/lib/lix-react";
import { isMarkdownFilePath } from "@/extension-runtime/file-handlers";
import { selectFilesystemEntries } from "@/queries";
import {
	buildFilesystemTree,
	type FilesystemTreeNode,
} from "@/extensions/files/build-filesystem-tree";
import type { ExtensionContext } from "../../extension-runtime/types";
import {
	FileTree,
	type FileTreeCreateRequest,
	type FileTreeRenameRequest,
} from "./file-tree";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { qb } from "@/lib/lix-kysely";
import { FILES_EXTENSION_KIND } from "../../extension-runtime/extension-instance-helpers";
import type { FilesystemEntryRow } from "@/queries";
import type { Lix } from "@/lib/lix-types";
import {
	AGENT_TURN_COMMIT_RANGE_KEY,
	isAgentTurnCommitRangeStore,
} from "@/shell/agent-turn-review-range";
import {
	getPendingExternalWriteReviewPaths,
	type ExternalWriteReviewFile,
} from "@/shell/external-write-review-history";

type FilesViewProps = {
	readonly context?: ExtensionContext;
};

/**
 * Files view - Browse and pin project documents. Owns the Cmd/Ctrl + . shortcut
 * that opens the inline creation prompt for a new markdown file.
 *
 * @example
 * <FilesView context={{ openExtension: console.log }} />
 */
export function FilesView({ context }: FilesViewProps) {
	const lix = useLix();
	const entries = useQuery<FilesystemEntryRow>((lix) =>
		selectFilesystemEntries(lix),
	);
	return <FilesViewContent context={context} lix={lix} entries={entries} />;
}

function FilesViewContent({
	context,
	lix,
	entries,
}: FilesViewProps & {
	readonly lix: Lix;
	readonly entries: FilesystemEntryRow[];
}) {
	const ownerIdRef = useRef(
		`files-view:${context?.viewInstance ?? Math.random().toString(36).slice(2)}`,
	);
	const isEphemeralWorkspace = context?.workspace?.ephemeral === true;
	const [watchedEntries, setWatchedEntries] = useState<FilesystemEntryRow[]>(
		[],
	);
	const [upgradedWatchedFilePaths, setUpgradedWatchedFilePaths] = useState(
		() => new Set<string>(),
	);
	const [openDirectoryPaths, setOpenDirectoryPaths] = useState(
		() => new Set<string>(),
	);
	const visibleWatchedEntries = useMemo(() => {
		if (!isEphemeralWorkspace) return [];
		if (upgradedWatchedFilePaths.size === 0) return watchedEntries;
		return watchedEntries.filter((entry) => {
			if (entry.kind !== "file") return true;
			return !upgradedWatchedFilePaths.has(filesystemEntryPathKey(entry));
		});
	}, [isEphemeralWorkspace, upgradedWatchedFilePaths, watchedEntries]);
	const combinedEntries = useMemo(
		() => unionFilesystemEntries(entries ?? [], visibleWatchedEntries),
		[entries, visibleWatchedEntries],
	);
	const nodes = useMemo(
		() => buildFilesystemTree(combinedEntries),
		[combinedEntries],
	);
	const pendingReviewPaths = usePendingExternalWriteReviewPaths(lix, nodes);
	const creatingRef = useRef(false);
	const renamingRef = useRef(false);
	const [pendingPaths, setPendingPaths] = useState<string[]>([]);
	const [pendingDirectoryPaths, setPendingDirectoryPaths] = useState<string[]>(
		[],
	);
	const [createRequest, setCreateRequest] =
		useState<FileTreeCreateRequest | null>(null);
	const nextCreateRequestIdRef = useRef(0);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
	const [selectedKind, setSelectedKind] = useState<"file" | "directory" | null>(
		null,
	);
	const [isDraggingOver, setIsDraggingOver] = useState(false);
	const dragCounterRef = useRef(0);
	const entryPathSet = useMemo(() => {
		return new Set(
			(combinedEntries ?? [])
				.filter((entry) => entry.kind === "file")
				.map((entry) => entry.path),
		);
	}, [combinedEntries]);
	const entryDirectorySet = useMemo(() => {
		return new Set(
			(combinedEntries ?? [])
				.filter((entry) => entry.kind === "directory")
				.map((entry) => entry.path),
		);
	}, [combinedEntries]);
	const existingFilePaths = useMemo(() => {
		const combined = new Set(entryPathSet);
		for (const path of pendingPaths) {
			combined.add(path);
		}
		return combined;
	}, [entryPathSet, pendingPaths]);
	const existingDirectoryPaths = useMemo(() => {
		const combined = new Set(entryDirectorySet);
		for (const path of pendingDirectoryPaths) {
			combined.add(path);
		}
		return combined;
	}, [entryDirectorySet, pendingDirectoryPaths]);
	useEffect(() => {
		if (pendingPaths.length === 0) return;
		setPendingPaths((prev) => prev.filter((path) => !entryPathSet.has(path)));
	}, [entryPathSet, pendingPaths.length]);
	useEffect(() => {
		if (pendingDirectoryPaths.length === 0) return;
		setPendingDirectoryPaths((prev) =>
			prev.filter((path) => !entryDirectorySet.has(path)),
		);
	}, [entryDirectorySet, pendingDirectoryPaths.length]);
	const isMacPlatform = useMemo(() => detectMacPlatform(), []);
	const isPanelFocused = context?.isPanelFocused ?? false;
	const registerNewFileDraftHandler = context?.registerNewFileDraftHandler;
	const panelSide = context?.panelSide;
	const viewInstance = context?.viewInstance;
	const isActiveView = context?.isActiveView === true;
	const openedEphemeralDirectoryPaths = useMemo(() => {
		const paths = new Set(openDirectoryPaths);
		paths.add("/");
		return [...paths].sort((left, right) => left.localeCompare(right));
	}, [openDirectoryPaths]);

	useEffect(() => {
		if (!isEphemeralWorkspace) {
			setWatchedEntries([]);
			setUpgradedWatchedFilePaths(new Set());
			return;
		}
		const workspaceApi = window.flashtypeDesktop?.workspace;
		if (!workspaceApi?.setEphemeralWatchedDirectories) {
			return;
		}
		const ownerId = ownerIdRef.current;
		let cancelled = false;
		void workspaceApi
			.setEphemeralWatchedDirectories({
				ownerId,
				paths: openedEphemeralDirectoryPaths,
			})
			.then((entries) => {
				if (!cancelled) {
					setWatchedEntries(entries);
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					console.warn("Failed to list transient workspace files", error);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [isEphemeralWorkspace, openedEphemeralDirectoryPaths]);

	useEffect(() => {
		if (!isEphemeralWorkspace) {
			return;
		}
		return window.flashtypeDesktop?.workspace.onEphemeralWatchedFileTreeChanged?.(
			(entries) => {
				setWatchedEntries(entries);
			},
		);
	}, [isEphemeralWorkspace]);

	useEffect(() => {
		if (!isEphemeralWorkspace) {
			return;
		}
		const workspaceApi = window.flashtypeDesktop?.workspace;
		const ownerId = ownerIdRef.current;
		return () => {
			void workspaceApi?.setEphemeralWatchedDirectories?.({
				ownerId,
				paths: [],
			});
		};
	}, [isEphemeralWorkspace]);

	const resolveCreateDirectory = useCallback(() => {
		if (!selectedPath) return "/";
		if (selectedPath.endsWith("/")) return selectedPath;
		const parts = selectedPath.split("/").filter(Boolean);
		if (parts.length <= 1) return "/";
		return `/${parts.slice(0, -1).join("/")}/`;
	}, [selectedPath]);

	const startCreateRequest = useCallback(
		(kind: "file" | "directory") => {
			const baseDirectory = resolveCreateDirectory();
			const directoryPath = ensureDirectoryPath(baseDirectory);
			setCreateRequest((prev) => {
				if (prev) return prev;
				setSelectedPath(null);
				setSelectedFileId(null);
				setSelectedKind(null);
				if (directoryPath !== "/") {
					setOpenDirectoryPaths((openPaths) => {
						const next = new Set(openPaths);
						next.add(directoryPath);
						return next;
					});
				}
				nextCreateRequestIdRef.current += 1;
				return {
					directoryPath,
					id: nextCreateRequestIdRef.current,
					initialValue: kind === "directory" ? "new-directory" : "new-file",
					kind,
				};
			});
		},
		[resolveCreateDirectory],
	);

	const handleNewFile = useCallback(() => {
		startCreateRequest("file");
	}, [startCreateRequest]);

	const handleCreateCancel = useCallback((request: FileTreeCreateRequest) => {
		setCreateRequest((prev) => (prev?.id === request.id ? null : prev));
		setSelectedPath(null);
		setSelectedFileId(null);
		setSelectedKind(null);
	}, []);

	const handleCreateCommit = useCallback(
		async (request: FileTreeCreateRequest, value: string) => {
			if (creatingRef.current) return;
			const directoryPath = ensureDirectoryPath(request.directoryPath);
			const clearRequest = () => {
				setCreateRequest((prev) => (prev?.id === request.id ? null : prev));
			};
			const executeFileCreation = async () => {
				const path = deriveMarkdownPathFromStem(
					value,
					directoryPath,
					existingFilePaths,
				);
				if (!path) {
					clearRequest();
					return;
				}
				creatingRef.current = true;
				try {
					await qb(lix)
						.insertInto("lix_file")
						.values({
							path,
							data: new TextEncoder().encode(""),
						})
						.execute();
					const id = (
						await qb(lix)
							.selectFrom("lix_file")
							.select("id")
							.where("path", "=", path)
							.executeTakeFirst()
					)?.id;
					if (!id) {
						throw new Error(`created file id not found for path '${path}'`);
					}
					setPendingPaths((prev) => [...prev, path]);
					setSelectedPath(path);
					setSelectedFileId(id);
					setSelectedKind("file");
					context?.openFile?.({
						panel: "central",
						fileId: id,
						filePath: path,
						state: { focusOnLoad: true, defaultBlock: "heading1" },
						focus: true,
						documentOrigin: "new",
					});
				} catch (error) {
					console.error("Failed to create file", error);
				} finally {
					creatingRef.current = false;
					clearRequest();
				}
			};

			const executeDirectoryCreation = async () => {
				const path = deriveDirectoryPathFromStem(
					value,
					directoryPath,
					existingDirectoryPaths,
				);
				if (!path) {
					clearRequest();
					return;
				}
				creatingRef.current = true;
				try {
					await qb(lix)
						.insertInto("lix_directory")
						.values({ path } as any)
						.execute();
					setPendingDirectoryPaths((prev) => [...prev, path]);
					setSelectedPath(path);
					setSelectedKind("directory");
				} catch (error) {
					console.error("Failed to create directory", error);
				} finally {
					creatingRef.current = false;
					clearRequest();
				}
			};

			if (request.kind === "directory") {
				return executeDirectoryCreation();
			}
			return executeFileCreation();
		},
		[context, existingDirectoryPaths, existingFilePaths, lix],
	);

	const handleCreateDirectory = useCallback(() => {
		startCreateRequest("directory");
	}, [startCreateRequest]);

	const handleRenameCommit = useCallback(
		async (request: FileTreeRenameRequest) => {
			if (renamingRef.current) return;
			const sourcePath =
				request.kind === "directory"
					? ensureDirectoryPath(request.sourcePath)
					: normalizeFilePath(request.sourcePath);
			const destinationPath =
				request.kind === "directory"
					? ensureDirectoryPath(request.destinationPath)
					: normalizeFilePath(request.destinationPath);
			if (sourcePath === destinationPath) return;

			const destinationExists =
				request.kind === "directory"
					? existingDirectoryPaths.has(destinationPath)
					: existingFilePaths.has(destinationPath);
			if (destinationExists) {
				console.warn(`Cannot rename '${sourcePath}' to '${destinationPath}'`);
				return;
			}

			renamingRef.current = true;
			try {
				if (request.kind === "directory") {
					await qb(lix)
						.updateTable("lix_directory")
						.set({ path: destinationPath } as any)
						.where("path", "=", sourcePath)
						.execute();
					setOpenDirectoryPaths((prev) =>
						remapDirectoryPathSet(prev, sourcePath, destinationPath),
					);
					setPendingDirectoryPaths((prev) =>
						remapDirectoryPaths(prev, sourcePath, destinationPath),
					);
					setPendingPaths((prev) =>
						remapFilePathsInDirectory(prev, sourcePath, destinationPath),
					);
					setSelectedPath(destinationPath);
					setSelectedFileId(null);
					setSelectedKind("directory");
					return;
				}

				let resolvedFileId = request.source === "watched" ? null : request.id;
				if (request.source === "watched") {
					await lix.importFilesystemPaths([sourcePath]);
					const importedFile = await qb(lix)
						.selectFrom("lix_file")
						.select("id")
						.where("path", "=", sourcePath)
						.executeTakeFirst();
					if (!importedFile?.id) {
						throw new Error(
							`imported watched file id not found for path '${sourcePath}'`,
						);
					}
					resolvedFileId = importedFile.id as string;
				}
				await qb(lix)
					.updateTable("lix_file")
					.set({ path: destinationPath } as any)
					.where("path", "=", sourcePath)
					.execute();
				setPendingPaths((prev) =>
					appendUniquePath(
						remapFilePaths(prev, sourcePath, destinationPath),
						destinationPath,
					),
				);
				if (request.source === "watched") {
					setUpgradedWatchedFilePaths((prev) => {
						const next = new Set(prev);
						next.add(sourcePath);
						return next;
					});
				}
				setSelectedPath(destinationPath);
				setSelectedFileId(resolvedFileId ?? null);
				setSelectedKind("file");
				if (resolvedFileId) {
					void context?.openFile?.({
						panel: "central",
						fileId: resolvedFileId,
						filePath: destinationPath,
						focus: false,
						trackTelemetry: false,
					});
				}
			} catch (error) {
				console.error("Failed to rename entry", error);
			} finally {
				renamingRef.current = false;
			}
		},
		[context, existingDirectoryPaths, existingFilePaths, lix],
	);

	const handleCreateShortcut = useCallback(
		(kind: "file" | "directory") => {
			if (kind === "directory") {
				handleCreateDirectory();
				return;
			}
			handleNewFile();
		},
		[handleCreateDirectory, handleNewFile],
	);

	useEffect(() => {
		if (!registerNewFileDraftHandler || !panelSide || !viewInstance) {
			return;
		}
		return registerNewFileDraftHandler({
			panelSide,
			viewInstance,
			isActiveView,
			handler: handleNewFile,
		});
	}, [
		handleNewFile,
		isActiveView,
		panelSide,
		registerNewFileDraftHandler,
		viewInstance,
	]);

	const handleOpenFile = useCallback(
		(fileId: string, path: string) => {
			setSelectedPath(path);
			setSelectedFileId(fileId);
			setSelectedKind("file");
			void context?.openFile?.({
				panel: "central",
				fileId,
				filePath: path,
				focus: false,
			});
		},
		[context],
	);

	const handleOpenDirectoriesChange = useCallback(
		(next: ReadonlySet<string>) => {
			setOpenDirectoryPaths((prev) => {
				const nextPaths = new Set([...next].map(ensureDirectoryPath));
				const closedPaths = [...prev].filter((path) => !nextPaths.has(path));
				for (const closedPath of closedPaths) {
					const closedPrefix = ensureDirectoryPath(closedPath);
					for (const path of [...nextPaths]) {
						if (path !== closedPrefix && path.startsWith(closedPrefix)) {
							nextPaths.delete(path);
						}
					}
				}
				return nextPaths;
			});
		},
		[],
	);

	const handleSelectItem = useCallback(
		(path: string, kind: "file" | "directory") => {
			setSelectedPath(path);
			if (kind === "directory") {
				setSelectedFileId(null);
			}
			setSelectedKind(kind);
		},
		[],
	);

	const handleDeleteSelection = useCallback(async () => {
		if (!selectedPath || !selectedKind) return;
		const normalizedPath =
			selectedKind === "file"
				? selectedPath
				: ensureDirectoryPath(selectedPath);
		try {
			if (selectedKind === "file") {
				await qb(lix)
					.deleteFrom("lix_file")
					.where("path", "=", normalizedPath)
					.execute();
				setPendingPaths((prev) =>
					prev.filter((path) => path !== normalizedPath),
				);
				if (selectedFileId) {
					context?.closeFileViews?.({ fileId: selectedFileId });
				}
			} else {
				await qb(lix)
					.deleteFrom("lix_directory")
					.where("path", "=", normalizedPath)
					.execute();
				setPendingDirectoryPaths((prev) =>
					prev.filter((path) => path !== normalizedPath),
				);
			}
		} catch (error) {
			console.error("Failed to delete entry", error);
		} finally {
			setSelectedPath(null);
			setSelectedFileId(null);
			setSelectedKind(null);
		}
	}, [context, lix, selectedFileId, selectedKind, selectedPath]);

	useEffect(() => {
		const listener = (event: KeyboardEvent) => {
			const usesPrimaryModifier = isMacPlatform
				? event.metaKey && !event.ctrlKey
				: event.ctrlKey && !event.metaKey;
			if (!usesPrimaryModifier || event.altKey) return;
			const isDeleteKey =
				event.key === "Backspace" ||
				event.code?.toLowerCase() === "backspace" ||
				event.key === "Delete" ||
				event.code?.toLowerCase() === "delete";
			if (isDeleteKey) {
				const shouldHandleDelete = !isInteractiveEventTarget(event);
				if (!shouldHandleDelete) return;
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation?.();
				event.returnValue = false;
				if (
					event.type === "keydown" &&
					!event.repeat &&
					!event.shiftKey &&
					shouldHandleDelete
				) {
					void handleDeleteSelection();
				}
				return;
			}
			const isTrigger =
				event.key === "." || event.code?.toLowerCase() === "period";
			if (!isTrigger) return;
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation?.();
			event.returnValue = false;
			if (
				event.type === "keydown" &&
				!event.repeat &&
				!isInteractiveEventTarget(event)
			) {
				const kind = event.shiftKey ? "directory" : "file";
				handleCreateShortcut(kind);
			}
		};

		const options: AddEventListenerOptions = { capture: true, passive: false };
		const eventTypes: Array<"keydown" | "keypress" | "keyup"> = [
			"keydown",
			"keypress",
			"keyup",
		];
		const targets: EventTarget[] = [window, document];
		if (document.body) {
			targets.push(document.body);
		}
		for (const target of targets) {
			for (const type of eventTypes) {
				target.addEventListener(type, listener as EventListener, options);
			}
		}
		return () => {
			for (const target of targets) {
				for (const type of eventTypes) {
					target.removeEventListener(type, listener as EventListener, options);
				}
			}
		};
	}, [handleCreateShortcut, handleDeleteSelection, isMacPlatform]);

	const handleDragEnter = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		dragCounterRef.current += 1;
		if (e.dataTransfer.types.includes("Files")) {
			setIsDraggingOver(true);
		}
	}, []);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = "copy";
		}
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		dragCounterRef.current -= 1;
		if (dragCounterRef.current === 0) {
			setIsDraggingOver(false);
		}
	}, []);

	const handleDrop = useCallback(
		async (e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			dragCounterRef.current = 0;
			setIsDraggingOver(false);

			const files = Array.from(e.dataTransfer.files);
			if (files.length === 0) return;

			// Filter for markdown files only
			const markdownFiles = files.filter((file) =>
				isMarkdownFilePath(file.name),
			);

			if (markdownFiles.length === 0) {
				alert(
					"Only markdown files (.md) are supported at the moment.\n\nOpen an issue on GitHub for support for CSV, PDF, etc: https://github.com/opral/flashtype/issues",
				);
				return;
			}

			// Process each markdown file
			for (const file of markdownFiles) {
				try {
					const content = await file.text();

					const extension =
						file.name.match(/\.(md|markdown)$/i)?.[0]?.toLowerCase() ===
						".markdown"
							? ".markdown"
							: ".md";
					const baseName = normalizeNameStem(
						file.name.replace(/\.(md|markdown)$/i, ""),
					);
					let filePath = `/${baseName}${extension}`;

					let counter = 2;
					while (existingFilePaths.has(filePath)) {
						filePath = `/${baseName}-${counter}${extension}`;
						counter += 1;
					}

					// Add to pending paths immediately for UI feedback
					setPendingPaths((prev) => [...prev, filePath]);

					// Create the file in lix
					await qb(lix)
						.insertInto("lix_file")
						.values({
							path: filePath,
							data: new TextEncoder().encode(content),
						})
						.execute();
					// Open the first dropped file
					if (file === markdownFiles[0]) {
						const newFile = await qb(lix)
							.selectFrom("lix_file")
							.select("id")
							.where("path", "=", filePath)
							.executeTakeFirst();

						if (newFile?.id) {
							context?.openFile?.({
								panel: "central",
								fileId: newFile.id as string,
								filePath,
								documentOrigin: "new",
							});
						}
					}
				} catch (error) {
					console.error(`Failed to add file ${file.name}:`, error);
					alert(`Failed to add ${file.name}. Please try again.`);
				}
			}
		},
		[existingFilePaths, lix, context],
	);

	return (
		<div
			className="relative flex min-h-0 flex-1 flex-col p-2"
			onDragEnter={handleDragEnter}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			{/* New file button row - hidden when creation is active */}
			{!createRequest && (
				<button
					type="button"
					onClick={handleNewFile}
					className="mb-px flex h-7 w-full select-none items-center justify-between gap-2 rounded-[7px] px-2.25 text-left text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
					aria-label="New file"
					title="New file (⌘.)"
					data-attr="file-new"
				>
					<span className="flex items-center gap-2">
						<FilePlus
							className="size-3.25 text-[var(--color-icon-tertiary)]"
							strokeWidth={2}
						/>
						<span>New file</span>
					</span>
					<span className="text-[10px] font-semibold text-[var(--color-icon-tertiary)]">
						⌘ ·
					</span>
				</button>
			)}
			{isDraggingOver && (
				<div className="absolute inset-1 z-50 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-[var(--color-border-notice-warning)] bg-[color-mix(in_srgb,var(--color-bg-notice-warning)_50%,transparent)] backdrop-blur-sm pointer-events-none">
					<FileUp className="h-12 w-12 text-foreground" />
					<p className="mt-3 text-center text-sm font-medium text-foreground">
						Drop markdown files here
					</p>
					<p className="mt-1 text-center text-xs text-muted-foreground">
						Only .md and .markdown files supported
					</p>
					<p className="mt-1 text-center text-xs text-muted-foreground">
						Open{" "}
						<a
							href="https://github.com/opral/flashtype/issues"
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1 underline hover:text-foreground pointer-events-auto"
						>
							<Github className="size-3" aria-hidden="true" />
							an issue on GitHub
							<ExternalLink className="size-3" aria-hidden="true" />
						</a>{" "}
						for support for CSV, PDF, etc
					</p>
				</div>
			)}
			<div
				data-testid="files-view-tree-scroll"
				data-attr="file-tree"
				className="ph-mask min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1"
			>
				<FileTree
					nodes={nodes}
					openFileView={handleOpenFile}
					reviewPaths={pendingReviewPaths}
					onSelectItem={handleSelectItem}
					selectedPath={selectedPath ?? undefined}
					isPanelFocused={isPanelFocused}
					openDirectories={openDirectoryPaths}
					onOpenDirectoriesChange={handleOpenDirectoriesChange}
					createRequest={createRequest}
					onCreateCancel={handleCreateCancel}
					onCreateCommit={handleCreateCommit}
					onRenameCommit={handleRenameCommit}
				/>
			</div>
		</div>
	);
}

function usePendingExternalWriteReviewPaths(
	lix: Lix,
	nodes: readonly FilesystemTreeNode[],
): ReadonlySet<string> {
	const rangeRow = useQueryTakeFirst<{ value: unknown }>((lix) =>
		qb(lix)
			.selectFrom("lix_key_value_by_branch")
			.select("value")
			.where("key", "=", AGENT_TURN_COMMIT_RANGE_KEY)
			.where("lixcol_branch_id", "=", "global")
			.limit(1),
	);
	const ranges = useMemo(
		() =>
			isAgentTurnCommitRangeStore(rangeRow?.value) ? rangeRow.value.ranges : [],
		[rangeRow?.value],
	);
	const reviewableFiles = useMemo(
		() => collectReviewableTreeFiles(nodes),
		[nodes],
	);
	const [pendingPaths, setPendingPaths] = useState<ReadonlySet<string>>(
		() => new Set(),
	);

	useEffect(() => {
		let cancelled = false;
		if (ranges.length === 0 || reviewableFiles.length === 0) {
			setPendingPaths((prev) => (prev.size === 0 ? prev : new Set()));
			return;
		}
		void getPendingExternalWriteReviewPaths(lix, reviewableFiles, ranges)
			.then((nextPaths) => {
				if (cancelled) return;
				setPendingPaths((prev) =>
					sameStringSet(prev, nextPaths) ? prev : nextPaths,
				);
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				console.warn("Failed to resolve pending file reviews", error);
				setPendingPaths((prev) => (prev.size === 0 ? prev : new Set()));
			});
		return () => {
			cancelled = true;
		};
	}, [lix, ranges, reviewableFiles]);

	return pendingPaths;
}

function collectReviewableTreeFiles(
	nodes: readonly FilesystemTreeNode[],
): ExternalWriteReviewFile[] {
	const files: ExternalWriteReviewFile[] = [];
	const visit = (node: FilesystemTreeNode) => {
		if (node.type === "file") {
			if (node.source !== "watched") {
				files.push({ fileId: node.id, path: node.path });
			}
			return;
		}
		for (const child of node.children) {
			visit(child);
		}
	};
	for (const node of nodes) {
		visit(node);
	}
	return files;
}

function sameStringSet(
	left: ReadonlySet<string>,
	right: ReadonlySet<string>,
): boolean {
	if (left.size !== right.size) return false;
	for (const value of left) {
		if (!right.has(value)) return false;
	}
	return true;
}

/**
 * Files panel view definition used by the registry.
 *
 * @example
 * import { extension as filesView } from "@/extensions/files";
 */
export const extension = createReactExtensionDefinition({
	kind: FILES_EXTENSION_KIND,
	label: "Files",
	description: "Browse and pin project documents.",
	icon: Files,
	component: ({ context }) => (
		<LixProvider lix={context.lix}>
			<FilesView context={context} />
		</LixProvider>
	),
});

function isInteractiveTarget(target: EventTarget | null): boolean {
	if (!target || !(target instanceof HTMLElement)) {
		return false;
	}
	if (target.isContentEditable) return true;
	const tagName = target.tagName;
	if (tagName === "INPUT" || tagName === "TEXTAREA") {
		return true;
	}
	return Boolean(target.closest("input, textarea, [contenteditable]"));
}

function isInteractiveEventTarget(event: Event): boolean {
	for (const target of event.composedPath?.() ?? []) {
		if (isInteractiveTarget(target)) return true;
	}
	return isInteractiveTarget(event.target);
}

function detectMacPlatform(): boolean {
	if (typeof navigator === "undefined") return false;
	const platformCandidates = [
		((navigator as any).userAgentData?.platform as string | undefined) ?? null,
		navigator.platform ?? null,
		navigator.userAgent ?? null,
	].filter(Boolean) as string[];
	const combined = platformCandidates.join(" ").toLowerCase();
	return /mac|iphone|ipad|ipod/.test(combined);
}

function deriveMarkdownPathFromStem(
	stem: string,
	directory: string,
	existingPaths: Set<string>,
): string | null {
	const finalStem = normalizeNameStem(stem);
	const sanitizedDirectory =
		directory === "/"
			? "/"
			: directory.endsWith("/")
				? directory
				: `${directory}/`;
	const primary = `${sanitizedDirectory}${finalStem}.md`;
	if (!existingPaths.has(primary)) {
		return primary;
	}
	let suffix = 2;
	while (suffix < 1000) {
		const candidate = `${sanitizedDirectory}${finalStem}-${suffix}.md`;
		if (!existingPaths.has(candidate)) {
			return candidate;
		}
		suffix += 1;
	}
	return null;
}

function deriveDirectoryPathFromStem(
	stem: string,
	directory: string,
	existingPaths: Set<string>,
): string | null {
	const finalStem = normalizeNameStem(stem);
	const sanitizedDirectory =
		directory === "/"
			? "/"
			: directory.endsWith("/")
				? directory
				: `${directory}/`;
	const primary = `${sanitizedDirectory}${finalStem}/`;
	if (!existingPaths.has(primary)) {
		return primary;
	}
	let suffix = 2;
	while (suffix < 1000) {
		const candidate = `${sanitizedDirectory}${finalStem}-${suffix}/`;
		if (!existingPaths.has(candidate)) {
			return candidate;
		}
		suffix += 1;
	}
	return null;
}

function normalizeNameStem(stem: string): string {
	const normalized = (stem ?? "").trim();
	const slashSafe = normalized.replace(/\/+/g, "-");
	const collapsedWhitespace = slashSafe.replace(/\s+/g, "-");
	if (
		collapsedWhitespace.length === 0 ||
		collapsedWhitespace === "." ||
		collapsedWhitespace === ".."
	) {
		return "untitled";
	}
	return collapsedWhitespace;
}

function ensureDirectoryPath(path: string): string {
	if (path === "/") return "/";
	return path.endsWith("/") ? path : `${path}/`;
}

function normalizeFilePath(path: string): string {
	return path.endsWith("/") ? path.slice(0, -1) : path;
}

function remapDirectoryPath(
	path: string,
	sourcePath: string,
	destinationPath: string,
): string {
	const source = ensureDirectoryPath(sourcePath);
	const destination = ensureDirectoryPath(destinationPath);
	const normalized = ensureDirectoryPath(path);
	if (normalized === source) return destination;
	if (normalized.startsWith(source)) {
		return `${destination}${normalized.slice(source.length)}`;
	}
	return normalized;
}

function remapFilePath(
	path: string,
	sourcePath: string,
	destinationPath: string,
): string {
	const source = normalizeFilePath(sourcePath);
	const destination = normalizeFilePath(destinationPath);
	const normalized = normalizeFilePath(path);
	return normalized === source ? destination : normalized;
}

function remapFilePathInDirectory(
	path: string,
	sourcePath: string,
	destinationPath: string,
): string {
	const source = ensureDirectoryPath(sourcePath);
	const destination = ensureDirectoryPath(destinationPath);
	const normalized = normalizeFilePath(path);
	if (normalized.startsWith(source)) {
		return `${destination}${normalized.slice(source.length)}`;
	}
	return normalized;
}

function remapDirectoryPathSet(
	paths: ReadonlySet<string>,
	sourcePath: string,
	destinationPath: string,
): Set<string> {
	return new Set(
		[...paths].map((path) =>
			remapDirectoryPath(path, sourcePath, destinationPath),
		),
	);
}

function remapDirectoryPaths(
	paths: readonly string[],
	sourcePath: string,
	destinationPath: string,
): string[] {
	return paths.map((path) =>
		remapDirectoryPath(path, sourcePath, destinationPath),
	);
}

function remapFilePaths(
	paths: readonly string[],
	sourcePath: string,
	destinationPath: string,
): string[] {
	return paths.map((path) => remapFilePath(path, sourcePath, destinationPath));
}

function remapFilePathsInDirectory(
	paths: readonly string[],
	sourcePath: string,
	destinationPath: string,
): string[] {
	return paths.map((path) =>
		remapFilePathInDirectory(path, sourcePath, destinationPath),
	);
}

function appendUniquePath(paths: readonly string[], path: string): string[] {
	return paths.includes(path) ? [...paths] : [...paths, path];
}

function unionFilesystemEntries(
	lixEntries: readonly FilesystemEntryRow[],
	watchedEntries: readonly FilesystemEntryRow[],
): FilesystemEntryRow[] {
	const entriesByPath = new Map<string, FilesystemEntryRow>();
	for (const entry of watchedEntries) {
		entriesByPath.set(filesystemEntryPathKey(entry), {
			...entry,
			path: filesystemEntryPathKey(entry),
			source: "watched",
		});
	}
	for (const entry of lixEntries) {
		entriesByPath.set(filesystemEntryPathKey(entry), {
			...entry,
			path: filesystemEntryPathKey(entry),
			source: "lix",
		});
	}
	return [...entriesByPath.values()].sort((left, right) =>
		left.path.localeCompare(right.path),
	);
}

function filesystemEntryPathKey(entry: FilesystemEntryRow): string {
	if (entry.kind === "directory") {
		return ensureDirectoryPath(entry.path);
	}
	return entry.path.endsWith("/") ? entry.path.slice(0, -1) : entry.path;
}
