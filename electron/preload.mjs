import { contextBridge, ipcRenderer, webUtils } from "electron";

const workspace = {
	get: () => ipcRenderer.invoke("workspace:get"),
	open: (payload) => ipcRenderer.invoke("workspace:open", payload),
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
	exportSnapshot: () => ipcRenderer.invoke("lix:exportSnapshot"),
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
	platform: process.platform,
	lix,
	terminal,
	workspace,
});
