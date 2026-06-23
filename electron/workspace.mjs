import { dialog, ipcMain } from "electron";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";

const LIX_DATABASE_FILE = path.join(".lix", ".internal", "db.sqlite");
const LEGACY_LIX_DATABASE_FILE = path.join(".lix", "db.sqlite");
const LIX_DATABASE_FILES = [LIX_DATABASE_FILE, LEGACY_LIX_DATABASE_FILE];

/**
 * The workspace is the folder Flashtype operates on. Each window has at most
 * one workspace; everything else (lix, terminal cwd, window title) derives
 * from that window's workspace. `null` means first run: the app renders
 * without a database until the user picks a folder.
 */
let registered = false;
const windowStates = new Map();

export function getWorkspace(window) {
	return getWindowState(window)?.workspace ?? null;
}

/**
 * Resolves a requested folder directly, or a requested file to the nearest
 * ancestor Lix workspace and the file path within that workspace.
 */
export async function resolveWorkspaceTarget(requestedPath, options = {}) {
	const resolved = path.resolve(requestedPath);
	try {
		const stats = await stat(resolved);
		if (stats.isFile()) {
			if (options.openFilesAsTransient === true) {
				const workspace = createTransientDirectoryWorkspace([resolved]);
				return {
					workspace,
					pendingOpenFilePaths:
						pendingOpenFilePathsForTransientDirectoryWorkspace(workspace),
				};
			}
			const workspaceDir = await findLixWorkspaceRoot(path.dirname(resolved));
			if (!workspaceDir) {
				const workspace = createTransientDirectoryWorkspace([resolved]);
				return {
					workspace,
					pendingOpenFilePaths:
						pendingOpenFilePathsForTransientDirectoryWorkspace(workspace),
				};
			}
			return {
				workspace: {
					ephemeral: false,
					path: workspaceDir,
					name: path.basename(workspaceDir),
				},
				pendingOpenFilePaths: [
					toPortableRelativePath(path.relative(workspaceDir, resolved)),
				],
			};
		}
	} catch {
		// Keep the resolved path for directories and unreadable paths; the lix
		// backend reports unreadable workspace folders.
	}
	return {
		workspace: {
			ephemeral: false,
			path: resolved,
			name: path.basename(resolved),
		},
		pendingOpenFilePaths: [],
	};
}

export async function resolveWorkspaceTargets(requestedPaths, options = {}) {
	const targets = [];
	const standaloneFiles = [];
	let standaloneFilesInsertIndex = null;

	for (let requestedPath of requestedPaths) {
		if (
			requestedPath &&
			typeof requestedPath === "object" &&
			typeof requestedPath.ephemeral === "boolean"
		) {
			const target = await resolveWorkspaceSessionEntry(requestedPath);
			if (target) {
				targets.push(target);
			}
			continue;
		}

		const resolved = path.resolve(String(requestedPath));
		const standaloneFileTarget = await resolveStandaloneFile(resolved, options);
		if (standaloneFileTarget) {
			if (options.openFilesAsTransient === true) {
				targets.push(
					await resolveWorkspaceTarget(standaloneFileTarget, options),
				);
				continue;
			}
			if (standaloneFilesInsertIndex === null) {
				standaloneFilesInsertIndex = targets.length;
			}
			standaloneFiles.push(standaloneFileTarget);
			continue;
		}
		targets.push(await resolveWorkspaceTarget(resolved, options));
	}

	if (standaloneFiles.length > 0) {
		const workspace = createTransientDirectoryWorkspace(standaloneFiles);
		targets.splice(standaloneFilesInsertIndex ?? targets.length, 0, {
			workspace,
			pendingOpenFilePaths:
				pendingOpenFilePathsForTransientDirectoryWorkspace(workspace),
		});
	}

	return targets;
}

export async function resolveDirectLaunchWorkspaceTargets(requestedPaths) {
	return await resolveWorkspaceTargets(requestedPaths, {
		openFilesAsTransient: true,
	});
}

export async function resolveWorkspace(requestedPath) {
	return (await resolveWorkspaceTarget(requestedPath)).workspace;
}

export async function setWorkspaceFromPath(
	requestedPath,
	window,
	options = {},
) {
	return await setWorkspaceFromTarget(
		await resolveWorkspaceTarget(requestedPath),
		window,
		options,
	);
}

export async function setWorkspaceFromTarget(target, window, options = {}) {
	const state = getOrCreateWindowState(window);
	return await enqueueWorkspaceChange(state, async () => {
		const nextWorkspace = target.workspace;
		if (workspaceKey(state.workspace) === workspaceKey(nextWorkspace)) {
			state.pendingOpenFilePaths = target.pendingOpenFilePaths;
			applyWindowChrome(window);
			await options.afterChange?.(state.workspace, window, target);
			return state.workspace;
		}
		await options.beforeChange?.(nextWorkspace, window);
		state.workspace = nextWorkspace;
		state.pendingOpenFilePaths = target.pendingOpenFilePaths;
		applyWindowChrome(window);
		await options.afterChange?.(state.workspace, window, target);
		return state.workspace;
	});
}

/**
 * Shows the native directory picker. Returns the new workspace, or null when
 * the user cancels (cancel keeps the current state; it is not an error).
 */
export async function openWorkspaceDialog(window, options = {}) {
	const result = await showWorkspaceDialog(window);
	const dir = result.filePaths[0];
	if (result.canceled || dir === undefined) {
		return null;
	}
	return await setWorkspaceFromPath(dir, window, options);
}

export async function exportWorkspaceLixFile(window) {
	const workspace = getWorkspace(window);
	if (!workspace) {
		throw new Error(
			"No workspace is open. Open a folder before exporting lix.",
		);
	}
	if (workspace.ephemeral === true) {
		throw new Error(
			"Cannot export a .lix database from a transient workspace.",
		);
	}
	const databasePath = await findLixDatabasePath(workspace.path);
	if (!databasePath) {
		throw new Error("The opened workspace does not have a .lix database.");
	}
	return await readFile(databasePath);
}

export function getWorkspaceLixDatabasePath(window) {
	const workspace = getWorkspace(window);
	if (!workspace) {
		throw new Error(
			"No workspace is open. Open a folder before exporting lix.",
		);
	}
	if (workspace.ephemeral === true) {
		throw new Error(
			"Transient workspaces do not have a .lix database on disk.",
		);
	}
	return path.join(workspace.path, LIX_DATABASE_FILE);
}

export function applyWorkspaceWindowChrome(window) {
	applyWindowChrome(window);
}

export function consumePendingOpenFiles(window) {
	const state = getWindowState(window);
	if (!state) return [];
	const pendingOpenFilePaths = state.pendingOpenFilePaths;
	state.pendingOpenFilePaths = [];
	return pendingOpenFilePaths ?? [];
}

function applyWindowChrome(window) {
	const workspace = getWorkspace(window);
	if (!workspace || !window || window.isDestroyed()) {
		return;
	}
	window.setTitle(workspace.name);
	// macOS proxy title: Cmd-click shows the folder's path popover.
	window.setRepresentedFilename(workspace.representedPath ?? workspace.path);
}

async function resolveWorkspaceSessionEntry(workspaceEntry) {
	if (workspaceEntry.ephemeral === false) {
		return await resolveWorkspaceTarget(workspaceEntry.path);
	}
	if (workspaceEntry.ephemeral === true) {
		const sourceFilePaths = [];
		for (const sourceFilePath of workspaceEntry.sourceFilePaths ?? []) {
			try {
				if ((await stat(sourceFilePath)).isFile()) {
					sourceFilePaths.push(path.resolve(sourceFilePath));
				}
			} catch {
				// Drop missing files from restored transient workspaces.
			}
		}
		if (sourceFilePaths.length === 0) {
			return null;
		}
		const workspace = createTransientDirectoryWorkspace(sourceFilePaths);
		return {
			workspace,
			pendingOpenFilePaths:
				pendingOpenFilePathsForTransientDirectoryWorkspace(workspace),
		};
	}
	return null;
}

async function resolveStandaloneFile(resolvedPath, options = {}) {
	try {
		if (!(await stat(resolvedPath)).isFile()) {
			return null;
		}
	} catch {
		return null;
	}
	if (options.openFilesAsTransient === true) {
		return resolvedPath;
	}
	const workspaceDir = await findLixWorkspaceRoot(path.dirname(resolvedPath));
	return workspaceDir ? null : resolvedPath;
}

function createTransientDirectoryWorkspace(sourceFilePaths) {
	const normalizedSourceFilePaths = normalizeSourceFilePaths(sourceFilePaths);
	const workspacePath = deepestCommonParent(
		normalizedSourceFilePaths.map((sourceFilePath) =>
			path.dirname(sourceFilePath),
		),
	);
	return {
		ephemeral: true,
		path: workspacePath,
		sourceFilePaths: normalizedSourceFilePaths,
		name: path.basename(workspacePath) || workspacePath,
	};
}

function pendingOpenFilePathsForTransientDirectoryWorkspace(workspace) {
	return (workspace.sourceFilePaths ?? []).map((sourceFilePath) =>
		toPortableRelativePath(path.relative(workspace.path, sourceFilePath)),
	);
}

function normalizeSourceFilePaths(sourceFilePaths) {
	const seen = new Set();
	const normalizedSourceFilePaths = [];
	for (const sourceFilePath of sourceFilePaths) {
		if (typeof sourceFilePath !== "string" || sourceFilePath.length === 0) {
			continue;
		}
		const normalizedSourceFilePath = path.resolve(sourceFilePath);
		if (seen.has(normalizedSourceFilePath)) {
			continue;
		}
		seen.add(normalizedSourceFilePath);
		normalizedSourceFilePaths.push(normalizedSourceFilePath);
	}
	return normalizedSourceFilePaths;
}

function toPortableRelativePath(relativePath) {
	return relativePath.split(path.sep).filter(Boolean).join("/");
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

function workspaceKey(workspace) {
	if (!workspace) {
		return null;
	}
	if (workspace.ephemeral === true) {
		return `ephemeral:${workspace.sourceFilePaths.join("\0")}`;
	}
	return `directory:${workspace.path}`;
}

async function showWorkspaceDialog(window) {
	const dialogOptions = {
		title: "Open Folder",
		buttonLabel: "Open",
		properties: ["openDirectory", "createDirectory"],
	};
	return window && !window.isDestroyed()
		? await dialog.showOpenDialog(window, dialogOptions)
		: await dialog.showOpenDialog(dialogOptions);
}

async function findLixWorkspaceRoot(startDir) {
	let current = path.resolve(startDir);
	while (true) {
		if ((await findLixDatabasePath(current)) !== null) {
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			return null;
		}
		current = parent;
	}
}

async function findLixDatabasePath(workspaceDir) {
	for (const databaseFile of LIX_DATABASE_FILES) {
		const databasePath = path.join(workspaceDir, databaseFile);
		if (await isFile(databasePath)) {
			return databasePath;
		}
	}
	return null;
}

async function isFile(filePath) {
	try {
		return (await stat(filePath)).isFile();
	} catch {
		return false;
	}
}

function enqueueWorkspaceChange(state, operation) {
	const result = state.workspaceChangeQueue.catch(() => {}).then(operation);
	state.workspaceChangeQueue = result.catch(() => {});
	return result;
}

export function registerWorkspaceIpc(getWindowForEvent, options = {}) {
	if (registered) {
		return;
	}
	registered = true;

	ipcMain.handle("workspace:get", (event) => {
		return getWorkspace(getWindowForEvent(event));
	});

	ipcMain.handle("workspace:consumePendingOpenFiles", (event) => {
		return consumePendingOpenFiles(getWindowForEvent(event));
	});

	ipcMain.handle("workspace:open", async (event, payload) => {
		const window = getWindowForEvent(event);
		const requestedPath = payload?.path;
		if (typeof requestedPath === "string" && requestedPath.length > 0) {
			return await setWorkspaceFromPath(requestedPath, window, options);
		}
		return await openWorkspaceDialog(window, options);
	});

	ipcMain.handle("workspace:openInNewWindow", async (event, payload) => {
		if (typeof options.openInNewWindow !== "function") {
			throw new Error("workspace.openInNewWindow is not available");
		}
		const sourceWindow = getWindowForEvent(event);
		const requestedPath = payload?.path;
		if (typeof requestedPath === "string" && requestedPath.length > 0) {
			return await options.openInNewWindow(requestedPath, sourceWindow);
		}

		const result = await showWorkspaceDialog(sourceWindow);
		const dir = result.filePaths[0];
		if (result.canceled || dir === undefined) {
			return null;
		}
		return await options.openInNewWindow(dir, sourceWindow);
	});
}

function getWindowState(window) {
	if (!window || window.isDestroyed()) {
		return null;
	}
	return windowStates.get(window.id) ?? null;
}

function getOrCreateWindowState(window) {
	if (!window || window.isDestroyed()) {
		throw new Error("A live window is required to open a workspace.");
	}
	const existing = windowStates.get(window.id);
	if (existing) {
		return existing;
	}
	const state = {
		workspace: null,
		pendingOpenFilePaths: [],
		workspaceChangeQueue: Promise.resolve(),
	};
	windowStates.set(window.id, state);
	window.once("closed", () => {
		windowStates.delete(window.id);
	});
	return state;
}
