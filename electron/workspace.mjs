import { dialog, ipcMain } from "electron";
import path from "node:path";
import { stat } from "node:fs/promises";

/**
 * The workspace is the folder Flashtype operates on. One window has at most
 * one workspace; everything else (lix, terminal cwd, window title) derives
 * from it. `null` means first run: the app renders without a database until
 * the user picks a folder.
 */
let workspace = null;
let registered = false;

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

export async function setWorkspaceFromPath(requestedPath, window) {
	workspace = await resolveWorkspace(requestedPath);
	applyWindowChrome(window);
	return workspace;
}

/**
 * Shows the native directory picker. Returns the new workspace, or null when
 * the user cancels (cancel keeps the current state; it is not an error).
 */
export async function openWorkspaceDialog(window) {
	const options = {
		title: "Open Folder",
		buttonLabel: "Open",
		properties: ["openDirectory", "createDirectory"],
	};
	const result =
		window && !window.isDestroyed()
			? await dialog.showOpenDialog(window, options)
			: await dialog.showOpenDialog(options);
	const dir = result.filePaths[0];
	if (result.canceled || dir === undefined) {
		return null;
	}
	return await setWorkspaceFromPath(dir, window);
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

export function registerWorkspaceIpc(getWindowForEvent) {
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
			return await setWorkspaceFromPath(requestedPath, window);
		}
		return await openWorkspaceDialog(window);
	});
}
