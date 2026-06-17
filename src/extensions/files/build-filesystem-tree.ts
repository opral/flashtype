import type { FilesystemEntryRow } from "@/queries";

export type FilesystemTreeFile = {
	type: "file";
	id: string;
	name: string;
	path: string;
};

export type FilesystemTreeDirectory = {
	type: "directory";
	id: string;
	name: string;
	path: string;
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

/**
 * Builds a nested tree from flat filesystem entries.
 *
 * @example
 * const tree = buildFilesystemTree(entries);
 */
export function buildFilesystemTree(
	entries: readonly FilesystemEntryRow[],
): FilesystemTreeNode[] {
	const directories = new Map<string, FilesystemTreeDirectory>();
	const roots: FilesystemTreeNode[] = [];

	for (const entry of entries) {
		if (entry.kind !== "directory") continue;
		if (hasDotPrefixedSegment(entry.path)) continue;
		directories.set(entry.id, {
			type: "directory",
			id: entry.id,
			name: entry.display_name,
			path: entry.path,
			children: [],
		});
	}

	for (const entry of entries) {
		if (entry.kind !== "directory") continue;
		if (hasDotPrefixedSegment(entry.path)) continue;
		const node = directories.get(entry.id);
		if (!node) continue;
		if (entry.parent_id && directories.has(entry.parent_id)) {
			const parent = directories.get(entry.parent_id)!;
			parent.children.push(node);
		} else {
			roots.push(node);
		}
	}

	for (const entry of entries) {
		if (entry.kind !== "file") continue;
		if (hasDotPrefixedSegment(entry.path)) continue;
		const fileNode: FilesystemTreeFile = {
			type: "file",
			id: entry.id,
			name: entry.display_name,
			path: entry.path,
		};
		if (entry.parent_id && directories.has(entry.parent_id)) {
			const parent = directories.get(entry.parent_id)!;
			parent.children.push(fileNode);
		} else {
			roots.push(fileNode);
		}
	}

	sortChildren(roots);
	return roots;
}
