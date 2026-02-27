import { contextBridge, ipcRenderer } from "electron";

const lix = {
	open: () => ipcRenderer.invoke("lix:open"),
	execute: (payload) => ipcRenderer.invoke("lix:execute", payload),
	executeTransaction: (payload) =>
		ipcRenderer.invoke("lix:executeTransaction", payload),
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

contextBridge.exposeInMainWorld("flashtypeDesktop", {
	platform: process.platform,
	lix,
});
