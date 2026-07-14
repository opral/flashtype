import fs from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const RECENT_WORKSPACES_FILE = "recent-workspaces.json";
export const RECENT_WORKSPACES_VERSION = 1;
export const RECENT_WORKSPACES_LIMIT = 10;
export const MACOS_DOCK_RECENT_WORKSPACES_LIMIT = 10;

export async function readRecentWorkspaceEntries(userDataPath) {
	try {
		const rawStore = await fs.readFile(getRecentWorkspacesPath(userDataPath), {
			encoding: "utf8",
		});
		const store = JSON.parse(rawStore);
		if (
			store?.version === RECENT_WORKSPACES_VERSION &&
			Array.isArray(store.workspaces)
		) {
			return normalizeRecentWorkspaceEntries(store.workspaces);
		}
		return [];
	} catch {
		return [];
	}
}

export async function writeRecentWorkspaceEntries(
	userDataPath,
	workspaceEntries,
) {
	await fs.mkdir(userDataPath, { recursive: true });
	await fs.writeFile(
		getRecentWorkspacesPath(userDataPath),
		serializeRecentWorkspaceEntries(workspaceEntries),
		"utf8",
	);
}

export function writeRecentWorkspaceEntriesSync(
	userDataPath,
	workspaceEntries,
) {
	mkdirSync(userDataPath, { recursive: true });
	writeFileSync(
		getRecentWorkspacesPath(userDataPath),
		serializeRecentWorkspaceEntries(workspaceEntries),
		"utf8",
	);
}

export async function filterExistingRecentWorkspaceEntries(workspaceEntries) {
	const existingWorkspaceEntries = [];
	for (const workspaceEntry of normalizeRecentWorkspaceEntries(
		workspaceEntries,
	)) {
		try {
			if ((await fs.stat(workspaceEntry.path)).isDirectory()) {
				existingWorkspaceEntries.push(workspaceEntry);
			}
		} catch {
			// Drop stale recent folders.
		}
	}
	return existingWorkspaceEntries;
}

export async function getMacDockRecentWorkspacePaths(workspaceEntries) {
	const dockWorkspacePaths = [];
	for (const workspaceEntry of normalizeRecentWorkspaceEntries(
		workspaceEntries,
		{
			limit: Number.POSITIVE_INFINITY,
		},
	)) {
		if (dockWorkspacePaths.length >= MACOS_DOCK_RECENT_WORKSPACES_LIMIT) {
			break;
		}
		try {
			if ((await fs.stat(workspaceEntry.path)).isDirectory()) {
				dockWorkspacePaths.push(workspaceEntry.path);
			}
		} catch {
			// Drop stale recent folders from the native macOS Dock menu.
		}
	}
	// macOS Dock menus grow upward from the Dock. Adding oldest-to-newest places
	// the most recent workspace closest to the bottom, matching native apps/VS Code.
	return dockWorkspacePaths.reverse();
}

export function recentWorkspaceEntryFromWorkspace(workspace) {
	if (!workspace || workspace.ephemeral === true) {
		return null;
	}
	if (typeof workspace.path !== "string" || workspace.path.length === 0) {
		return null;
	}
	return {
		path: path.resolve(workspace.path),
		name:
			typeof workspace.name === "string" && workspace.name.length > 0
				? workspace.name
				: path.basename(workspace.path),
		lastOpenedAt: new Date().toISOString(),
	};
}

export function addRecentWorkspaceEntry(workspaceEntries, workspaceEntry) {
	const normalizedEntry = normalizeRecentWorkspaceEntry(workspaceEntry);
	if (!normalizedEntry) {
		return normalizeRecentWorkspaceEntries(workspaceEntries);
	}
	return normalizeRecentWorkspaceEntries([
		normalizedEntry,
		...normalizeRecentWorkspaceEntries(workspaceEntries).filter(
			(entry) => entry.path !== normalizedEntry.path,
		),
	]);
}

export function normalizeRecentWorkspaceEntries(
	workspaceEntries,
	{ limit = RECENT_WORKSPACES_LIMIT } = {},
) {
	if (!Array.isArray(workspaceEntries)) {
		return [];
	}

	const seen = new Set();
	const normalizedWorkspaceEntries = [];
	for (const workspaceEntry of workspaceEntries) {
		const normalizedWorkspaceEntry =
			normalizeRecentWorkspaceEntry(workspaceEntry);
		if (!normalizedWorkspaceEntry) {
			continue;
		}
		if (seen.has(normalizedWorkspaceEntry.path)) {
			continue;
		}
		seen.add(normalizedWorkspaceEntry.path);
		normalizedWorkspaceEntries.push(normalizedWorkspaceEntry);
		if (normalizedWorkspaceEntries.length >= limit) {
			break;
		}
	}
	return normalizedWorkspaceEntries;
}

export function recentWorkspaceLabel(workspaceEntry) {
	const normalizedWorkspaceEntry =
		normalizeRecentWorkspaceEntry(workspaceEntry);
	if (!normalizedWorkspaceEntry) {
		return "Unknown Workspace";
	}
	return normalizedWorkspaceEntry.name;
}

export function getRecentWorkspacesPath(userDataPath) {
	return path.join(userDataPath, RECENT_WORKSPACES_FILE);
}

function normalizeRecentWorkspaceEntry(workspaceEntry) {
	if (!workspaceEntry || typeof workspaceEntry !== "object") {
		return null;
	}
	if (typeof workspaceEntry.path !== "string" || workspaceEntry.path === "") {
		return null;
	}
	const resolvedPath = path.resolve(workspaceEntry.path);
	return {
		path: resolvedPath,
		name:
			typeof workspaceEntry.name === "string" && workspaceEntry.name.length > 0
				? workspaceEntry.name
				: path.basename(resolvedPath),
		lastOpenedAt:
			typeof workspaceEntry.lastOpenedAt === "string"
				? workspaceEntry.lastOpenedAt
				: null,
	};
}

function serializeRecentWorkspaceEntries(workspaceEntries) {
	return `${JSON.stringify(
		{
			version: RECENT_WORKSPACES_VERSION,
			workspaces: normalizeRecentWorkspaceEntries(workspaceEntries),
		},
		null,
		2,
	)}\n`;
}
