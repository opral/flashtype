import fs from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const WORKSPACE_SESSION_FILE = "workspace-session.json";
export const WORKSPACE_SESSION_VERSION = 3;

export async function readWorkspaceSessionEntries(userDataPath) {
	try {
		const rawStore = await fs.readFile(getWorkspaceSessionPath(userDataPath), {
			encoding: "utf8",
		});
		const store = JSON.parse(rawStore);
		if (
			store?.version === WORKSPACE_SESSION_VERSION &&
			Array.isArray(store.workspaces)
		) {
			return normalizeWorkspaceSessionEntries(store.workspaces);
		}
		return [];
	} catch {
		return [];
	}
}

export async function writeWorkspaceSessionEntries(
	userDataPath,
	workspaceEntries,
) {
	await fs.mkdir(userDataPath, { recursive: true });
	await fs.writeFile(
		getWorkspaceSessionPath(userDataPath),
		serializeWorkspaceSessionEntries(workspaceEntries),
		"utf8",
	);
}

export function writeWorkspaceSessionEntriesSync(
	userDataPath,
	workspaceEntries,
) {
	mkdirSync(userDataPath, { recursive: true });
	writeFileSync(
		getWorkspaceSessionPath(userDataPath),
		serializeWorkspaceSessionEntries(workspaceEntries),
		"utf8",
	);
}

export async function filterExistingWorkspaceEntries(workspaceEntries) {
	const existingWorkspaceEntries = [];
	for (const workspaceEntry of normalizeWorkspaceSessionEntries(
		workspaceEntries,
	)) {
		if (workspaceEntry.ephemeral === false) {
			try {
				if ((await fs.stat(workspaceEntry.path)).isDirectory()) {
					existingWorkspaceEntries.push(workspaceEntry);
				}
			} catch {
				// Ignore stale saved paths; explicit launch paths are handled elsewhere.
			}
			continue;
		}

		if (workspaceEntry.ephemeral === true) {
			const sourceFilePaths = [];
			for (const sourceFilePath of workspaceEntry.sourceFilePaths) {
				try {
					if ((await fs.stat(sourceFilePath)).isFile()) {
						sourceFilePaths.push(sourceFilePath);
					}
				} catch {
					// Drop missing files from a restored transient workspace.
				}
			}
			if (sourceFilePaths.length > 0) {
				existingWorkspaceEntries.push({
					ephemeral: true,
					sourceFilePaths,
				});
			}
			continue;
		}
	}
	return existingWorkspaceEntries;
}

export function workspaceToSessionEntry(workspace) {
	if (!workspace) {
		return null;
	}
	if (workspace.ephemeral === false) {
		return {
			ephemeral: false,
			path: path.resolve(workspace.path),
		};
	}
	if (workspace.ephemeral === true) {
		const sourceFilePaths = normalizeWorkspacePaths(workspace.sourceFilePaths);
		if (sourceFilePaths.length === 0) {
			return null;
		}
		return {
			ephemeral: true,
			sourceFilePaths,
		};
	}
	return null;
}

export function normalizeWorkspaceSessionEntries(workspaceEntries) {
	if (!Array.isArray(workspaceEntries)) {
		return [];
	}

	const seen = new Set();
	const normalizedWorkspaceEntries = [];
	for (const workspaceEntry of workspaceEntries) {
		const normalizedWorkspaceEntry =
			normalizeWorkspaceSessionEntry(workspaceEntry);
		if (!normalizedWorkspaceEntry) {
			continue;
		}
		const key = workspaceSessionEntryKey(normalizedWorkspaceEntry);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		normalizedWorkspaceEntries.push(normalizedWorkspaceEntry);
	}
	return normalizedWorkspaceEntries;
}

export function normalizeWorkspacePaths(workspacePaths) {
	if (!Array.isArray(workspacePaths)) {
		return [];
	}

	const seen = new Set();
	const normalizedWorkspacePaths = [];
	for (const workspacePath of workspacePaths) {
		if (typeof workspacePath !== "string" || workspacePath.length === 0) {
			continue;
		}
		const normalizedWorkspacePath = path.resolve(workspacePath);
		if (seen.has(normalizedWorkspacePath)) {
			continue;
		}
		seen.add(normalizedWorkspacePath);
		normalizedWorkspacePaths.push(normalizedWorkspacePath);
	}
	return normalizedWorkspacePaths;
}

export function mergeRestoredAndExplicitWorkspaceRequests(
	restoredWorkspaceEntries,
	explicitWorkspacePaths,
) {
	const normalizedExplicitWorkspacePaths = normalizeWorkspacePaths(
		explicitWorkspacePaths,
	);
	const explicitWorkspacePathSet = new Set(normalizedExplicitWorkspacePaths);
	const restoredOnlyWorkspaceEntries = normalizeWorkspaceSessionEntries(
		restoredWorkspaceEntries,
	).filter(
		(workspaceEntry) =>
			!workspaceEntryOverlapsExplicitPaths(
				workspaceEntry,
				normalizedExplicitWorkspacePaths,
				explicitWorkspacePathSet,
			),
	);

	return [...restoredOnlyWorkspaceEntries, ...normalizedExplicitWorkspacePaths];
}

export function getWorkspaceSessionPath(userDataPath) {
	return path.join(userDataPath, WORKSPACE_SESSION_FILE);
}

function normalizeWorkspaceSessionEntry(workspaceEntry) {
	if (!workspaceEntry || typeof workspaceEntry !== "object") {
		return null;
	}
	if (workspaceEntry.ephemeral === false) {
		if (typeof workspaceEntry.path !== "string" || workspaceEntry.path === "") {
			return null;
		}
		return {
			ephemeral: false,
			path: path.resolve(workspaceEntry.path),
		};
	}
	if (workspaceEntry.ephemeral === true) {
		const sourceFilePaths = normalizeWorkspacePaths(
			workspaceEntry.sourceFilePaths,
		);
		if (sourceFilePaths.length === 0) {
			return null;
		}
		return {
			ephemeral: true,
			sourceFilePaths,
		};
	}
	return null;
}

function workspaceSessionEntryKey(workspaceEntry) {
	if (workspaceEntry.ephemeral === true) {
		return `ephemeral:${workspaceEntry.sourceFilePaths.join("\0")}`;
	}
	return `directory:${workspaceEntry.path}`;
}

function workspaceEntryOverlapsExplicitPaths(
	workspaceEntry,
	explicitWorkspacePaths,
	explicitWorkspacePathSet,
) {
	if (workspaceEntry.ephemeral === false) {
		return explicitWorkspacePaths.some(
			(explicitWorkspacePath) =>
				isSamePathOrInside(workspaceEntry.path, explicitWorkspacePath) ||
				isSamePathOrInside(explicitWorkspacePath, workspaceEntry.path),
		);
	}
	if (workspaceEntry.ephemeral === true) {
		return workspaceEntry.sourceFilePaths.some(
			(sourceFilePath) =>
				explicitWorkspacePathSet.has(sourceFilePath) ||
				explicitWorkspacePaths.some((explicitWorkspacePath) =>
					isSamePathOrInside(explicitWorkspacePath, sourceFilePath),
				),
		);
	}
	return false;
}

function isSamePathOrInside(parentPath, childPath) {
	if (childPath === parentPath) {
		return true;
	}
	const relativePath = path.relative(parentPath, childPath);
	return (
		relativePath.length > 0 &&
		!relativePath.startsWith("..") &&
		!path.isAbsolute(relativePath)
	);
}

function serializeWorkspaceSessionEntries(workspaceEntries) {
	return `${JSON.stringify(
		{
			version: WORKSPACE_SESSION_VERSION,
			workspaces: normalizeWorkspaceSessionEntries(workspaceEntries),
		},
		null,
		2,
	)}\n`;
}
