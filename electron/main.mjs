import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
	applyWorkspaceWindowChrome,
	getWorkspace,
	registerWorkspaceIpc,
	resolveDirectLaunchWorkspaceTargets,
	resolveWorkspaceTargets,
	setWorkspaceFromTarget,
} from "./workspace.mjs";
import {
	captureAppLaunched,
	captureTelemetryEvent,
	registerTelemetryIpc,
	shutdownTelemetry,
} from "./telemetry.mjs";
import {
	APP_NAME,
	registerMarkdownDefaultHandler,
} from "./markdown-default-handler.mjs";
import { getApplicationIconPath as resolveApplicationIconPath } from "./app-icon.mjs";
import {
	getWorkspacePathArguments,
	resolveWorkspacePathArguments,
} from "./launch-args.mjs";
import {
	filterExistingWorkspaceEntries,
	mergeRestoredAndExplicitWorkspaceRequests,
	normalizeWorkspacePaths,
	normalizeWorkspaceSessionEntries,
	readWorkspaceSessionEntries,
	workspaceToSessionEntry,
	writeWorkspaceSessionEntriesSync,
} from "./workspace-session.mjs";
import {
	activeFileDockLabel,
	addRecentWorkspaceEntry,
	filterExistingRecentWorkspaceEntries,
	getMacDockRecentWorkspacePaths,
	readRecentWorkspaceEntries,
	recentWorkspaceEntryFromWorkspace,
	writeRecentWorkspaceEntriesSync,
} from "./recent-workspaces.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const AUTO_UPDATE_CHECK_DELAY_MS = 10_000;
const AUTO_UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DEV_SERVER_URL =
	process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:4173";
const isHeadless = process.env.FLASHTYPE_HEADLESS === "1";
const isDevRuntime =
	process.env.FLASHTYPE_DEV_RUNTIME === "1" &&
	process.env.VITE_DEV_SERVER_URL !== undefined &&
	!app.isPackaged;
const APP_DISPLAY_NAME = isDevRuntime ? `${APP_NAME} (Dev)` : APP_NAME;
const workspaceWindows = new Set();
const openWorkspaceEntriesByWindowId = new Map();
const activeFilePathsByWindowId = new Map();
const pendingWorkspaceOpenRequests = [];
let readyForWorkspaceOpens = false;
let initialWorkspaceOpenInProgress = false;
let isQuitting = false;
let autoUpdaterInstance = null;
let autoUpdateListenersRegistered = false;
let updateCheckInProgress = false;
let updateDownloadInProgress = false;
let updateInstallReady = false;
let pendingManualUpdateCheck = false;
let updateWindow = null;
let pendingUpdateWindowState = null;
let updateWindowCloseTimer = null;
let updateIconDataUrl = null;
let autoUpdatesSetup = false;
let recoveryUpdateCheckStarted = false;
let telemetryShutdownComplete = false;
let closeLixSession = async () => {};
let disposeLixIpc = async () => {};
let registerLixIpc = () => {};
let disposeTerminalIpc = () => {};
let registerTerminalIpc = () => {};
let recentWorkspaceEntries = [];

if (isHeadless && process.platform === "darwin") {
	app.dock.hide();
}

app.setName(APP_DISPLAY_NAME);
app.setAboutPanelOptions({
	applicationName: APP_DISPLAY_NAME,
	copyright: "Copyright © 2026 Opral US Inc.",
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
	app.quit();
}

if (hasSingleInstanceLock) {
	app.on("second-instance", (_event, argv, workingDirectory) => {
		void openWorkspacePathArguments(argv, { workingDirectory });
	});
}

app.on("open-file", (event, filePath) => {
	event.preventDefault();
	openWorkspacePathWhenReady(filePath);
});

function openWorkspacePathWhenReady(workspacePath) {
	if (!readyForWorkspaceOpens) {
		pendingWorkspaceOpenRequests.push(
			createWorkspaceOpenRequest(workspacePath, "file_open_event"),
		);
		return;
	}
	void openWorkspaceRequests([workspacePath], {
		requestedSource: "file_open_event",
	});
}

async function openWorkspacePathArguments(
	argv,
	{ workingDirectory = process.cwd() } = {},
) {
	const workspacePaths = resolveWorkspacePathArguments(
		getWorkspacePathArguments(argv, {
			defaultApp: process.defaultApp === true,
		}),
		workingDirectory,
	);
	if (workspacePaths.length === 0) {
		await focusOrCreateWorkspaceWindow();
		return;
	}

	if (!readyForWorkspaceOpens) {
		pendingWorkspaceOpenRequests.push(
			...workspacePaths.map((workspacePath) =>
				createWorkspaceOpenRequest(workspacePath, "direct_launch"),
			),
		);
		return;
	}

	await openWorkspaceRequests(workspacePaths);
}

async function openWorkspaceRequests(
	workspaceRequests,
	{ requestedSource = "direct_launch" } = {},
) {
	for (const workspaceRequest of workspaceRequests) {
		const taggedRequest = normalizeWorkspaceOpenRequest(
			workspaceRequest,
			requestedSource,
		);
		const workspaceTargets = await resolveDirectLaunchWorkspaceTargets([
			taggedRequest.request,
		]);
		for (const workspaceTarget of workspaceTargets) {
			await createMainWindow(
				withWorkspaceOpenTelemetry(
					workspaceTarget,
					taggedRequest.requestedSource,
				),
			);
		}
	}
}

function createWorkspaceOpenRequest(request, requestedSource) {
	return { request, requestedSource };
}

function normalizeWorkspaceOpenRequest(
	workspaceRequest,
	fallbackSource = "direct_launch",
) {
	if (
		workspaceRequest &&
		typeof workspaceRequest === "object" &&
		"request" in workspaceRequest &&
		typeof workspaceRequest.requestedSource === "string"
	) {
		return workspaceRequest;
	}

	if (
		workspaceRequest &&
		typeof workspaceRequest === "object" &&
		typeof workspaceRequest.telemetryOpenSource === "string"
	) {
		return createWorkspaceOpenRequest(
			workspaceRequest,
			workspaceRequest.telemetryOpenSource,
		);
	}

	return createWorkspaceOpenRequest(workspaceRequest, fallbackSource);
}

function withWorkspaceOpenTelemetry(workspaceTarget, requestedSource) {
	if (!workspaceTarget) {
		return workspaceTarget;
	}
	const pendingFileCount = Array.isArray(workspaceTarget.pendingOpenFilePaths)
		? workspaceTarget.pendingOpenFilePaths.length
		: 0;
	return {
		...workspaceTarget,
		telemetryOpenSource: resolveTelemetryOpenSource(
			requestedSource,
			pendingFileCount,
		),
		telemetryPendingFileCount: pendingFileCount,
	};
}

function resolveTelemetryOpenSource(requestedSource, pendingFileCount) {
	switch (requestedSource) {
		case "app_restore":
		case "file_open_event":
		case "open_in_new_window":
		case "workspace_picker":
			return requestedSource;
		case "file_launch":
		case "folder_launch":
			return requestedSource;
		default:
			return pendingFileCount > 0 ? "file_launch" : "folder_launch";
	}
}

function resolveWorkspaceRequestSource(workspaceRequest, explicitSourceByPath) {
	if (typeof workspaceRequest === "string") {
		return (
			explicitSourceByPath.get(path.resolve(workspaceRequest)) ??
			"direct_launch"
		);
	}
	if (!workspaceRequest || typeof workspaceRequest !== "object") {
		return "unknown";
	}
	if (workspaceRequest.ephemeral === false) {
		return (
			explicitSourceByPath.get(path.resolve(workspaceRequest.path)) ??
			"app_restore"
		);
	}
	if (workspaceRequest.ephemeral === true) {
		for (const sourceFilePath of workspaceRequest.sourceFilePaths ?? []) {
			const source = explicitSourceByPath.get(path.resolve(sourceFilePath));
			if (source) {
				return source;
			}
		}
		return "app_restore";
	}
	return "unknown";
}

async function inferLaunchSourceFromPaths(workspacePaths) {
	if (workspacePaths.length === 0) {
		return "app";
	}

	let hasFile = false;
	let hasFolder = false;
	let hasUnknown = false;
	for (const workspacePath of workspacePaths) {
		try {
			if ((await stat(workspacePath)).isFile()) {
				hasFile = true;
			} else {
				hasFolder = true;
			}
		} catch {
			hasUnknown = true;
		}
	}

	if (hasFile && (hasFolder || hasUnknown)) {
		return "mixed";
	}
	if (hasFile) {
		return "file";
	}
	if (hasFolder) {
		return hasUnknown ? "mixed" : "folder";
	}
	return "unknown";
}

async function focusOrCreateWorkspaceWindow() {
	if (!readyForWorkspaceOpens) {
		return false;
	}
	if (focusMostRecentWorkspaceWindow()) {
		return true;
	}
	if (initialWorkspaceOpenInProgress || !app.isReady()) {
		return false;
	}
	await createMainWindow();
	return true;
}

function focusMostRecentWorkspaceWindow() {
	const windows = [...workspaceWindows].filter(
		(window) => !window.isDestroyed(),
	);
	const focusedWindow = BrowserWindow.getFocusedWindow();
	const window =
		focusedWindow && workspaceWindows.has(focusedWindow)
			? focusedWindow
			: windows.at(-1);
	if (!window) {
		return false;
	}
	if (isHeadless) {
		return true;
	}
	if (window.isMinimized()) {
		window.restore();
	}
	window.show();
	window.focus();
	return true;
}

function recordOpenWorkspacePath(window, workspace, telemetry = {}) {
	if (!window || window.isDestroyed() || !workspace) {
		return;
	}
	const workspaceEntry = workspaceToSessionEntry(workspace);
	if (!workspaceEntry) {
		return;
	}
	openWorkspaceEntriesByWindowId.set(window.id, workspaceEntry);
	recordRecentWorkspace(workspace);
	void captureTelemetryEvent("workspace opened", {
		is_ephemeral_workspace: workspace.ephemeral === true,
		open_source: telemetry.openSource ?? "unknown",
		pending_file_count: telemetry.pendingFileCount ?? 0,
		source: "main",
	});
	void syncMacOSDockRecentWorkspaceDocuments();
	persistOpenWorkspacePathsSoon();
	updateDockMenu();
}

function forgetOpenWorkspacePath(window) {
	if (!window) {
		return;
	}
	openWorkspaceEntriesByWindowId.delete(window.id);
	activeFilePathsByWindowId.delete(window.id);
	if (!isQuitting) {
		persistOpenWorkspacePathsSoon();
	}
	updateDockMenu();
}

function getOpenWorkspaceEntries() {
	return normalizeWorkspaceSessionEntries([
		...openWorkspaceEntriesByWindowId.values(),
	]);
}

function persistOpenWorkspacePathsSoon() {
	if (isQuitting) {
		return;
	}
	try {
		writeWorkspaceSessionEntriesSync(
			app.getPath("userData"),
			getOpenWorkspaceEntries(),
		);
	} catch (error) {
		console.warn("Failed to persist Flashtype workspace session", error);
	}
}

function flushOpenWorkspacePaths() {
	try {
		writeWorkspaceSessionEntriesSync(
			app.getPath("userData"),
			getOpenWorkspaceEntries(),
		);
	} catch (error) {
		console.warn("Failed to flush Flashtype workspace session", error);
	}
}

function recordRecentWorkspace(workspace) {
	const recentWorkspaceEntry = recentWorkspaceEntryFromWorkspace(workspace);
	if (!recentWorkspaceEntry) {
		return;
	}
	recentWorkspaceEntries = addRecentWorkspaceEntry(
		recentWorkspaceEntries,
		recentWorkspaceEntry,
	);
	try {
		writeRecentWorkspaceEntriesSync(
			app.getPath("userData"),
			recentWorkspaceEntries,
		);
	} catch (error) {
		console.warn("Failed to persist Flashtype recent workspaces", error);
	}
}

async function createMainWindow(workspaceRequest) {
	const window = new BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 1000,
		minHeight: 700,
		show: false,
		autoHideMenuBar: true,
		icon: getApplicationIconPath(),
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
	workspaceWindows.add(window);

	const showFallback = isHeadless
		? undefined
		: setTimeout(() => {
				if (window.isDestroyed() || window.isVisible()) {
					return;
				}
				window.show();
			}, 3000);

	if (workspaceRequest !== undefined) {
		const taggedRequest = normalizeWorkspaceOpenRequest(workspaceRequest);
		const workspaceTarget =
			taggedRequest.request?.workspace &&
			taggedRequest.request?.pendingOpenFilePaths
				? taggedRequest.request
				: (await resolveWorkspaceTargets([taggedRequest.request]))[0];
		const telemetryWorkspaceTarget = withWorkspaceOpenTelemetry(
			workspaceTarget,
			taggedRequest.requestedSource,
		);
		await setWorkspaceFromTarget(telemetryWorkspaceTarget, window, {
			afterChange: (workspace, changedWindow) =>
				recordOpenWorkspacePath(changedWindow, workspace, {
					openSource: telemetryWorkspaceTarget.telemetryOpenSource,
					pendingFileCount: telemetryWorkspaceTarget.telemetryPendingFileCount,
				}),
		});
	} else {
		applyWorkspaceWindowChrome(window);
	}

	window.once("ready-to-show", () => {
		if (window.isDestroyed() || isHeadless) {
			return;
		}
		installDevelopmentDockIcon();
		window.show();
		window.focus();
	});

	window.on("closed", () => {
		if (showFallback !== undefined) {
			clearTimeout(showFallback);
		}
		workspaceWindows.delete(window);
		forgetOpenWorkspacePath(window);
		void closeLixSession(window, { ignoreOpenError: true });
	});

	window.webContents.on(
		"did-fail-load",
		(_event, errorCode, errorDescription, validatedURL) => {
			console.error(
				`Failed to load ${validatedURL} (${errorCode}): ${errorDescription}`,
			);
			if (!isHeadless && !window.isDestroyed() && !window.isVisible()) {
				window.show();
			}
			void triggerRecoveryUpdateCheck(
				new Error(
					`Failed to load ${validatedURL} (${errorCode}): ${errorDescription}`,
				),
			);
		},
	);

	window.webContents.on("render-process-gone", (_event, details) => {
		console.error(
			`Renderer process exited: ${details.reason} (${details.exitCode ?? "n/a"})`,
		);
		void triggerRecoveryUpdateCheck(
			new Error(
				`Renderer process exited: ${details.reason} (${details.exitCode ?? "n/a"})`,
			),
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

if (hasSingleInstanceLock) {
	app.whenReady().then(async () => {
		installDevelopmentDockIcon();
		registerAppIpc();
		registerTelemetryIpc();
		installApplicationMenu();
		app.on("activate", () => {
			void focusOrCreateWorkspaceWindow();
		});
		await setupAutoUpdates();
		if (isQuitting) {
			return;
		}
		void startWorkspaceLifecycle().catch((error) => {
			console.warn("Failed to start Flashtype workspace UI", error);
			void triggerRecoveryUpdateCheck(error);
		});
	});
}

async function loadNativeIpcModules() {
	const [lixIpc, terminalIpc] = await Promise.all([
		import("./ipc-lix.mjs"),
		import("./ipc-terminal.mjs"),
	]);
	closeLixSession = lixIpc.closeLixSession;
	disposeLixIpc = lixIpc.disposeLixIpc;
	registerLixIpc = lixIpc.registerLixIpc;
	disposeTerminalIpc = terminalIpc.disposeTerminalIpc;
	registerTerminalIpc = terminalIpc.registerTerminalIpc;
}

async function startWorkspaceLifecycle() {
	await loadNativeIpcModules();
	if (isQuitting) {
		return;
	}
	registerLixIpc((event) => BrowserWindow.fromWebContents(event.sender));
	registerTerminalIpc();
	registerWorkspaceIpc((event) => BrowserWindow.fromWebContents(event.sender), {
		beforeChange: (_nextWorkspace, window) =>
			closeLixSession(window, { ignoreOpenError: true }),
		afterChange: (workspace, window, workspaceTarget) => {
			const telemetryWorkspaceTarget = withWorkspaceOpenTelemetry(
				workspaceTarget,
				"workspace_picker",
			);
			recordOpenWorkspacePath(window, workspace, {
				openSource: telemetryWorkspaceTarget.telemetryOpenSource,
				pendingFileCount: telemetryWorkspaceTarget.telemetryPendingFileCount,
			});
		},
		openInNewWindow: async (requestedPath) => {
			const workspaceTarget = (
				await resolveDirectLaunchWorkspaceTargets([requestedPath])
			)[0];
			const window = await createMainWindow(
				withWorkspaceOpenTelemetry(workspaceTarget, "open_in_new_window"),
			);
			return getWorkspace(window);
		},
	});
	void registerMarkdownDefaultHandler({
		execFileAsync,
		executablePath: process.execPath,
		isPackaged: app.isPackaged,
		platform: process.platform,
	}).catch((error) => {
		console.warn("Failed to register Flashtype as the Markdown editor", error);
	});
	const savedWorkspaceEntries = await readWorkspaceSessionEntries(
		app.getPath("userData"),
	);
	const restorableSavedWorkspaceEntries = await filterExistingWorkspaceEntries(
		savedWorkspaceEntries,
	);
	recentWorkspaceEntries = await filterExistingRecentWorkspaceEntries(
		await readRecentWorkspaceEntries(app.getPath("userData")),
	);
	void syncMacOSDockRecentWorkspaceDocuments();
	try {
		writeRecentWorkspaceEntriesSync(
			app.getPath("userData"),
			recentWorkspaceEntries,
		);
	} catch (error) {
		console.warn("Failed to clean Flashtype recent workspaces", error);
	}
	updateDockMenu();
	if (restorableSavedWorkspaceEntries.length !== savedWorkspaceEntries.length) {
		try {
			writeWorkspaceSessionEntriesSync(
				app.getPath("userData"),
				restorableSavedWorkspaceEntries,
			);
		} catch (error) {
			console.warn("Failed to clean Flashtype workspace session", error);
		}
	}
	const initialLaunchWorkspacePaths = normalizeWorkspacePaths(
		resolveWorkspacePathArguments(
			getWorkspacePathArguments(process.argv, {
				defaultApp: process.defaultApp === true,
			}),
			process.cwd(),
		),
	);
	const pendingWorkspaceOpenRequestsToProcess = [
		...pendingWorkspaceOpenRequests,
	];
	const launchSource = pendingWorkspaceOpenRequestsToProcess.some(
		(request) => request.requestedSource === "file_open_event",
	)
		? "file"
		: await inferLaunchSourceFromPaths(initialLaunchWorkspacePaths);
	void captureAppLaunched({ launchSource });
	const explicitWorkspaceSourceByPath = new Map();
	for (const workspacePath of initialLaunchWorkspacePaths) {
		explicitWorkspaceSourceByPath.set(
			path.resolve(workspacePath),
			"direct_launch",
		);
	}
	for (const workspaceRequest of pendingWorkspaceOpenRequestsToProcess) {
		explicitWorkspaceSourceByPath.set(
			path.resolve(workspaceRequest.request),
			workspaceRequest.requestedSource,
		);
	}
	const explicitWorkspacePaths = normalizeWorkspacePaths([
		...initialLaunchWorkspacePaths,
		...pendingWorkspaceOpenRequestsToProcess.map(
			(workspaceRequest) => workspaceRequest.request,
		),
	]);
	const workspaceRequestsToOpen = mergeRestoredAndExplicitWorkspaceRequests(
		restorableSavedWorkspaceEntries,
		explicitWorkspacePaths,
	);
	const taggedWorkspaceRequestsToOpen = workspaceRequestsToOpen.map(
		(workspaceRequest) =>
			createWorkspaceOpenRequest(
				workspaceRequest,
				resolveWorkspaceRequestSource(
					workspaceRequest,
					explicitWorkspaceSourceByPath,
				),
			),
	);
	pendingWorkspaceOpenRequests.length = 0;
	if (isQuitting) {
		return;
	}
	initialWorkspaceOpenInProgress = true;
	readyForWorkspaceOpens = true;
	try {
		if (taggedWorkspaceRequestsToOpen.length > 0) {
			await openWorkspaceRequests(taggedWorkspaceRequestsToOpen);
		} else {
			await createMainWindow();
		}
	} finally {
		initialWorkspaceOpenInProgress = false;
	}
}

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("before-quit", () => {
	isQuitting = true;
	flushOpenWorkspacePaths();
	void disposeLixIpc();
	disposeTerminalIpc();
});

app.on("will-quit", (event) => {
	if (telemetryShutdownComplete) {
		return;
	}
	event.preventDefault();
	void shutdownTelemetry().finally(() => {
		telemetryShutdownComplete = true;
		app.quit();
	});
});

async function setupAutoUpdates() {
	if (!canUseAutoUpdates() || autoUpdatesSetup) {
		return;
	}
	autoUpdatesSetup = true;

	try {
		const autoUpdater = await getAutoUpdater();

		setTimeout(() => {
			void checkForUpdates(autoUpdater);
		}, AUTO_UPDATE_CHECK_DELAY_MS);
		setInterval(() => {
			if (updateInstallReady) {
				return;
			}
			void checkForUpdates(autoUpdater);
		}, AUTO_UPDATE_CHECK_INTERVAL_MS);
	} catch (error) {
		autoUpdatesSetup = false;
		console.warn("Failed to initialize Flashtype auto updates", error);
	}
}

async function triggerRecoveryUpdateCheck(error) {
	if (!canUseAutoUpdates() || recoveryUpdateCheckStarted) {
		return { status: "disabled" };
	}
	recoveryUpdateCheckStarted = true;
	console.warn("Checking for a Flashtype update after app failure", error);
	return await checkForUpdatesFromMenu({ manual: true });
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
		return installDownloadedUpdate();
	});
	ipcMain.handle("workspace:setActiveFilePath", (event, payload) => {
		const window = BrowserWindow.fromWebContents(event.sender);
		if (!window || window.isDestroyed()) {
			return;
		}
		const filePath =
			typeof payload?.filePath === "string" && payload.filePath.length > 0
				? payload.filePath
				: null;
		if (filePath) {
			activeFilePathsByWindowId.set(window.id, filePath);
		} else {
			activeFilePathsByWindowId.delete(window.id);
		}
		applyDockWindowChrome(window);
		updateDockMenu();
	});
}

function installDownloadedUpdate() {
	if (!updateInstallReady || !autoUpdaterInstance) {
		return { status: "not-ready" };
	}
	closeUpdateWindow();
	autoUpdaterInstance.quitAndInstall();
	return { status: "installing" };
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
				detail: "Restart Flashtype to install the update.",
				progress: 100,
				actionLabel: "Restart",
				action: "install",
			});
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
		const iconPath = getApplicationIconPath();
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

	const parentWindow = [...workspaceWindows].find(
		(window) =>
			!window.isDestroyed() && window === BrowserWindow.getFocusedWindow(),
	);
	updateWindow = new BrowserWindow({
		width: 440,
		height: 184,
		resizable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		show: false,
		title: `Updating ${APP_DISPLAY_NAME}`,
		icon: getApplicationIconPath(),
		backgroundColor: "#23272f",
		...(process.platform === "darwin"
			? {
					titleBarStyle: "hiddenInset",
					trafficLightPosition: { x: 16, y: 15 },
				}
			: {}),
		...(parentWindow ? { parent: parentWindow } : {}),
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	updateWindow.on("closed", () => {
		updateWindow = null;
		pendingUpdateWindowState = null;
		if (updateWindowCloseTimer) {
			clearTimeout(updateWindowCloseTimer);
			updateWindowCloseTimer = null;
		}
	});
	updateWindow.webContents.on("will-navigate", (event, url) => {
		if (url === "flashtype-update://install") {
			event.preventDefault();
			installDownloadedUpdate();
		}
	});
	updateWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (url === "flashtype-update://install") {
			installDownloadedUpdate();
		}
		return { action: "deny" };
	});

	void updateWindow.loadURL(
		`data:text/html;charset=utf-8,${encodeURIComponent(renderUpdateWindowHtml(initialState))}`,
	);
	pendingUpdateWindowState = initialState;
	updateWindow.webContents.once("did-finish-load", () => {
		if (!updateWindow || updateWindow.isDestroyed()) {
			return;
		}
		const state = pendingUpdateWindowState;
		if (state) {
			void applyUpdateWindowState(state);
		}
	});
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
	pendingUpdateWindowState = null;
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
	pendingUpdateWindowState = state;
	if (updateWindow.webContents.isLoading()) {
		return;
	}
	void applyUpdateWindowState(state);
}

async function applyUpdateWindowState(state) {
	if (!updateWindow || updateWindow.isDestroyed()) {
		return;
	}
	const payload = JSON.stringify(state);
	await updateWindow.webContents
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
			height: 44px;
			display: flex;
			align-items: center;
			padding-left: 92px;
			border-bottom: 1px solid rgba(0, 0, 0, 0.32);
			font-size: 13px;
			font-weight: 650;
			color: rgba(242, 244, 248, 0.72);
			-webkit-app-region: drag;
		}

		.content {
			display: grid;
			grid-template-columns: 64px 1fr;
			gap: 18px;
			padding: 18px 24px 22px 28px;
			align-items: center;
		}

		.icon {
			width: 64px;
			height: 64px;
			border-radius: 14px;
			background: linear-gradient(180deg, #ffffff, #eef1f5);
			display: grid;
			place-items: center;
			box-shadow: 0 8px 22px rgba(0, 0, 0, 0.24);
			overflow: hidden;
		}

		.icon img {
			width: 100%;
			height: 100%;
			object-fit: cover;
			display: block;
		}

		.fallback-icon {
			font-size: 30px;
			font-weight: 900;
			color: #f06f2a;
		}

		.message {
			min-width: 0;
		}

		.heading {
			margin: 0 0 14px;
			font-size: 16px;
			line-height: 1.2;
			font-weight: 700;
			letter-spacing: 0;
			color: #f4f5f7;
		}

		.progress {
			position: relative;
			width: 100%;
			height: 8px;
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
			margin-top: 14px;
			font-size: 13px;
			line-height: 1.35;
			font-weight: 500;
			color: rgba(242, 244, 248, 0.86);
		}

		.action {
			display: none;
			margin-top: 12px;
			border: 0;
			border-radius: 7px;
			padding: 6px 12px;
			background: #1287ff;
			color: white;
			font-size: 12px;
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
	<header class="titlebar">Updating ${escapeHtml(APP_DISPLAY_NAME)}</header>
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
			action.dataset.action = state.action || "close";
		};

		action.addEventListener("click", () => {
			if (action.dataset.action === "install") {
				window.location.href = "flashtype-update://install";
				return;
			}
			window.close();
		});
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
	if (updateInstallReady) {
		if (manual) {
			updateUpdateWindow({
				status: "ready",
				title: "Update ready.",
				detail: "Restart Flashtype to install the update.",
				progress: 100,
				actionLabel: "Restart",
				action: "install",
			});
		}
		return { status: "ready" };
	}
	if (updateCheckInProgress || updateDownloadInProgress) {
		if (manual) {
			pendingManualUpdateCheck = true;
			showUpdateWindow({
				status: updateDownloadInProgress ? "downloading" : "checking",
				title: updateDownloadInProgress
					? "Downloading update..."
					: "Checking for update...",
				detail: updateDownloadInProgress
					? "Downloading update."
					: "Contacting GitHub releases.",
				progress: null,
			});
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

function installDevelopmentDockIcon() {
	if (
		process.platform !== "darwin" ||
		isHeadless ||
		!isDevRuntime ||
		!app.dock
	) {
		return;
	}

	app.dock.setIcon(getApplicationIconPath());
}

function getApplicationIconPath() {
	return resolveApplicationIconPath(getApplicationIconBasePath(), {
		isDevRuntime,
		isPackaged: app.isPackaged,
		viteDevServerUrl: process.env.VITE_DEV_SERVER_URL,
	});
}

function getApplicationIconBasePath() {
	if (isDevRuntime) {
		return path.resolve(__dirname, "..");
	}
	return app.getAppPath();
}

function installApplicationMenu() {
	const isUpdateBusy = updateCheckInProgress || updateDownloadInProgress;
	const checkForUpdatesItem = {
		label: updateInstallReady
			? "Restart to Install Update"
			: updateDownloadInProgress
				? "Downloading Update..."
				: updateCheckInProgress
					? "Checking for Updates..."
					: "Check for Updates...",
		enabled:
			canUseAutoUpdates() &&
			(updateInstallReady ? Boolean(autoUpdaterInstance) : !isUpdateBusy),
		click: () => {
			if (updateInstallReady) {
				installDownloadedUpdate();
				return;
			}
			void checkForUpdatesFromMenu({ manual: true });
		},
	};

	if (process.platform === "darwin") {
		Menu.setApplicationMenu(
			Menu.buildFromTemplate([
				{
					label: APP_DISPLAY_NAME,
					submenu: [
						{ label: `About ${APP_DISPLAY_NAME}`, role: "about" },
						checkForUpdatesItem,
						{ type: "separator" },
						{ role: "services" },
						{ type: "separator" },
						{ label: `Hide ${APP_DISPLAY_NAME}`, role: "hide" },
						{ role: "hideOthers" },
						{ role: "unhide" },
						{ type: "separator" },
						{ label: `Quit ${APP_DISPLAY_NAME}`, role: "quit" },
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

function updateDockMenu() {
	if (process.platform !== "darwin" || isHeadless || !app.dock) {
		return;
	}

	app.dock.setMenu(
		Menu.buildFromTemplate([
			{
				label: "New Window",
				click: () => {
					void createMainWindow();
				},
			},
		]),
	);
}

function applyDockWindowChrome(window) {
	if (process.platform !== "darwin" || window.isDestroyed()) {
		return;
	}

	const workspace = getWorkspace(window);
	const activeFilePath = activeFilePathsByWindowId.get(window.id);
	const activeFileLabel = activeFileDockLabel(workspace, activeFilePath);
	if (activeFileLabel && activeFilePath) {
		window.setTitle(activeFileLabel);
		window.setRepresentedFilename(activeFilePath);
		return;
	}

	applyWorkspaceWindowChrome(window, workspace ?? undefined);
	if (workspace?.representedPath || workspace?.path) {
		window.setRepresentedFilename(workspace.representedPath ?? workspace.path);
	} else {
		window.setRepresentedFilename("");
	}
}

async function syncMacOSDockRecentWorkspaceDocuments() {
	if (process.platform !== "darwin" || isHeadless) {
		return;
	}

	try {
		// Custom Dock menu rows do not reliably render file/folder icons on macOS.
		// Treat the native recent-documents list as a derived projection of our
		// persisted workspace history, matching VS Code's Dock behavior.
		app.clearRecentDocuments();
		for (const workspacePath of await getMacDockRecentWorkspacePaths(
			recentWorkspaceEntries,
		)) {
			app.addRecentDocument(workspacePath);
		}
	} catch (error) {
		console.warn(
			"Failed to sync Flashtype macOS Dock recent workspaces",
			error,
		);
	}
}
