import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { closeLixSession, disposeLixIpc, registerLixIpc } from "./ipc-lix.mjs";
import { disposeTerminalIpc, registerTerminalIpc } from "./ipc-terminal.mjs";
import {
	applyWorkspaceWindowChrome,
	getWorkspace,
	registerWorkspaceIpc,
	setWorkspaceFromPath,
} from "./workspace.mjs";
import { captureAppOpened } from "./telemetry.mjs";
import {
	APP_NAME,
	registerMarkdownDefaultHandler,
} from "./markdown-default-handler.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const AUTO_UPDATE_CHECK_DELAY_MS = 10_000;
const DEV_SERVER_URL =
	process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:4173";
let mainWindow = null;
let autoUpdaterInstance = null;
let autoUpdateListenersRegistered = false;
let updateCheckInProgress = false;
let updateDownloadInProgress = false;
let updateInstallReady = false;
let pendingManualUpdateCheck = false;
let updateWindow = null;
let updateWindowCloseTimer = null;
let updateIconDataUrl = null;

app.setName(APP_NAME);
app.setAboutPanelOptions({
	applicationName: APP_NAME,
	copyright: "Copyright © 2026 Opral US Inc.",
});

app.on("open-file", (event, filePath) => {
	event.preventDefault();
	// Opening a file from Finder adopts its folder as the workspace, but only
	// before one is open — a window is bound to exactly one workspace.
	if (!getWorkspace()) {
		void setWorkspaceFromPath(filePath, mainWindow);
	}
});

function getWorkspacePathArgument(argv) {
	// Playwright/Electron can prepend runtime flags before app arguments.
	const appArguments = argv.slice(1).filter((argument) => {
		return argument !== "--" && !argument.startsWith("--");
	});
	if (process.defaultApp === true) {
		appArguments.shift();
	}
	return appArguments[0];
}

function createMainWindow() {
	if (mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.focus();
		return mainWindow;
	}

	mainWindow = new BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 1000,
		minHeight: 700,
		show: false,
		autoHideMenuBar: true,
		...(process.platform === "darwin"
			? {
					titleBarStyle: "hiddenInset",
					trafficLightPosition: { x: 16, y: 10 },
				}
			: {}),
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});

	const window = mainWindow;
	const showFallback = setTimeout(() => {
		if (window.isDestroyed() || window.isVisible()) {
			return;
		}
		window.show();
	}, 3000);

	applyWorkspaceWindowChrome(window);

	window.once("ready-to-show", () => {
		if (window.isDestroyed()) {
			return;
		}
		window.show();
		window.focus();
	});

	window.on("closed", () => {
		clearTimeout(showFallback);
		if (mainWindow === window) {
			mainWindow = null;
		}
	});

	window.webContents.on(
		"did-fail-load",
		(_event, errorCode, errorDescription, validatedURL) => {
			console.error(
				`Failed to load ${validatedURL} (${errorCode}): ${errorDescription}`,
			);
			if (!window.isDestroyed() && !window.isVisible()) {
				window.show();
			}
		},
	);

	window.webContents.on("render-process-gone", (_event, details) => {
		console.error(
			`Renderer process exited: ${details.reason} (${details.exitCode ?? "n/a"})`,
		);
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

	return window;
}

app.whenReady().then(async () => {
	registerLixIpc();
	registerTerminalIpc();
	registerAppIpc();
	registerWorkspaceIpc((event) => BrowserWindow.fromWebContents(event.sender), {
		beforeChange: () => closeLixSession({ ignoreOpenError: true }),
	});
	installApplicationMenu();
	void registerMarkdownDefaultHandler({
		execFileAsync,
		executablePath: process.execPath,
		isPackaged: app.isPackaged,
		platform: process.platform,
	}).catch((error) => {
		console.warn("Failed to register Flashtype as the Markdown editor", error);
	});
	void captureAppOpened();
	const workspaceArgument = getWorkspacePathArgument(process.argv);
	if (workspaceArgument !== undefined && !getWorkspace()) {
		await setWorkspaceFromPath(workspaceArgument, null);
	}
	createMainWindow();
	void setupAutoUpdates();

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
	disposeTerminalIpc();
});

async function setupAutoUpdates() {
	if (!canUseAutoUpdates()) {
		return;
	}

	try {
		const autoUpdater = await getAutoUpdater();

		setTimeout(() => {
			void checkForUpdates(autoUpdater);
		}, AUTO_UPDATE_CHECK_DELAY_MS);
	} catch (error) {
		console.warn("Failed to initialize Flashtype auto updates", error);
	}
}

function canUseAutoUpdates() {
	return app.isPackaged && process.env.FLASHTYPE_DISABLE_AUTO_UPDATE !== "1";
}

function registerAppIpc() {
	ipcMain.handle("app:checkForUpdates", async () => {
		return await checkForUpdatesFromMenu({ manual: true });
	});
	ipcMain.handle("app:getUpdateState", () => {
		return getUpdateState();
	});
	ipcMain.handle("app:installUpdate", async () => {
		if (!updateInstallReady || !autoUpdaterInstance) {
			return { status: "not-ready" };
		}
		closeUpdateWindow();
		autoUpdaterInstance.quitAndInstall();
		return { status: "installing" };
	});
}

async function getAutoUpdater() {
	if (autoUpdaterInstance) {
		return autoUpdaterInstance;
	}

	const { default: electronUpdater } = await import("electron-updater");
	const { autoUpdater } = electronUpdater;
	autoUpdater.autoDownload = true;
	registerAutoUpdateListeners(autoUpdater);
	autoUpdaterInstance = autoUpdater;
	return autoUpdater;
}

function registerAutoUpdateListeners(autoUpdater) {
	if (autoUpdateListenersRegistered) {
		return;
	}
	autoUpdateListenersRegistered = true;

	autoUpdater.on("checking-for-update", () => {
		updateCheckInProgress = true;
		updateDownloadInProgress = false;
		if (pendingManualUpdateCheck) {
			updateUpdateWindow({
				status: "checking",
				title: "Checking for update...",
				detail: "Contacting GitHub releases.",
				progress: null,
			});
		}
		installApplicationMenu();
		broadcastUpdateState();
	});

	autoUpdater.on("update-available", () => {
		updateCheckInProgress = false;
		updateDownloadInProgress = true;
		if (pendingManualUpdateCheck) {
			updateUpdateWindow({
				status: "downloading",
				title: "Downloading update...",
				detail: "Preparing download.",
				progress: null,
			});
		}
		installApplicationMenu();
		broadcastUpdateState();
	});

	autoUpdater.on("download-progress", (progress) => {
		updateDownloadInProgress = true;
		if (updateWindow && !updateWindow.isDestroyed()) {
			const transferred = Number(progress.transferred ?? 0);
			const total = Number(progress.total ?? 0);
			updateUpdateWindow({
				status: "downloading",
				title: "Downloading update...",
				detail:
					total > 0
						? `${formatMegabytes(transferred)} of ${formatMegabytes(total)}`
						: "Downloading update.",
				progress:
					typeof progress.percent === "number"
						? Math.max(0, Math.min(100, progress.percent))
						: null,
			});
		}
		installApplicationMenu();
		broadcastUpdateState();
	});

	autoUpdater.on("update-not-available", () => {
		updateCheckInProgress = false;
		updateDownloadInProgress = false;
		installApplicationMenu();
		broadcastUpdateState();

		if (pendingManualUpdateCheck) {
			pendingManualUpdateCheck = false;
			updateUpdateWindow({
				status: "complete",
				title: "Flashtype is up to date.",
				detail: `Version ${app.getVersion()} is the latest version available.`,
				progress: 100,
				actionLabel: "OK",
			});
		}
	});

	autoUpdater.on("error", (error) => {
		updateCheckInProgress = false;
		updateDownloadInProgress = false;
		if (pendingManualUpdateCheck || updateWindow) {
			updateUpdateWindow({
				status: "error",
				title: "Couldn't check for updates.",
				detail: "Try again later.",
				progress: null,
				actionLabel: "OK",
			});
		}
		pendingManualUpdateCheck = false;
		installApplicationMenu();
		broadcastUpdateState();
		console.warn("Failed to update Flashtype", error);
	});

	autoUpdater.on("update-downloaded", () => {
		updateInstallReady = true;
		updateCheckInProgress = false;
		updateDownloadInProgress = false;
		pendingManualUpdateCheck = false;
		installApplicationMenu();
		broadcastUpdateState();
		if (updateWindow && !updateWindow.isDestroyed()) {
			updateUpdateWindow({
				status: "ready",
				title: "Update ready.",
				detail: "Use the Update button in the top right to restart.",
				progress: 100,
			});
			updateWindowCloseTimer = setTimeout(() => {
				closeUpdateWindow();
			}, 1200);
		}
	});
}

function getUpdateState() {
	return {
		checking: updateCheckInProgress || updateDownloadInProgress,
		updateReady: updateInstallReady,
	};
}

function broadcastUpdateState() {
	const state = getUpdateState();
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) {
			window.webContents.send("app:updateState", state);
		}
	}
}

function getUpdateWindowIconDataUrl() {
	if (updateIconDataUrl !== null) {
		return updateIconDataUrl;
	}

	try {
		const iconPath = path.join(app.getAppPath(), "build/icon.png");
		updateIconDataUrl = `data:image/png;base64,${readFileSync(iconPath).toString("base64")}`;
	} catch {
		updateIconDataUrl = "";
	}
	return updateIconDataUrl;
}

function showUpdateWindow(initialState) {
	if (updateWindow && !updateWindow.isDestroyed()) {
		updateWindow.focus();
		updateUpdateWindow(initialState);
		return updateWindow;
	}

	if (updateWindowCloseTimer) {
		clearTimeout(updateWindowCloseTimer);
		updateWindowCloseTimer = null;
	}

	updateWindow = new BrowserWindow({
		width: 560,
		height: 260,
		resizable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		show: false,
		title: `Updating ${APP_NAME}`,
		backgroundColor: "#23272f",
		...(process.platform === "darwin"
			? {
					titleBarStyle: "hiddenInset",
					trafficLightPosition: { x: 18, y: 18 },
				}
			: {}),
		...(mainWindow && !mainWindow.isDestroyed() ? { parent: mainWindow } : {}),
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	updateWindow.on("closed", () => {
		updateWindow = null;
		if (updateWindowCloseTimer) {
			clearTimeout(updateWindowCloseTimer);
			updateWindowCloseTimer = null;
		}
	});

	void updateWindow.loadURL(
		`data:text/html;charset=utf-8,${encodeURIComponent(renderUpdateWindowHtml(initialState))}`,
	);
	updateWindow.once("ready-to-show", () => {
		if (updateWindow && !updateWindow.isDestroyed()) {
			updateWindow.show();
		}
	});
	return updateWindow;
}

function closeUpdateWindow() {
	if (updateWindowCloseTimer) {
		clearTimeout(updateWindowCloseTimer);
		updateWindowCloseTimer = null;
	}
	if (updateWindow && !updateWindow.isDestroyed()) {
		updateWindow.close();
	}
}

function updateUpdateWindow(state) {
	if (!updateWindow || updateWindow.isDestroyed()) {
		showUpdateWindow(state);
		return;
	}
	if (updateWindowCloseTimer) {
		clearTimeout(updateWindowCloseTimer);
		updateWindowCloseTimer = null;
	}
	const payload = JSON.stringify(state);
	void updateWindow.webContents
		.executeJavaScript(
			`window.setUpdateState && window.setUpdateState(${payload})`,
		)
		.catch(() => {});
}

function renderUpdateWindowHtml(initialState) {
	const iconDataUrl = getUpdateWindowIconDataUrl();
	const stateJson = JSON.stringify(initialState);
	return `<!doctype html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="color-scheme" content="dark">
	<style>
		:root {
			color-scheme: dark;
			font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
			background: #23272f;
			color: #f2f4f8;
		}

		* {
			box-sizing: border-box;
		}

		body {
			margin: 0;
			min-height: 100vh;
			overflow: hidden;
			background: #23272f;
		}

		.titlebar {
			height: 58px;
			display: flex;
			align-items: center;
			padding-left: 160px;
			border-bottom: 1px solid rgba(0, 0, 0, 0.32);
			font-size: 26px;
			font-weight: 760;
			color: rgba(242, 244, 248, 0.72);
			-webkit-app-region: drag;
		}

		.content {
			display: grid;
			grid-template-columns: 104px 1fr;
			gap: 28px;
			padding: 22px 32px 28px 42px;
			align-items: center;
		}

		.icon {
			width: 104px;
			height: 104px;
			border-radius: 24px;
			background: linear-gradient(180deg, #ffffff, #eef1f5);
			display: grid;
			place-items: center;
			box-shadow: 0 12px 34px rgba(0, 0, 0, 0.28);
			overflow: hidden;
		}

		.icon img {
			width: 100%;
			height: 100%;
			object-fit: cover;
			display: block;
		}

		.fallback-icon {
			font-size: 48px;
			font-weight: 900;
			color: #f06f2a;
		}

		.message {
			min-width: 0;
		}

		.heading {
			margin: 0 0 24px;
			font-size: 26px;
			line-height: 1.05;
			font-weight: 800;
			letter-spacing: 0;
			color: #f4f5f7;
		}

		.progress {
			position: relative;
			width: 100%;
			height: 16px;
			border-radius: 999px;
			background: rgba(255, 255, 255, 0.12);
			overflow: hidden;
		}

		.fill {
			width: 0%;
			height: 100%;
			border-radius: inherit;
			background: #1287ff;
			transition: width 180ms ease;
		}

		.progress.indeterminate .fill {
			width: 45%;
			animation: slide 1.15s ease-in-out infinite;
		}

		.detail {
			margin-top: 38px;
			font-size: 25px;
			line-height: 1.15;
			font-weight: 700;
			color: rgba(242, 244, 248, 0.86);
		}

		.action {
			display: none;
			margin-top: 20px;
			border: 0;
			border-radius: 7px;
			padding: 7px 16px;
			background: #1287ff;
			color: white;
			font-size: 13px;
			font-weight: 700;
		}

		.has-action .action {
			display: inline-flex;
		}

		@keyframes slide {
			0% { transform: translateX(-120%); }
			100% { transform: translateX(240%); }
		}
	</style>
</head>
<body>
	<header class="titlebar">Updating ${escapeHtml(APP_NAME)}</header>
	<main class="content" id="content">
		<div class="icon">${
			iconDataUrl
				? `<img src="${iconDataUrl}" alt="">`
				: '<div class="fallback-icon">F</div>'
		}</div>
		<section class="message">
			<h1 class="heading" id="heading"></h1>
			<div class="progress" id="progress"><div class="fill" id="fill"></div></div>
			<div class="detail" id="detail"></div>
			<button class="action" id="action" type="button"></button>
		</section>
	</main>
	<script>
		const content = document.getElementById("content");
		const heading = document.getElementById("heading");
		const detail = document.getElementById("detail");
		const progress = document.getElementById("progress");
		const fill = document.getElementById("fill");
		const action = document.getElementById("action");

		window.setUpdateState = (state) => {
			heading.textContent = state.title || "";
			detail.textContent = state.detail || "";
			const hasProgress = typeof state.progress === "number";
			progress.classList.toggle("indeterminate", !hasProgress);
			fill.style.width = hasProgress ? Math.max(0, Math.min(100, state.progress)) + "%" : "";
			content.classList.toggle("has-action", Boolean(state.actionLabel));
			action.textContent = state.actionLabel || "";
		};

		action.addEventListener("click", () => window.close());
		window.setUpdateState(${stateJson});
	</script>
</body>
</html>`;
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function formatMegabytes(bytes) {
	return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

async function checkForUpdates(autoUpdater, { manual = false } = {}) {
	if (updateCheckInProgress || updateDownloadInProgress) {
		if (manual && updateWindow && !updateWindow.isDestroyed()) {
			updateWindow.focus();
		}
		return { status: "busy" };
	}
	pendingManualUpdateCheck = manual;
	updateCheckInProgress = true;
	updateDownloadInProgress = false;
	if (manual) {
		showUpdateWindow({
			status: "checking",
			title: "Checking for update...",
			detail: "Contacting GitHub releases.",
			progress: null,
		});
	}
	installApplicationMenu();
	broadcastUpdateState();
	try {
		await autoUpdater.checkForUpdatesAndNotify();
		return { status: "started" };
	} catch (error) {
		updateCheckInProgress = false;
		updateDownloadInProgress = false;
		pendingManualUpdateCheck = false;
		if (manual) {
			updateUpdateWindow({
				status: "error",
				title: "Couldn't check for updates.",
				detail: "Try again later.",
				progress: null,
				actionLabel: "OK",
			});
		}
		console.warn("Failed to check for Flashtype updates", error);
		return { status: "error" };
	} finally {
		if (updateCheckInProgress && !updateDownloadInProgress) {
			updateCheckInProgress = false;
		}
		installApplicationMenu();
		broadcastUpdateState();
	}
}

async function checkForUpdatesFromMenu(options = {}) {
	if (!canUseAutoUpdates()) {
		return { status: "disabled" };
	}

	try {
		const autoUpdater = await getAutoUpdater();
		return await checkForUpdates(autoUpdater, options);
	} catch (error) {
		pendingManualUpdateCheck = false;
		console.warn("Failed to check for Flashtype updates", error);
		return { status: "error" };
	}
}

function installApplicationMenu() {
	const isUpdateBusy = updateCheckInProgress || updateDownloadInProgress;
	const checkForUpdatesItem = {
		label: updateDownloadInProgress
			? "Downloading Update..."
			: updateCheckInProgress
				? "Checking for Updates..."
				: "Check for Updates...",
		enabled: canUseAutoUpdates() && !isUpdateBusy,
		click: () => {
			void checkForUpdatesFromMenu({ manual: true });
		},
	};

	if (process.platform === "darwin") {
		Menu.setApplicationMenu(
			Menu.buildFromTemplate([
				{
					label: APP_NAME,
					submenu: [
						{ label: `About ${APP_NAME}`, role: "about" },
						checkForUpdatesItem,
						{ type: "separator" },
						{ role: "services" },
						{ type: "separator" },
						{ label: `Hide ${APP_NAME}`, role: "hide" },
						{ role: "hideOthers" },
						{ role: "unhide" },
						{ type: "separator" },
						{ label: `Quit ${APP_NAME}`, role: "quit" },
					],
				},
				{ role: "fileMenu" },
				{ role: "editMenu" },
				{ role: "viewMenu" },
				{ role: "windowMenu" },
			]),
		);
		return;
	}

	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{ role: "fileMenu" },
			{ role: "editMenu" },
			{ role: "viewMenu" },
			{ role: "windowMenu" },
			{
				role: "help",
				submenu: [checkForUpdatesItem],
			},
		]),
	);
}
