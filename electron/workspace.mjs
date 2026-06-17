import { dialog, ipcMain } from "electron";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";

const LIX_DATABASE_FILE = path.join(".lix", "db.sqlite");

/**
 * The workspace is the folder Flashtype operates on. One window has at most
 * one workspace; everything else (lix, terminal cwd, window title) derives
 * from it. `null` means first run: the app renders without a database until
 * the user picks a folder.
 */
let workspace = null;
let registered = false;
let workspaceChangeQueue = Promise.resolve();

export function getWorkspace() {
	return workspace;
}

/**
 * Resolves a requested path (folder, or a file whose parent folder is meant)
 * to a workspace descriptor.
 */
export async function resolveWorkspace(requestedPath) {
	const resolved = path.resolve(requestedPath);
	let dir = resolved;
	try {
		const stats = await stat(resolved);
		if (stats.isFile()) {
			dir = path.dirname(resolved);
		}
	} catch {
		// Keep the resolved path; the lix backend reports unreadable paths.
	}
	return { path: dir, name: path.basename(dir) };
}

export async function setWorkspaceFromPath(requestedPath, window, options = {}) {
	return await enqueueWorkspaceChange(async () => {
		const nextWorkspace = await resolveWorkspace(requestedPath);
		if (workspace?.path === nextWorkspace.path) {
			applyWindowChrome(window);
			return workspace;
		}
		await options.beforeChange?.(nextWorkspace);
		workspace = nextWorkspace;
		applyWindowChrome(window);
		return workspace;
	});
}

/**
 * Shows the native directory picker. Returns the new workspace, or null when
 * the user cancels (cancel keeps the current state; it is not an error).
 */
export async function openWorkspaceDialog(window, options = {}) {
	const dialogOptions = {
		title: "Open Folder",
		buttonLabel: "Open",
		properties: ["openDirectory", "createDirectory"],
	};
	const result =
		window && !window.isDestroyed()
			? await dialog.showOpenDialog(window, dialogOptions)
			: await dialog.showOpenDialog(dialogOptions);
	const dir = result.filePaths[0];
	if (result.canceled || dir === undefined) {
		return null;
	}
	return await setWorkspaceFromPath(dir, window, options);
}

export async function exportWorkspaceLixFile() {
	if (!workspace) {
		throw new Error(
			"No workspace is open. Open a folder before exporting lix.",
		);
	}
	return await readFile(getWorkspaceLixDatabasePath());
}

export function getWorkspaceLixDatabasePath() {
	if (!workspace) {
		throw new Error(
			"No workspace is open. Open a folder before exporting lix.",
		);
	}
	return path.join(workspace.path, LIX_DATABASE_FILE);
}

export function applyWorkspaceWindowChrome(window) {
	applyWindowChrome(window);
}

function applyWindowChrome(window) {
	if (!workspace || !window || window.isDestroyed()) {
		return;
	}
	window.setTitle(workspace.name);
	// macOS proxy title: Cmd-click shows the folder's path popover.
	window.setRepresentedFilename(workspace.path);
}

function enqueueWorkspaceChange(operation) {
	const result = workspaceChangeQueue.catch(() => {}).then(operation);
	workspaceChangeQueue = result.catch(() => {});
	return result;
}

export function registerWorkspaceIpc(getWindowForEvent, options = {}) {
	if (registered) {
		return;
	}
	registered = true;

	ipcMain.handle("workspace:get", () => {
		return workspace;
	});

	ipcMain.handle("workspace:open", async (event, payload) => {
		const window = getWindowForEvent(event);
		const requestedPath = payload?.path;
		if (typeof requestedPath === "string" && requestedPath.length > 0) {
			return await setWorkspaceFromPath(requestedPath, window, options);
		}
		return await openWorkspaceDialog(window, options);
	});
}
