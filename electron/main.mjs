import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { disposeLixIpc, registerLixIpc } from "./ipc-lix.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:4173";

function createMainWindow() {
	const window = new BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 1000,
		minHeight: 700,
		show: false,
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});

	window.once("ready-to-show", () => {
		window.show();
	});

	window.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: "deny" };
	});

	if (app.isPackaged) {
		void window.loadFile(path.join(__dirname, "../dist/index.html"));
	} else {
		void window.loadURL(DEV_SERVER_URL);
	}
}

app.whenReady().then(() => {
	registerLixIpc();
	createMainWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createMainWindow();
		}
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("before-quit", () => {
	void disposeLixIpc();
});
