import fs from "node:fs/promises";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import {
	uniqueWorkspaceRelativeFilePaths,
	workspaceLocalFilePath,
	workspaceRelativeFilePath,
} from "./workspace-paths.mjs";

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
		if (store?.version === 3 && Array.isArray(store.workspaces)) {
			return normalizeLegacyWorkspaceSessionEntries(store.workspaces);
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

		const openFilePaths = [];
		for (const openFilePath of workspaceEntry.openFilePaths) {
			const localFilePath = workspaceLocalFilePath(
				workspaceEntry.path,
				openFilePath,
			);
			if (!localFilePath) {
				continue;
			}
			try {
				if ((await fs.stat(localFilePath)).isFile()) {
					openFilePaths.push(openFilePath);
				}
			} catch {
				// Drop stale open file paths while preserving the workspace path.
			}
		}
		existingWorkspaceEntries.push({ path: workspaceEntry.path, openFilePaths });
	}
	return existingWorkspaceEntries;
}

export function workspaceToSessionEntry(workspace, openFilePaths = []) {
	if (
		!workspace ||
		typeof workspace.path !== "string" ||
		workspace.path === ""
	) {
		return null;
	}
	return {
		path: path.resolve(workspace.path),
		openFilePaths: normalizeWorkspaceOpenFilePaths(openFilePaths),
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

function normalizeLegacyWorkspaceSessionEntries(workspaceEntries) {
	return mergeWorkspaceSessionEntries(
		workspaceEntries
			.map(normalizeLegacyWorkspaceSessionEntry)
			.filter((workspaceEntry) => workspaceEntry !== null),
	);
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

export function normalizeWorkspaceOpenFilePaths(openFilePaths) {
	if (!Array.isArray(openFilePaths)) {
		return [];
	}

	return uniqueWorkspaceRelativeFilePaths(openFilePaths);
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
		openFilePaths: normalizeWorkspaceOpenFilePaths(
			workspaceEntry.openFilePaths,
		),
	};
}

function normalizeLegacyWorkspaceSessionEntry(workspaceEntry) {
	if (!workspaceEntry || typeof workspaceEntry !== "object") {
		return null;
	}
	if (workspaceEntry.ephemeral === false) {
		if (typeof workspaceEntry.path !== "string" || workspaceEntry.path === "") {
			return null;
		}
		return { path: path.resolve(workspaceEntry.path), openFilePaths: [] };
	}
	if (workspaceEntry.ephemeral === true) {
		const sourceFilePaths = normalizeWorkspacePaths(
			workspaceEntry.sourceFilePaths,
		);
		if (sourceFilePaths.length === 0) {
			return null;
		}
		const workspacePath = deepestCommonParent(
			sourceFilePaths.map((sourceFilePath) => path.dirname(sourceFilePath)),
		);
		return {
			path: workspacePath,
			openFilePaths: normalizeWorkspaceOpenFilePaths(
				sourceFilePaths
					.map((sourceFilePath) =>
						workspaceRelativeFilePath(workspacePath, sourceFilePath),
					)
					.filter(Boolean),
			),
		};
	}
	return null;
}

function workspaceSessionEntryKey(workspaceEntry) {
	return workspaceEntry.path;
}

function mergeWorkspaceSessionEntries(workspaceEntries) {
	const entriesByPath = new Map();
	for (const workspaceEntry of workspaceEntries) {
		const existing = entriesByPath.get(workspaceEntry.path);
		if (!existing) {
			entriesByPath.set(workspaceEntry.path, workspaceEntry);
			continue;
		}
		existing.openFilePaths = normalizeWorkspaceOpenFilePaths([
			...existing.openFilePaths,
			...workspaceEntry.openFilePaths,
		]);
	}
	return [...entriesByPath.values()];
}

function deepestCommonParent(directories) {
	if (directories.length === 0) {
		return path.resolve(".");
	}
	const [firstDirectory, ...remainingDirectories] = directories.map(
		(directory) => path.resolve(directory),
	);
	const root = path.parse(firstDirectory).root;
	const commonSegments = firstDirectory
		.slice(root.length)
		.split(path.sep)
		.filter(Boolean);
	for (const directory of remainingDirectories) {
		const directoryRoot = path.parse(directory).root;
		if (directoryRoot !== root) {
			return root;
		}
		const segments = directory
			.slice(root.length)
			.split(path.sep)
			.filter(Boolean);
		let index = 0;
		while (
			index < commonSegments.length &&
			index < segments.length &&
			commonSegments[index] === segments[index]
		) {
			index += 1;
		}
		commonSegments.length = index;
	}
	return path.join(root, ...commonSegments);
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
