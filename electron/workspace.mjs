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
export async function resolveWorkspaceTarget(requestedPath) {
	const resolved = path.resolve(requestedPath);
	try {
		const stats = await stat(resolved);
		if (stats.isFile()) {
			const workspaceDir = await findLixWorkspaceRoot(path.dirname(resolved));
			if (!workspaceDir) {
				return {
					workspace: {
						kind: "ephemeralFiles",
						path: resolved,
						sourceFilePath: resolved,
						name: path.basename(resolved),
					},
					pendingOpenFilePath: toLixFilePath(path.basename(resolved)),
				};
			}
			return {
				workspace: {
					kind: "directory",
					path: workspaceDir,
					name: path.basename(workspaceDir),
				},
				pendingOpenFilePath: toLixFilePath(
					path.relative(workspaceDir, resolved),
				),
			};
		}
	} catch {
		// Keep the resolved path for directories and unreadable paths; the lix
		// backend reports unreadable workspace folders.
	}
	return {
		workspace: {
			kind: "directory",
			path: resolved,
			name: path.basename(resolved),
		},
		pendingOpenFilePath: null,
	};
}

export async function resolveWorkspace(requestedPath) {
	return (await resolveWorkspaceTarget(requestedPath)).workspace;
}

export async function setWorkspaceFromPath(
	requestedPath,
	window,
	options = {},
) {
	const state = getOrCreateWindowState(window);
	return await enqueueWorkspaceChange(state, async () => {
		const target = await resolveWorkspaceTarget(requestedPath);
		const nextWorkspace = target.workspace;
		if (state.workspace?.path === nextWorkspace.path) {
			state.pendingOpenFilePath = target.pendingOpenFilePath;
			applyWindowChrome(window);
			return state.workspace;
		}
		await options.beforeChange?.(nextWorkspace, window);
		state.workspace = nextWorkspace;
		state.pendingOpenFilePath = target.pendingOpenFilePath;
		applyWindowChrome(window);
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
	if (workspace.kind === "ephemeralFiles") {
		throw new Error(
			"Cannot export a .lix database from an ephemeral file workspace.",
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
	if (workspace.kind === "ephemeralFiles") {
		throw new Error(
			"Ephemeral file workspaces do not have a .lix database on disk.",
		);
	}
	return path.join(workspace.path, LIX_DATABASE_FILE);
}

export function applyWorkspaceWindowChrome(window) {
	applyWindowChrome(window);
}

export function consumePendingOpenFile(window) {
	const state = getWindowState(window);
	if (!state) return null;
	const pendingOpenFilePath = state.pendingOpenFilePath;
	state.pendingOpenFilePath = null;
	return pendingOpenFilePath ?? null;
}

function applyWindowChrome(window) {
	const workspace = getWorkspace(window);
	if (!workspace || !window || window.isDestroyed()) {
		return;
	}
	window.setTitle(workspace.name);
	// macOS proxy title: Cmd-click shows the folder's path popover.
	window.setRepresentedFilename(workspace.path);
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

function toLixFilePath(relativePath) {
	return `/${relativePath.split(path.sep).filter(Boolean).join("/")}`;
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

	ipcMain.handle("workspace:consumePendingOpenFile", (event) => {
		return consumePendingOpenFile(getWindowForEvent(event));
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
		pendingOpenFilePath: null,
		workspaceChangeQueue: Promise.resolve(),
	};
	windowStates.set(window.id, state);
	window.once("closed", () => {
		windowStates.delete(window.id);
	});
	return state;
}
