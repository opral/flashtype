import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Files, FileUp, FilePlus, Github } from "lucide-react";
import { LixProvider, useLix, useQuery } from "@/lib/lix-react";
import { isMarkdownFilePath } from "@/extension-runtime/file-handlers";
import { selectFilesystemEntries } from "@/queries";
import { buildFilesystemTree } from "@/extensions/files/build-filesystem-tree";
import type { ExtensionContext } from "../../extension-runtime/types";
import { FileTree } from "./file-tree";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { qb } from "@/lib/lix-kysely";
import { FILES_EXTENSION_KIND } from "../../extension-runtime/extension-instance-helpers";
import type { FilesystemEntryRow } from "@/queries";

type FilesViewProps = {
	readonly context?: ExtensionContext;
};

type DraftState = {
	kind: "file" | "directory";
	directoryPath: string;
	value: string;
} | null;

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
	const nodes = useMemo(() => buildFilesystemTree(entries ?? []), [entries]);
	const creatingRef = useRef(false);
	const [pendingPaths, setPendingPaths] = useState<string[]>([]);
	const [pendingDirectoryPaths, setPendingDirectoryPaths] = useState<string[]>(
		[],
	);
	const [draft, setDraft] = useState<DraftState>(null);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
	const [selectedKind, setSelectedKind] = useState<"file" | "directory" | null>(
		null,
	);
	const [isDraggingOver, setIsDraggingOver] = useState(false);
	const dragCounterRef = useRef(0);
	const entryPathSet = useMemo(() => {
		return new Set(
			(entries ?? [])
				.filter((entry) => entry.kind === "file")
				.map((entry) => entry.path),
		);
	}, [entries]);
	const entryDirectorySet = useMemo(() => {
		return new Set(
			(entries ?? [])
				.filter((entry) => entry.kind === "directory")
				.map((entry) => entry.path),
		);
	}, [entries]);
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

	const resolveDraftDirectory = useCallback(() => {
		if (!selectedPath) return "/";
		if (selectedPath.endsWith("/")) return selectedPath;
		const parts = selectedPath.split("/").filter(Boolean);
		if (parts.length <= 1) return "/";
		return `/${parts.slice(0, -1).join("/")}/`;
	}, [selectedPath]);

	const handleDraftChange = useCallback((next: string) => {
		setDraft((prev) => (prev ? { ...prev, value: next } : prev));
	}, []);

	const handleDraftCancel = useCallback(() => {
		setDraft(null);
	}, []);

	const handleNewFile = useCallback(() => {
		const baseDirectory = resolveDraftDirectory();
		const directoryPath = ensureDirectoryPath(baseDirectory);
		setDraft((prev) => {
			if (prev) return prev;
			setSelectedPath(null);
			setSelectedFileId(null);
			setSelectedKind(null);
			return {
				kind: "file",
				directoryPath,
				value: "new-file",
			};
		});
	}, [resolveDraftDirectory]);

	const handleDraftCommit = useCallback(async () => {
		if (creatingRef.current) return;
		if (!draft) return;
		const executeFileCreation = async () => {
			const path = deriveMarkdownPathFromStem(
				draft.value,
				draft.directoryPath,
				existingFilePaths,
			);
			if (!path) {
				setDraft(null);
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
					state: { focusOnLoad: true },
					focus: true,
				});
			} catch (error) {
				console.error("Failed to create file", error);
			} finally {
				creatingRef.current = false;
				setDraft(null);
			}
		};

		const executeDirectoryCreation = async () => {
			const path = deriveDirectoryPathFromStem(
				draft.value,
				draft.directoryPath,
				existingDirectoryPaths,
			);
			if (!path) {
				setDraft(null);
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
				setDraft(null);
			}
		};

		if (draft.kind === "directory") {
			return executeDirectoryCreation();
		}
		return executeFileCreation();
	}, [context, draft, existingDirectoryPaths, existingFilePaths, lix]);

	const handleOpenFile = useCallback(
		async (fileId: string, path: string) => {
			setSelectedPath(path);
			setSelectedFileId(fileId);
			setSelectedKind("file");
			context?.openFile?.({
				panel: "central",
				fileId,
				filePath: path,
				focus: false,
			});
		},
		[context],
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
				const shouldHandleDelete = !isInteractiveTarget(event.target);
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
				!isInteractiveTarget(event.target)
			) {
				const kind = event.shiftKey ? "directory" : "file";
				const baseDirectory = resolveDraftDirectory();
				const directoryPath = ensureDirectoryPath(baseDirectory);
				setDraft((prev) => {
					if (prev) return prev;
					setSelectedPath(null);
					setSelectedKind(null);
					return {
						kind,
						directoryPath,
						value: kind === "directory" ? "new-directory" : "new-file",
					};
				});
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
	}, [handleDeleteSelection, isMacPlatform, resolveDraftDirectory]);

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
			{/* New file button row - hidden when draft is active */}
			{!draft && (
				<button
					type="button"
					onClick={handleNewFile}
					className="mb-px flex h-7 w-full select-none items-center justify-between gap-2 rounded-[7px] px-2.25 text-left text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
					aria-label="New file"
					title="New file (⌘.)"
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
				className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1"
			>
				<FileTree
					nodes={nodes}
					openFileView={handleOpenFile}
					onSelectItem={handleSelectItem}
					selectedPath={selectedPath ?? undefined}
					isPanelFocused={isPanelFocused}
					draft={
						draft
							? {
									kind: draft.kind,
									directoryPath: draft.directoryPath,
									value: draft.value,
									onChange: handleDraftChange,
									onCommit: handleDraftCommit,
									onCancel: handleDraftCancel,
								}
							: null
					}
				/>
			</div>
		</div>
	);
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
