import { contextBridge, ipcRenderer } from "electron";

const lix = {
	open: () => ipcRenderer.invoke("lix:open"),
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
	stateCommitStreamOpen: (payload) =>
		ipcRenderer.invoke("lix:stateCommitStream:open", payload),
	stateCommitStreamTryNext: (payload) =>
		ipcRenderer.invoke("lix:stateCommitStream:tryNext", payload),
	stateCommitStreamClose: (payload) =>
		ipcRenderer.invoke("lix:stateCommitStream:close", payload),
	createVersion: (payload) => ipcRenderer.invoke("lix:createVersion", payload),
	switchVersion: (payload) => ipcRenderer.invoke("lix:switchVersion", payload),
	createCheckpoint: () => ipcRenderer.invoke("lix:createCheckpoint"),
	installPlugin: (payload) => ipcRenderer.invoke("lix:installPlugin", payload),
	exportSnapshot: () => ipcRenderer.invoke("lix:exportSnapshot"),
	close: () => ipcRenderer.invoke("lix:close"),
	wipe: () => ipcRenderer.invoke("lix:wipe"),
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
});
