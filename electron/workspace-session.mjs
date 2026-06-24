import fs from "node:fs/promises";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

export const WORKSPACE_SESSION_FILE = "workspace-session.json";
export const WORKSPACE_SESSION_RECOVERY_BACKUP_FILE =
	"workspace-session.recovery-backup.json";
export const WORKSPACE_SESSION_BOOT_GUARD_FILE =
	"workspace-session-boot-in-progress";
export const WORKSPACE_SESSION_VERSION = 4;

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

export function recoverWorkspaceSessionAfterFailedBootSync(userDataPath) {
	if (!existsSync(getWorkspaceSessionBootGuardPath(userDataPath))) {
		return false;
	}

	try {
		const workspaceSessionPath = getWorkspaceSessionPath(userDataPath);
		const recoveryBackupPath =
			getWorkspaceSessionRecoveryBackupPath(userDataPath);
		if (existsSync(workspaceSessionPath) && !existsSync(recoveryBackupPath)) {
			copyFileSync(workspaceSessionPath, recoveryBackupPath);
		}
	} catch {
		// Recovery should still break the restore crash loop if backup fails.
	}

	writeWorkspaceSessionEntriesSync(userDataPath, []);
	return true;
}

export function markWorkspaceSessionBootInProgressSync(userDataPath) {
	mkdirSync(userDataPath, { recursive: true });
	writeFileSync(getWorkspaceSessionBootGuardPath(userDataPath), "", "utf8");
}

export function clearWorkspaceSessionBootInProgressSync(userDataPath) {
	rmSync(getWorkspaceSessionBootGuardPath(userDataPath), { force: true });
}

export async function filterExistingWorkspaceEntries(workspaceEntries) {
	const existingWorkspaceEntries = [];
	for (const workspaceEntry of normalizeWorkspaceSessionEntries(
		workspaceEntries,
	)) {
		try {
			if (!(await fs.stat(workspaceEntry.path)).isDirectory()) {
				continue;
			}
		} catch {
			// Ignore stale saved paths; explicit launch paths are handled elsewhere.
			continue;
		}

		const openFiles = [];
		for (const openFile of workspaceEntry.openFiles) {
			try {
				if ((await fs.stat(path.join(workspaceEntry.path, openFile))).isFile()) {
					openFiles.push(openFile);
				}
			} catch {
				// Drop stale open file paths while preserving the workspace path.
			}
		}
		existingWorkspaceEntries.push({ path: workspaceEntry.path, openFiles });
	}
	return existingWorkspaceEntries;
}

export function workspaceToSessionEntry(workspace, openFilePaths = []) {
	if (!workspace || typeof workspace.path !== "string" || workspace.path === "") {
		return null;
	}
	return {
		path: path.resolve(workspace.path),
		openFiles: normalizeWorkspaceRelativeOpenFiles(openFilePaths),
	};
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

export function normalizeWorkspaceRelativeOpenFiles(openFiles) {
	if (!Array.isArray(openFiles)) {
		return [];
	}

	const seen = new Set();
	const normalizedOpenFiles = [];
	for (const openFile of openFiles) {
		const normalizedOpenFile = normalizeWorkspaceRelativeOpenFile(openFile);
		if (!normalizedOpenFile || seen.has(normalizedOpenFile)) {
			continue;
		}
		seen.add(normalizedOpenFile);
		normalizedOpenFiles.push(normalizedOpenFile);
	}
	return normalizedOpenFiles;
}

export function mergeRestoredAndExplicitWorkspaceRequests(
	restoredWorkspaceEntries,
	explicitWorkspacePaths,
) {
	const normalizedExplicitWorkspacePaths = normalizeWorkspacePaths(
		explicitWorkspacePaths,
	);
	const restoredOnlyWorkspaceEntries = normalizeWorkspaceSessionEntries(
		restoredWorkspaceEntries,
	).filter(
		(workspaceEntry) =>
			!workspaceEntryOverlapsExplicitPaths(
				workspaceEntry,
				normalizedExplicitWorkspacePaths,
			),
	);

	return [...restoredOnlyWorkspaceEntries, ...normalizedExplicitWorkspacePaths];
}

export function getWorkspaceSessionPath(userDataPath) {
	return path.join(userDataPath, WORKSPACE_SESSION_FILE);
}

function getWorkspaceSessionRecoveryBackupPath(userDataPath) {
	return path.join(userDataPath, WORKSPACE_SESSION_RECOVERY_BACKUP_FILE);
}

function getWorkspaceSessionBootGuardPath(userDataPath) {
	return path.join(userDataPath, WORKSPACE_SESSION_BOOT_GUARD_FILE);
}

function normalizeWorkspaceSessionEntry(workspaceEntry) {
	if (!workspaceEntry || typeof workspaceEntry !== "object") {
		return null;
	}
	if (typeof workspaceEntry.path !== "string" || workspaceEntry.path === "") {
		return null;
	}
	return {
		path: path.resolve(workspaceEntry.path),
		openFiles: normalizeWorkspaceRelativeOpenFiles(workspaceEntry.openFiles),
	};
}

function normalizeWorkspaceRelativeOpenFile(openFile) {
	if (typeof openFile !== "string" || openFile.length === 0) {
		return null;
	}
	const portablePath = openFile.replaceAll("\\", "/").replace(/^\/+/, "");
	const segments = portablePath.split("/").filter(Boolean);
	if (segments.length === 0 || segments.some((segment) => segment === "..")) {
		return null;
	}
	if (segments[0] === ".lix") {
		return null;
	}
	return segments.join("/");
}

function workspaceSessionEntryKey(workspaceEntry) {
	return workspaceEntry.path;
}

function workspaceEntryOverlapsExplicitPaths(
	workspaceEntry,
	explicitWorkspacePaths,
) {
	return explicitWorkspacePaths.some(
		(explicitWorkspacePath) =>
			isSamePathOrInside(workspaceEntry.path, explicitWorkspacePath) ||
			isSamePathOrInside(explicitWorkspacePath, workspaceEntry.path),
	);
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
