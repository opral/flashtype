import { dialog, ipcMain } from "electron";
import os from "node:os";
import path from "node:path";
import {
	cp,
	lstat,
	mkdtemp,
	opendir,
	readFile,
	rename,
	rm,
	stat,
} from "node:fs/promises";

const LIX_DIRECTORY_NAME = ".lix";
const LIX_DATABASE_FILE = path.join(".lix", ".internal", "db.sqlite");
const LIX_ROCKSDB_DATABASE_DIR = path.join(".lix", ".internal", "rocksdb");
const LEGACY_LIX_DATABASE_FILE = path.join(".lix", "db.sqlite");
const LIX_DATABASE_FILES = [LIX_DATABASE_FILE, LEGACY_LIX_DATABASE_FILE];
export const MAX_WORKSPACE_SIZE_BYTES = 500 * 1024 * 1024;
export const WORKSPACE_TOO_LARGE_ERROR_CODE =
	"ERR_FLASHTYPE_WORKSPACE_TOO_LARGE";

/**
 * The workspace is the folder Flashtype operates on. Each window has at most
 * one workspace; everything else (lix, terminal cwd, window title) derives
 * from that window's workspace. `null` means first run: the app renders
 * without a database until the user picks a folder.
 */
let registered = false;
const windowStates = new Map();

export function getWorkspace(window) {
	return getWindowState(window)?.workspace ?? null;
}

/**
 * Resolves a requested folder directly, or a requested file to the nearest
 * ancestor Lix workspace and the file path within that workspace.
 */
export async function resolveWorkspaceTarget(requestedPath, options = {}) {
	const resolved = path.resolve(requestedPath);
	let stats = null;
	try {
		stats = await stat(resolved);
	} catch {
		// Keep the resolved path for directories and unreadable paths; the lix
		// backend reports unreadable workspace folders.
	}
	if (stats?.isFile()) {
		const workspaceDir = await findLixWorkspaceRoot(path.dirname(resolved));
		if (!workspaceDir) {
			const workspace = createTransientDirectoryWorkspace([resolved]);
			return {
				workspace,
				pendingOpenFilePaths: workspace.includePaths,
			};
		}
		await assertWorkspaceDirectorySizeWithinLimit(workspaceDir, options);
		return {
			workspace: createPersistentWorkspace(workspaceDir),
			pendingOpenFilePaths: [
				toPortableRelativePath(path.relative(workspaceDir, resolved)),
			],
		};
	}
	if (stats?.isDirectory()) {
		await assertWorkspaceDirectorySizeWithinLimit(resolved, options);
	}
	return {
		workspace: createPersistentWorkspace(resolved),
		pendingOpenFilePaths: [],
	};
}

export async function resolveWorkspaceTargets(requestedPaths, options = {}) {
	const targets = [];
	const standaloneFiles = [];
	let standaloneFilesInsertIndex = null;

	for (let requestedPath of requestedPaths) {
		if (isWorkspaceSessionEntryLike(requestedPath)) {
			const target = await resolveWorkspaceSessionEntry(requestedPath);
			if (target) {
				targets.push(target);
			}
			continue;
		}

		const resolved = path.resolve(String(requestedPath));
		const standaloneFileTarget = await resolveStandaloneFile(resolved);
		if (standaloneFileTarget) {
			if (standaloneFilesInsertIndex === null) {
				standaloneFilesInsertIndex = targets.length;
			}
			standaloneFiles.push(standaloneFileTarget);
			continue;
		}
		targets.push(await resolveWorkspaceTarget(resolved, options));
	}

	if (standaloneFiles.length > 0) {
		const workspace = createTransientDirectoryWorkspace(standaloneFiles);
		targets.splice(standaloneFilesInsertIndex ?? targets.length, 0, {
			workspace,
			pendingOpenFilePaths: workspace.includePaths,
		});
	}

	return targets;
}

export async function resolveWorkspace(requestedPath) {
	return (await resolveWorkspaceTarget(requestedPath)).workspace;
}

export async function setWorkspaceFromPath(
	requestedPath,
	window,
	options = {},
) {
	return await setWorkspaceFromTarget(
		await resolveWorkspaceTarget(requestedPath),
		window,
		options,
	);
}

export async function setWorkspaceFromTarget(target, window, options = {}) {
	const state = getOrCreateWindowState(window);
	return await enqueueWorkspaceChange(state, async () => {
		const nextWorkspace = target.workspace;
		if (workspaceKey(state.workspace) === workspaceKey(nextWorkspace)) {
			state.pendingOpenFilePaths = target.pendingOpenFilePaths;
			applyWindowChrome(window);
			await options.afterChange?.(state.workspace, window, target);
			return state.workspace;
		}
		await options.beforeChange?.(nextWorkspace, window);
		await disposeExternalLixState(state);
		state.workspace = nextWorkspace;
		state.pendingOpenFilePaths = target.pendingOpenFilePaths;
		applyWindowChrome(window);
		await options.afterChange?.(state.workspace, window, target);
		return state.workspace;
	});
}

/**
 * Shows the native directory picker. Returns the new workspace, or null when
 * the user cancels (cancel keeps the current state; it is not an error).
 */
export async function openWorkspaceDialog(window, options = {}) {
	const result = await showWorkspaceDialog(window);
	const dir = result.filePaths[0];
	if (result.canceled || dir === undefined) {
		return null;
	}
	return await setWorkspaceFromPath(dir, window, options);
}

export async function exportWorkspaceLixFile(window) {
	const workspace = getWorkspace(window);
	if (!workspace) {
		throw new Error(
			"No workspace is open. Open a folder before exporting lix.",
		);
	}
	if (workspace.ephemeral === true) {
		throw new Error(
			"Cannot export a .lix database from a transient workspace.",
		);
	}
	const databasePath = await findLixDatabasePath(workspace.path);
	if (!databasePath) {
		throw new Error("The opened workspace does not have a .lix database.");
	}
	return await readFile(databasePath);
}

export function getWorkspaceLixDatabasePath(window) {
	const workspace = getWorkspace(window);
	if (!workspace) {
		throw new Error(
			"No workspace is open. Open a folder before exporting lix.",
		);
	}
	if (workspace.ephemeral === true) {
		throw new Error(
			"Transient workspaces do not have a .lix database on disk.",
		);
	}
	return path.join(workspace.path, LIX_DATABASE_FILE);
}

export function applyWorkspaceWindowChrome(window) {
	applyWindowChrome(window);
}

export function consumePendingOpenFiles(window) {
	const state = getWindowState(window);
	if (!state) return [];
	const pendingOpenFilePaths = state.pendingOpenFilePaths;
	state.pendingOpenFilePaths = [];
	return pendingOpenFilePaths ?? [];
}

export async function profileWorkspaceFilesystem(workspace) {
	if (!workspace) {
		return null;
	}
	const profile = createEmptyWorkspaceFilesystemProfile();
	if (workspace.ephemeral === true) {
		await profileTransientWorkspaceSourceFiles(profile, workspace);
		return finalizeWorkspaceFilesystemProfile(profile);
	}
	const pendingDirectories = [workspace.path];
	while (pendingDirectories.length > 0) {
		const currentDirectory = pendingDirectories.pop();
		let directory;
		try {
			directory = await opendir(currentDirectory);
		} catch {
			continue;
		}
		for await (const entry of directory) {
			if (entry.isDirectory() && entry.name === ".lix") {
				continue;
			}
			const entryPath = path.join(currentDirectory, entry.name);
			let stats;
			try {
				stats = await lstat(entryPath);
			} catch {
				continue;
			}
			if (stats.isSymbolicLink()) {
				continue;
			}
			if (stats.isDirectory()) {
				profile.directory_count += 1;
				pendingDirectories.push(entryPath);
				continue;
			}
			if (stats.isFile()) {
				addFileToWorkspaceFilesystemProfile(
					profile,
					extensionFromPath(entry.name),
					stats.size,
				);
			}
		}
	}
	return finalizeWorkspaceFilesystemProfile(profile);
}

async function profileTransientWorkspaceSourceFiles(profile, workspace) {
	const directories = new Set();
	for (const includePath of workspace.includePaths ?? []) {
		const sourceFilePath = path.join(workspace.path, includePath);
		let stats;
		try {
			stats = await lstat(sourceFilePath);
		} catch {
			continue;
		}
		if (!stats.isFile() || stats.isSymbolicLink()) {
			continue;
		}
		const relativePath = toPortableRelativePath(
			path.relative(workspace.path, sourceFilePath),
		);
		for (const directory of parentDirectories(relativePath)) {
			directories.add(directory);
		}
		addFileToWorkspaceFilesystemProfile(
			profile,
			extensionFromPath(sourceFilePath),
			stats.size,
		);
	}
	profile.directory_count = directories.size;
}

export async function getWorkspaceFsBackendOptions(window) {
	const workspace = getWorkspace(window);
	if (!workspace) {
		throw new Error("No workspace is open. Open a folder before using lix.");
	}
	if (workspace.ephemeral === true) {
		const lixDir = await ensureExternalLixDir(window);
		const includePaths = Array.isArray(workspace.includePaths)
			? workspace.includePaths
			: [];
		return {
			path: workspace.path,
			lixDir,
			filter:
				includePaths.length > 0
					? { includePaths: [...includePaths] }
					: undefined,
		};
	}
	return { path: workspace.path };
}

export async function setWorkspaceTrackChanges(window, trackChanges) {
	const state = getOrCreateWindowState(window);
	return await enqueueWorkspaceChange(state, async () => {
		const workspace = state.workspace;
		if (!workspace) {
			throw new Error("No workspace is open.");
		}
		if (trackChanges && workspace.ephemeral !== true) {
			return workspace;
		}
		if (!trackChanges && workspace.ephemeral === true) {
			return workspace;
		}
		if (trackChanges) {
			await moveExternalLixBackIntoWorkspace(state);
			state.workspace = createPersistentWorkspace(workspace.path);
		} else {
			await moveWorkspaceLixToExternalStorage(state);
			state.workspace = createEphemeralWorkspace(workspace.path);
		}
		state.pendingOpenFilePaths = [];
		applyWindowChrome(window);
		return state.workspace;
	});
}

export async function disposeWorkspaceWindowState(windowOrId) {
	const windowId =
		typeof windowOrId === "number" ? windowOrId : windowOrId?.id;
	if (typeof windowId !== "number") {
		return;
	}
	const state = windowStates.get(windowId);
	windowStates.delete(windowId);
	await disposeExternalLixState(state);
}

export async function disposeAllWorkspaceWindowStates() {
	await Promise.all(
		[...windowStates.keys()].map((windowId) =>
			disposeWorkspaceWindowState(windowId),
		),
	);
}

function applyWindowChrome(window) {
	const workspace = getWorkspace(window);
	if (!workspace || !window || window.isDestroyed()) {
		return;
	}
	window.setTitle(workspace.name);
	// macOS proxy title: Cmd-click shows the folder's path popover.
	window.setRepresentedFilename(workspace.representedPath ?? workspace.path);
}

async function resolveWorkspaceSessionEntry(workspaceEntry) {
	const workspacePath = path.resolve(workspaceEntry.path);
	try {
		if (!(await stat(workspacePath)).isDirectory()) {
			return null;
		}
	} catch {
		return null;
	}
	const pendingOpenFilePaths = Array.isArray(workspaceEntry.openFiles)
		? workspaceEntry.openFiles
		: [];
	if (await hasLixWorkspaceMetadata(workspacePath)) {
		return {
			workspace: createPersistentWorkspace(workspacePath),
			pendingOpenFilePaths,
		};
	}
	return {
		workspace: createEphemeralWorkspace(workspacePath, pendingOpenFilePaths),
		pendingOpenFilePaths,
	};
}

async function assertWorkspaceDirectorySizeWithinLimit(
	workspaceDir,
	options = {},
) {
	const maxSizeBytes =
		options.maxWorkspaceSizeBytes ?? MAX_WORKSPACE_SIZE_BYTES;
	if (
		typeof maxSizeBytes !== "number" ||
		!Number.isFinite(maxSizeBytes) ||
		maxSizeBytes <= 0
	) {
		return;
	}
	const sizeBytes = await directorySizeBytes(workspaceDir, maxSizeBytes);
	if (sizeBytes <= maxSizeBytes) {
		return;
	}
	throw createWorkspaceTooLargeError(workspaceDir, maxSizeBytes);
}

async function directorySizeBytes(directoryPath, stopAfterBytes) {
	let totalBytes = 0;
	const pendingDirectories = [directoryPath];
	while (pendingDirectories.length > 0 && totalBytes <= stopAfterBytes) {
		const currentDirectory = pendingDirectories.pop();
		let directory;
		try {
			directory = await opendir(currentDirectory);
		} catch {
			continue;
		}
		for await (const entry of directory) {
			if (entry.isDirectory() && entry.name === ".lix") {
				continue;
			}
			const entryPath = path.join(currentDirectory, entry.name);
			let stats;
			try {
				stats = await lstat(entryPath);
			} catch {
				continue;
			}
			if (stats.isSymbolicLink()) {
				continue;
			}
			if (stats.isDirectory()) {
				pendingDirectories.push(entryPath);
				continue;
			}
			if (stats.isFile()) {
				totalBytes += stats.size;
				if (totalBytes > stopAfterBytes) {
					break;
				}
			}
		}
	}
	return totalBytes;
}

function createWorkspaceTooLargeError(workspaceDir, maxSizeBytes) {
	const error = new Error(
		`The folder "${path.basename(workspaceDir) || workspaceDir}" is too large for Flashtype to open. Please open a smaller folder. Flashtype currently supports folders up to ${formatBytes(maxSizeBytes)}.`,
	);
	error.code = WORKSPACE_TOO_LARGE_ERROR_CODE;
	error.workspacePath = workspaceDir;
	error.maxSizeBytes = maxSizeBytes;
	return error;
}

export function isWorkspaceTooLargeError(error) {
	return error?.code === WORKSPACE_TOO_LARGE_ERROR_CODE;
}

export async function showWorkspaceTooLargeWarning(window, error) {
	const message =
		error instanceof Error
			? error.message
			: "This folder is too large for Flashtype to open. Please open a smaller folder.";
	const options = {
		type: "warning",
		title: "Folder too large",
		message: "Folder too large",
		detail: message,
		buttons: ["OK"],
	};
	if (window && !window.isDestroyed()) {
		await dialog.showMessageBox(window, options);
		return;
	}
	await dialog.showMessageBox(options);
}

function formatBytes(bytes) {
	const mib = bytes / 1024 / 1024;
	if (Number.isInteger(mib)) {
		return `${mib} MB`;
	}
	return `${mib.toFixed(1)} MB`;
}

function createEmptyWorkspaceFilesystemProfile() {
	return {
		file_count: 0,
		directory_count: 0,
		extension_count: 0,
		extension_counts: {},
		total_size_mb: 0,
		extensionSizeBytes: new Map(),
		extensionFileSizesBytes: new Map(),
	};
}

function addFileToWorkspaceFilesystemProfile(profile, extension, sizeBytes) {
	profile.file_count += 1;
	profile.extension_counts[extension] =
		(profile.extension_counts[extension] ?? 0) + 1;
	profile.extensionSizeBytes.set(
		extension,
		(profile.extensionSizeBytes.get(extension) ?? 0) + sizeBytes,
	);
	const fileSizes = profile.extensionFileSizesBytes.get(extension) ?? [];
	fileSizes.push(sizeBytes);
	profile.extensionFileSizesBytes.set(extension, fileSizes);
}

function finalizeWorkspaceFilesystemProfile(profile) {
	const sortedExtensions = Object.keys(profile.extension_counts).sort(
		(left, right) => left.localeCompare(right),
	);
	const extensionCounts = {};
	const extensions = [];
	let totalSizeBytes = 0;
	for (const extension of sortedExtensions) {
		const fileCount = profile.extension_counts[extension] ?? 0;
		const totalExtensionSizeBytes =
			profile.extensionSizeBytes.get(extension) ?? 0;
		totalSizeBytes += totalExtensionSizeBytes;
		extensionCounts[extension] = fileCount;
		extensions.push({
			file_extension: extension,
			file_count: fileCount,
			total_size_mb: roundMegabytes(totalExtensionSizeBytes),
			median_file_size_kb: roundKilobytes(
				median(profile.extensionFileSizesBytes.get(extension) ?? []),
			),
		});
	}
	return {
		file_count: profile.file_count,
		directory_count: profile.directory_count,
		extension_count: sortedExtensions.length,
		extension_counts: extensionCounts,
		total_size_mb: roundMegabytes(totalSizeBytes),
		extensions,
	};
}

function extensionFromPath(fileName) {
	const match = fileName.match(/\.([^./]+)$/);
	if (!match?.[1]) {
		return "(none)";
	}
	return normalizeFileExtension(match[1]);
}

function normalizeFileExtension(extension) {
	const normalized = extension.trim().toLowerCase();
	return /^[a-z0-9][a-z0-9+_-]{0,15}$/.test(normalized) ? normalized : "other";
}

function parentDirectories(relativePath) {
	const parts = relativePath.split("/").filter(Boolean);
	const fileName = parts.pop();
	if (!fileName) {
		return [];
	}
	const directories = [];
	for (let index = 1; index <= parts.length; index += 1) {
		directories.push(parts.slice(0, index).join("/"));
	}
	return directories;
}

function median(values) {
	if (values.length === 0) {
		return 0;
	}
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) {
		return sorted[middle] ?? 0;
	}
	return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function roundMegabytes(bytes) {
	return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

function roundKilobytes(bytes) {
	return Math.round((bytes / 1024) * 100) / 100;
}

async function resolveStandaloneFile(resolvedPath) {
	try {
		if (!(await stat(resolvedPath)).isFile()) {
			return null;
		}
	} catch {
		return null;
	}
	const workspaceDir = await findLixWorkspaceRoot(path.dirname(resolvedPath));
	return workspaceDir ? null : resolvedPath;
}

function createPersistentWorkspace(workspacePath) {
	const resolvedPath = path.resolve(workspacePath);
	return {
		ephemeral: false,
		path: resolvedPath,
		name: path.basename(resolvedPath) || resolvedPath,
	};
}

function createEphemeralWorkspace(workspacePath, includePaths = []) {
	const resolvedPath = path.resolve(workspacePath);
	return {
		ephemeral: true,
		path: resolvedPath,
		includePaths: normalizeIncludePaths(includePaths),
		name: path.basename(resolvedPath) || resolvedPath,
	};
}

function normalizeIncludePaths(includePaths) {
	const seen = new Set();
	const normalizedIncludePaths = [];
	for (const includePath of includePaths ?? []) {
		if (typeof includePath !== "string" || includePath.length === 0) {
			continue;
		}
		const segments = includePath
			.replaceAll("\\", "/")
			.replace(/^\/+/, "")
			.split("/")
			.filter(Boolean);
		if (
			segments.length === 0 ||
			segments[0] === LIX_DIRECTORY_NAME ||
			segments.some((segment) => segment === "..")
		) {
			continue;
		}
		const normalizedIncludePath = segments.join("/");
		if (
			normalizedIncludePath.length === 0 ||
			normalizedIncludePath.endsWith("/")
		) {
			continue;
		}
		if (seen.has(normalizedIncludePath)) {
			continue;
		}
		seen.add(normalizedIncludePath);
		normalizedIncludePaths.push(normalizedIncludePath);
	}
	return normalizedIncludePaths;
}

function isWorkspaceSessionEntryLike(value) {
	return (
		value &&
		typeof value === "object" &&
		typeof value.path === "string" &&
		Array.isArray(value.openFiles)
	);
}

async function ensureExternalLixDir(window) {
	const state = getOrCreateWindowState(window);
	if (state.externalLixDir) {
		return state.externalLixDir;
	}
	await createExternalLixSlot(state);
	return state.externalLixDir;
}

async function createExternalLixSlot(state) {
	if (state.externalLixParent) {
		await disposeExternalLixState(state);
	}
	const externalLixParent = await mkdtemp(
		path.join(os.tmpdir(), "flashtype-lix-"),
	);
	state.externalLixParent = externalLixParent;
	state.externalLixDir = path.join(externalLixParent, LIX_DIRECTORY_NAME);
}

async function moveWorkspaceLixToExternalStorage(state) {
	const workspace = state.workspace;
	if (!workspace) {
		throw new Error("No workspace is open.");
	}
	await createExternalLixSlot(state);
	const workspaceLixDir = path.join(workspace.path, LIX_DIRECTORY_NAME);
	if (await pathExists(workspaceLixDir)) {
		await movePath(workspaceLixDir, state.externalLixDir);
	}
}

async function moveExternalLixBackIntoWorkspace(state) {
	const workspace = state.workspace;
	if (!workspace) {
		throw new Error("No workspace is open.");
	}
	const workspaceLixDir = path.join(workspace.path, LIX_DIRECTORY_NAME);
	const externalLixDir = state.externalLixDir;
	if (externalLixDir && (await pathExists(externalLixDir))) {
		if (await pathExists(workspaceLixDir)) {
			throw new Error(
				`Cannot turn Track Changes on because ${workspaceLixDir} already exists.`,
			);
		}
		await movePath(externalLixDir, workspaceLixDir);
	}
	await disposeExternalLixState(state);
}

async function disposeExternalLixState(state) {
	if (!state?.externalLixParent) {
		return;
	}
	const externalLixParent = state.externalLixParent;
	state.externalLixParent = null;
	state.externalLixDir = null;
	await rm(externalLixParent, { force: true, recursive: true }).catch(() => {});
}

async function movePath(source, target) {
	try {
		await rename(source, target);
		return;
	} catch (error) {
		if (error?.code === "ENOENT") {
			return;
		}
		if (error?.code !== "EXDEV") {
			throw error;
		}
	}
	await cp(source, target, { recursive: true });
	await rm(source, { force: true, recursive: true });
}

async function pathExists(filePath) {
	try {
		await stat(filePath);
		return true;
	} catch {
		return false;
	}
}

function createTransientDirectoryWorkspace(filePaths) {
	const normalizedFilePaths = normalizeFilePaths(filePaths);
	const workspacePath = deepestCommonParent(
		normalizedFilePaths.map((filePath) =>
			path.dirname(filePath),
		),
	);
	return createEphemeralWorkspace(
		workspacePath,
		normalizedFilePaths.map((filePath) =>
			toPortableRelativePath(path.relative(workspacePath, filePath)),
		),
	);
}

function normalizeFilePaths(filePaths) {
	const seen = new Set();
	const normalizedFilePaths = [];
	for (const filePath of filePaths) {
		if (typeof filePath !== "string" || filePath.length === 0) {
			continue;
		}
		const normalizedFilePath = path.resolve(filePath);
		if (seen.has(normalizedFilePath)) {
			continue;
		}
		seen.add(normalizedFilePath);
		normalizedFilePaths.push(normalizedFilePath);
	}
	return normalizedFilePaths;
}

function toPortableRelativePath(relativePath) {
	return relativePath.split(path.sep).filter(Boolean).join("/");
}

function deepestCommonParent(directories) {
	if (directories.length === 0) {
		return path.resolve(".");
	}
	const [firstDirectory, ...remainingDirectories] = directories.map(
		(directory) => path.resolve(directory),
	);
	const root = path.parse(firstDirectory).root;
	const commonSegments = firstDirectory
		.slice(root.length)
		.split(path.sep)
		.filter(Boolean);
	for (const directory of remainingDirectories) {
		const directoryRoot = path.parse(directory).root;
		if (directoryRoot !== root) {
			return root;
		}
		const segments = directory
			.slice(root.length)
			.split(path.sep)
			.filter(Boolean);
		let index = 0;
		while (
			index < commonSegments.length &&
			index < segments.length &&
			commonSegments[index] === segments[index]
		) {
			index += 1;
		}
		commonSegments.length = index;
	}
	return path.join(root, ...commonSegments);
}

function workspaceKey(workspace) {
	if (!workspace) {
		return null;
	}
	if (workspace.ephemeral === true) {
		return `ephemeral:${workspace.path}:${(workspace.includePaths ?? []).join("\0")}`;
	}
	return `directory:${workspace.path}`;
}

export async function showWorkspaceDialog(window) {
	const dialogOptions = {
		title: "Open Folder",
		buttonLabel: "Open",
		properties: ["openDirectory", "createDirectory"],
	};
	return window && !window.isDestroyed()
		? await dialog.showOpenDialog(window, dialogOptions)
		: await dialog.showOpenDialog(dialogOptions);
}

async function findLixWorkspaceRoot(startDir) {
	let current = path.resolve(startDir);
	while (true) {
		if (await hasLixWorkspaceMetadata(current)) {
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			return null;
		}
		current = parent;
	}
}

async function hasLixWorkspaceMetadata(workspaceDir) {
	if (await isDirectory(path.join(workspaceDir, LIX_ROCKSDB_DATABASE_DIR))) {
		return true;
	}
	return (await findLixDatabasePath(workspaceDir)) !== null;
}

async function findLixDatabasePath(workspaceDir) {
	for (const databaseFile of LIX_DATABASE_FILES) {
		const databasePath = path.join(workspaceDir, databaseFile);
		if (await isFile(databasePath)) {
			return databasePath;
		}
	}
	return null;
}

async function isDirectory(filePath) {
	try {
		return (await stat(filePath)).isDirectory();
	} catch {
		return false;
	}
}

async function isFile(filePath) {
	try {
		return (await stat(filePath)).isFile();
	} catch {
		return false;
	}
}

function enqueueWorkspaceChange(state, operation) {
	const result = state.workspaceChangeQueue.catch(() => {}).then(operation);
	state.workspaceChangeQueue = result.catch(() => {});
	return result;
}

export function registerWorkspaceIpc(getWindowForEvent, options = {}) {
	if (registered) {
		return;
	}
	registered = true;

	ipcMain.handle("workspace:get", (event) => {
		return getWorkspace(getWindowForEvent(event));
	});

	ipcMain.handle("workspace:consumePendingOpenFiles", (event) => {
		return consumePendingOpenFiles(getWindowForEvent(event));
	});

	ipcMain.handle("workspace:profile", async (event) => {
		return await profileWorkspaceFilesystem(
			getWorkspace(getWindowForEvent(event)),
		);
	});

	ipcMain.handle("workspace:open", async (event, payload) => {
		const window = getWindowForEvent(event);
		const requestedPath = payload?.path;
		if (typeof requestedPath === "string" && requestedPath.length > 0) {
			return await setWorkspaceFromPath(requestedPath, window, options);
		}
		return await openWorkspaceDialog(window, options);
	});

	ipcMain.handle("workspace:openInNewWindow", async (event, payload) => {
		if (typeof options.openInNewWindow !== "function") {
			throw new Error("workspace.openInNewWindow is not available");
		}
		const sourceWindow = getWindowForEvent(event);
		const requestedPath = payload?.path;
		if (typeof requestedPath === "string" && requestedPath.length > 0) {
			return await options.openInNewWindow(requestedPath, sourceWindow);
		}

		const result = await showWorkspaceDialog(sourceWindow);
		const dir = result.filePaths[0];
		if (result.canceled || dir === undefined) {
			return null;
		}
		return await options.openInNewWindow(dir, sourceWindow);
	});
}

function getWindowState(window) {
	if (!window || window.isDestroyed()) {
		return null;
	}
	return windowStates.get(window.id) ?? null;
}

function getOrCreateWindowState(window) {
	if (!window || window.isDestroyed()) {
		throw new Error("A live window is required to open a workspace.");
	}
	const existing = windowStates.get(window.id);
	if (existing) {
		return existing;
	}
	const state = {
		workspace: null,
		pendingOpenFilePaths: [],
		externalLixParent: null,
		externalLixDir: null,
		workspaceChangeQueue: Promise.resolve(),
	};
	windowStates.set(window.id, state);
	return state;
}
