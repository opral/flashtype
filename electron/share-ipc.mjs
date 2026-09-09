import { ipcMain } from "electron";
import { closeLixSession } from "./ipc-lix.mjs";
import { ensureLixOpen } from "./lix.mjs";
import { getWorkspace } from "./workspace.mjs";
import { getShareRuntime } from "./share-runtime.mjs";
import { createShareService } from "./share-service.mjs";

export function registerShareIpc(resolveWindow) {
	const runtime = getShareRuntime();
	const service = createShareService({ runtime, getLix: ensureLixOpen });
	const context = (event) => {
		const window = resolveWindow(event);
		const workspace = window && getWorkspace(window);
		if (!window || window.isDestroyed() || !workspace)
			throw new Error("Open a workspace first.");
		return { window, workspace };
	};
	const file = (value) => {
		if (
			typeof value !== "string" ||
			!value.startsWith("/") ||
			value.includes("\\") ||
			[...value].some((character) => character.charCodeAt(0) < 32) ||
			value
				.split("/")
				.slice(1)
				.some((p) => !p || p === "." || p === "..")
		)
			throw new Error("A file path is required.");
		return value;
	};
	ipcMain.handle("share:reconnect", async (event) => {
		const { window } = context(event);
		await closeLixSession(window);
		if (!window.isDestroyed()) window.webContents.reload();
	});
	ipcMain.handle("share:setToken", (event, token) => {
		context(event);
		return runtime.auth.setToken(token);
	});
	ipcMain.handle("share:status", (event, filePath) =>
		service.status(context(event).workspace, file(filePath)),
	);
	ipcMain.handle("share:connect", (event, confirmed) => {
		if (confirmed !== true)
			throw new Error("Confirm private repository sync before connecting.");
		const { window, workspace } = context(event);
		return service.connect(workspace, window);
	});
	ipcMain.handle("share:publish", (event, filePath, publish) => {
		if (typeof publish !== "boolean")
			throw new Error("Invalid publication action.");
		const { window, workspace } = context(event);
		return service.publish(workspace, window, file(filePath), publish);
	});
}
