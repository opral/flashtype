import type { FilesystemEntryRow } from "@/queries";

export type FilesystemTreeSource = "lix" | "watched";

export type FilesystemTreeFile = {
	type: "file";
	id: string;
	name: string;
	path: string;
	source?: FilesystemTreeSource;
};

export type FilesystemTreeDirectory = {
	type: "directory";
	id: string;
	name: string;
	path: string;
	source?: FilesystemTreeSource;
	children: FilesystemTreeNode[];
};

export type FilesystemTreeNode = FilesystemTreeFile | FilesystemTreeDirectory;

function sortChildren(nodes: FilesystemTreeNode[]): void {
	nodes.sort((a, b) => {
		if (a.type !== b.type) {
			return a.type === "directory" ? -1 : 1;
		}
		return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
	});
	for (const node of nodes) {
		if (node.type === "directory") {
			sortChildren(node.children);
		}
	}
}

function hasDotPrefixedSegment(path: string): boolean {
	return path.split("/").some((segment) => segment.startsWith("."));
}

function normalizeDirectoryPath(path: string): string {
	if (path === "/") return "/";
	return path.endsWith("/") ? path : `${path}/`;
}

function normalizeFilePath(path: string): string {
	return path.endsWith("/") ? path.slice(0, -1) : path;
}

function parentDirectoryPath(path: string, kind: "directory" | "file") {
	const normalized =
		kind === "directory"
			? normalizeDirectoryPath(path)
			: normalizeFilePath(path);
	const segments = normalized.split("/").filter(Boolean);
	segments.pop();
	if (segments.length === 0) return null;
	return `/${segments.join("/")}/`;
}

function normalizeEntryPath(entry: FilesystemEntryRow): string {
	return entry.kind === "directory"
		? normalizeDirectoryPath(entry.path)
		: normalizeFilePath(entry.path);
}

function preferLixEntry(
	existing: FilesystemEntryRow | undefined,
	next: FilesystemEntryRow,
): boolean {
	if (!existing) return true;
	return existing.source === "watched" && next.source !== "watched";
}

function normalizeAndDedupeEntries(
	entries: readonly FilesystemEntryRow[],
): FilesystemEntryRow[] {
	const entriesByPath = new Map<string, FilesystemEntryRow>();
	for (const entry of entries) {
		const path = normalizeEntryPath(entry);
		if (hasDotPrefixedSegment(path)) continue;
		const normalizedEntry = {
			...entry,
			path,
			source: entry.source ?? "lix",
		} satisfies FilesystemEntryRow;
		const existing = entriesByPath.get(path);
		if (preferLixEntry(existing, normalizedEntry)) {
			entriesByPath.set(path, normalizedEntry);
		}
	}
	return [...entriesByPath.values()];
}

/**
 * Builds a nested tree from flat filesystem entries.
 *
 * @example
 * const tree = buildFilesystemTree(entries);
 */
export function buildFilesystemTree(
	entries: readonly FilesystemEntryRow[],
): FilesystemTreeNode[] {
	const normalizedEntries = normalizeAndDedupeEntries(entries);
	const directories = new Map<string, FilesystemTreeDirectory>();
	const roots: FilesystemTreeNode[] = [];

	for (const entry of normalizedEntries) {
		if (entry.kind !== "directory") continue;
		const path = entry.path;
		directories.set(path, {
			type: "directory",
			id: entry.id,
			name: entry.display_name,
			path,
			source: entry.source,
			children: [],
		});
	}

	for (const entry of normalizedEntries) {
		if (entry.kind !== "directory") continue;
		const path = entry.path;
		const node = directories.get(path);
		if (!node) continue;
		const parentPath = parentDirectoryPath(path, "directory");
		if (parentPath && directories.has(parentPath)) {
			const parent = directories.get(parentPath)!;
			parent.children.push(node);
		} else {
			roots.push(node);
		}
	}

	for (const entry of normalizedEntries) {
		if (entry.kind !== "file") continue;
		const path = entry.path;
		const fileNode: FilesystemTreeFile = {
			type: "file",
			id: entry.id,
			name: entry.display_name,
			path,
			source: entry.source,
		};
		const parentPath = parentDirectoryPath(path, "file");
		if (parentPath && directories.has(parentPath)) {
			const parent = directories.get(parentPath)!;
			parent.children.push(fileNode);
		} else {
			roots.push(fileNode);
		}
	}

	sortChildren(roots);
	return roots;
}
