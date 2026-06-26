import { contextBridge, ipcRenderer, webUtils } from "electron";
import { resolveMarkdownImageSrc } from "./workspace-paths.mjs";

const app = {
	checkForUpdates: () => ipcRenderer.invoke("app:checkForUpdates"),
	getUpdateState: () => ipcRenderer.invoke("app:getUpdateState"),
	installUpdate: () => ipcRenderer.invoke("app:installUpdate"),
	openExternal: (payload) => ipcRenderer.invoke("app:openExternal", payload),
	onUpdateState: (listener) => {
		const wrapped = (_event, payload) => listener(payload);
		ipcRenderer.on("app:updateState", wrapped);
		return () => {
			ipcRenderer.off("app:updateState", wrapped);
		};
	},
};

const telemetry = {
	capture: (payload) => ipcRenderer.invoke("telemetry:capture", payload),
	getClientConfig: () => ipcRenderer.invoke("telemetry:getClientConfig"),
	setSessionContext: (payload) =>
		ipcRenderer.invoke("telemetry:setSessionContext", payload),
};

const workspace = {
	get: () => ipcRenderer.invoke("workspace:get"),
	getRecovery: () => ipcRenderer.invoke("workspace:getRecovery"),
	clearRecovery: () => ipcRenderer.invoke("workspace:clearRecovery"),
	consumePendingOpenFiles: () =>
		ipcRenderer.invoke("workspace:consumePendingOpenFiles"),
	setEphemeralWatchedDirectories: (payload) =>
		ipcRenderer.invoke("workspace:setEphemeralWatchedDirectories", payload),
	onEphemeralWatchedFileTreeChanged: (listener) => {
		const wrapped = (_event, payload) => listener(payload);
		ipcRenderer.on("workspace:ephemeralWatchedFileTreeChanged", wrapped);
		return () => {
			ipcRenderer.off("workspace:ephemeralWatchedFileTreeChanged", wrapped);
		};
	},
	readEphemeralFile: (payload) =>
		ipcRenderer.invoke("workspace:readEphemeralFile", payload),
	profile: () => ipcRenderer.invoke("workspace:profile"),
	onNewFile: (listener) => {
		const wrapped = () => listener();
		ipcRenderer.on("workspace:newFile", wrapped);
		return () => {
			ipcRenderer.off("workspace:newFile", wrapped);
		};
	},
	open: (payload) => ipcRenderer.invoke("workspace:open", payload),
	openInNewWindow: (payload) =>
		ipcRenderer.invoke("workspace:openInNewWindow", payload),
	setActiveFilePath: (payload) =>
		ipcRenderer.invoke("workspace:setActiveFilePath", payload),
	setOpenFilePaths: (payload) =>
		ipcRenderer.invoke("workspace:setOpenFilePaths", payload),
	exportLixFile: () => ipcRenderer.invoke("workspace:exportLixFile"),
	resetLixRepository: () => ipcRenderer.invoke("workspace:resetLixRepository"),
	disableTrackChanges: () =>
		ipcRenderer.invoke("workspace:disableTrackChanges"),
	resolveMarkdownImageSrc: (payload) => resolveMarkdownImageSrc(payload),
	// Resolves the on-disk path of a File dropped onto the window.
	getPathForFile: (file) => webUtils.getPathForFile(file),
};

const lix = {
	open: () => ipcRenderer.invoke("lix:open"),
	workspaceDir: () => ipcRenderer.invoke("lix:workspaceDir"),
	execute: (payload) => ipcRenderer.invoke("lix:execute", payload),
	executeTransaction: (payload) =>
		ipcRenderer.invoke("lix:executeTransaction", payload),
	transactionBegin: (payload) =>
		ipcRenderer.invoke("lix:transaction:begin", payload),
	transactionExecute: (payload) =>
		ipcRenderer.invoke("lix:transaction:execute", payload),
	transactionCommit: (payload) =>
		ipcRenderer.invoke("lix:transaction:commit", payload),
	transactionRollback: (payload) =>
		ipcRenderer.invoke("lix:transaction:rollback", payload),
	observeStart: (payload) => ipcRenderer.invoke("lix:observe:start", payload),
	observeNext: (payload) => ipcRenderer.invoke("lix:observe:next", payload),
	observeClose: (payload) => ipcRenderer.invoke("lix:observe:close", payload),
	activeBranchId: () => ipcRenderer.invoke("lix:activeBranchId"),
	createBranch: (payload) => ipcRenderer.invoke("lix:createBranch", payload),
	switchBranch: (payload) => ipcRenderer.invoke("lix:switchBranch", payload),
	close: () => ipcRenderer.invoke("lix:close"),
};

const terminal = {
	create: (payload) => ipcRenderer.invoke("terminal:create", payload),
	write: (payload) => ipcRenderer.invoke("terminal:write", payload),
	resize: (payload) => ipcRenderer.invoke("terminal:resize", payload),
	kill: (payload) => ipcRenderer.invoke("terminal:kill", payload),
	onData: (listener) => {
		const wrapped = (_event, payload) => listener(payload);
		ipcRenderer.on("terminal:data", wrapped);
		return () => {
			ipcRenderer.off("terminal:data", wrapped);
		};
	},
	onExit: (listener) => {
		const wrapped = (_event, payload) => listener(payload);
		ipcRenderer.on("terminal:exit", wrapped);
		return () => {
			ipcRenderer.off("terminal:exit", wrapped);
		};
	},
};

contextBridge.exposeInMainWorld("flashtypeDesktop", {
	app,
	platform: process.platform,
	telemetry,
	lix,
	terminal,
	workspace,
});
