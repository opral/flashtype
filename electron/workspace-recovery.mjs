import fs from "node:fs/promises";
import {
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

export const WORKSPACE_RECOVERY_FILE = "workspace-recovery.json";
export const WORKSPACE_PENDING_LIX_OPEN_FILE =
	"workspace-pending-lix-open.json";
export const WORKSPACE_RECOVERY_VERSION = 1;

export async function readWorkspaceRecovery(userDataPath, workspacePath) {
	const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
	if (!normalizedWorkspacePath) {
		return null;
	}
	const recoveries = await readWorkspaceRecoveries(userDataPath);
	return (
		recoveries.find(
			(recovery) => recovery.workspacePath === normalizedWorkspacePath,
		) ?? null
	);
}

export async function readWorkspaceRecoveries(userDataPath) {
	const recoveries = normalizeWorkspaceRecoveries(
		await readRecoveryStore(userDataPath),
	);
	const existingRecoveries = recoveries.filter((recovery) =>
		isDirectorySync(recovery.workspacePath),
	);
	if (existingRecoveries.length !== recoveries.length) {
		writeWorkspaceRecoveriesSync(userDataPath, existingRecoveries);
	}
	return existingRecoveries;
}

export function readWorkspaceRecoveriesSync(userDataPath) {
	const recoveries = normalizeWorkspaceRecoveries(
		readRecoveryStoreSync(userDataPath),
	);
	const existingRecoveries = recoveries.filter((recovery) =>
		isDirectorySync(recovery.workspacePath),
	);
	if (existingRecoveries.length !== recoveries.length) {
		writeWorkspaceRecoveriesSync(userDataPath, existingRecoveries);
	}
	return existingRecoveries;
}

export function writeWorkspaceRecoverySync(userDataPath, recovery) {
	const normalizedRecovery = normalizeWorkspaceRecovery(recovery);
	if (!normalizedRecovery) {
		return null;
	}
	const recoveries = readWorkspaceRecoveriesSync(userDataPath).filter(
		(existing) => existing.workspacePath !== normalizedRecovery.workspacePath,
	);
	writeWorkspaceRecoveriesSync(userDataPath, [
		...recoveries,
		normalizedRecovery,
	]);
	return normalizedRecovery;
}

export function clearWorkspaceRecoverySync(userDataPath, workspacePath) {
	const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
	if (!normalizedWorkspacePath) {
		return;
	}
	const recoveries = readWorkspaceRecoveriesSync(userDataPath).filter(
		(recovery) => recovery.workspacePath !== normalizedWorkspacePath,
	);
	writeWorkspaceRecoveriesSync(userDataPath, recoveries);
}

export function markWorkspaceLixOpenPendingSync(userDataPath, recovery) {
	const normalizedRecovery = normalizeWorkspaceRecovery(recovery);
	if (!normalizedRecovery) {
		return null;
	}
	const pendingRecoveries = readPendingLixOpenRecoveriesSync(
		userDataPath,
	).filter(
		(existing) => existing.workspacePath !== normalizedRecovery.workspacePath,
	);
	writePendingLixOpenRecoveriesSync(userDataPath, [
		...pendingRecoveries,
		normalizedRecovery,
	]);
	return normalizedRecovery;
}

export function clearWorkspaceLixOpenPendingSync(userDataPath, workspacePath) {
	const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
	if (!normalizedWorkspacePath) {
		return;
	}
	const pendingRecoveries = readPendingLixOpenRecoveriesSync(
		userDataPath,
	).filter((recovery) => recovery.workspacePath !== normalizedWorkspacePath);
	writePendingLixOpenRecoveriesSync(userDataPath, pendingRecoveries);
}

export function recoverPendingWorkspaceLixOpenSync(userDataPath) {
	const pendingRecoveries = readPendingLixOpenRecoveriesSync(userDataPath);
	const recoveriesToWrite = pendingRecoveries
		.filter((recovery) => isDirectorySync(recovery.workspacePath))
		.map((recovery) => ({
			...recovery,
			reason: "previous_lix_open_crash",
			createdAt: new Date().toISOString(),
		}));

	for (const recovery of recoveriesToWrite) {
		writeWorkspaceRecoverySync(userDataPath, recovery);
	}
	writePendingLixOpenRecoveriesSync(userDataPath, []);
	return recoveriesToWrite.length;
}

export function workspaceRecoveryToSessionEntry(recovery) {
	const normalizedRecovery = normalizeWorkspaceRecovery(recovery);
	if (!normalizedRecovery) {
		return null;
	}
	return {
		path: normalizedRecovery.workspacePath,
		openFilePaths: [],
	};
}

async function readRecoveryStore(userDataPath) {
	try {
		return JSON.parse(
			await fs.readFile(getWorkspaceRecoveryPath(userDataPath), "utf8"),
		);
	} catch {
		return null;
	}
}

function readRecoveryStoreSync(userDataPath) {
	try {
		return JSON.parse(
			readFileSync(getWorkspaceRecoveryPath(userDataPath), "utf8"),
		);
	} catch {
		return null;
	}
}

function writeWorkspaceRecoveriesSync(userDataPath, recoveries) {
	writeStoreSync(
		getWorkspaceRecoveryPath(userDataPath),
		normalizeWorkspaceRecoveryList(recoveries),
	);
}

function readPendingLixOpenRecoveriesSync(userDataPath) {
	try {
		return normalizeWorkspaceRecoveries(
			JSON.parse(readFileSync(getPendingLixOpenPath(userDataPath), "utf8")),
		);
	} catch {
		return [];
	}
}

function writePendingLixOpenRecoveriesSync(userDataPath, recoveries) {
	const normalizedRecoveries = normalizeWorkspaceRecoveryList(recoveries);
	if (normalizedRecoveries.length === 0) {
		rmSync(getPendingLixOpenPath(userDataPath), { force: true });
		return;
	}
	writeStoreSync(getPendingLixOpenPath(userDataPath), normalizedRecoveries);
}

function writeStoreSync(filePath, recoveries) {
	const normalizedRecoveries = normalizeWorkspaceRecoveryList(recoveries);
	if (normalizedRecoveries.length === 0) {
		rmSync(filePath, { force: true });
		return;
	}
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(
		filePath,
		JSON.stringify(
			{
				version: WORKSPACE_RECOVERY_VERSION,
				recoveries: normalizedRecoveries,
			},
			null,
			2,
		),
		"utf8",
	);
}

function normalizeWorkspaceRecoveries(store) {
	if (
		!store ||
		typeof store !== "object" ||
		store.version !== WORKSPACE_RECOVERY_VERSION ||
		!Array.isArray(store.recoveries)
	) {
		return [];
	}
	return normalizeWorkspaceRecoveryList(store.recoveries);
}

function normalizeWorkspaceRecoveryList(recoveries) {
	if (!Array.isArray(recoveries)) {
		return [];
	}
	const seen = new Set();
	const normalizedRecoveries = [];
	for (const recovery of recoveries) {
		const normalizedRecovery = normalizeWorkspaceRecovery(recovery);
		if (!normalizedRecovery || seen.has(normalizedRecovery.workspacePath)) {
			continue;
		}
		seen.add(normalizedRecovery.workspacePath);
		normalizedRecoveries.push(normalizedRecovery);
	}
	return normalizedRecoveries;
}

function normalizeWorkspaceRecovery(recovery) {
	if (!recovery || typeof recovery !== "object") {
		return null;
	}
	const workspacePath = normalizeWorkspacePath(recovery.workspacePath);
	if (!workspacePath) {
		return null;
	}
	const workspaceName =
		typeof recovery.workspaceName === "string" &&
		recovery.workspaceName.trim().length > 0
			? recovery.workspaceName.trim()
			: path.basename(workspacePath) || workspacePath;
	const reason =
		typeof recovery.reason === "string" && recovery.reason.trim().length > 0
			? recovery.reason.trim()
			: "unknown";
	const createdAt =
		typeof recovery.createdAt === "string" && recovery.createdAt.length > 0
			? recovery.createdAt
			: new Date().toISOString();
	const normalized = {
		kind: "track_changes",
		workspacePath,
		workspaceName,
		reason,
		createdAt,
	};
	if (Number.isFinite(recovery.exitCode)) {
		normalized.exitCode = recovery.exitCode;
	}
	if (typeof recovery.message === "string" && recovery.message.length > 0) {
		normalized.message = recovery.message;
	}
	return normalized;
}

function normalizeWorkspacePath(workspacePath) {
	if (typeof workspacePath !== "string" || workspacePath.length === 0) {
		return null;
	}
	return path.resolve(workspacePath);
}

function getWorkspaceRecoveryPath(userDataPath) {
	return path.join(userDataPath, WORKSPACE_RECOVERY_FILE);
}

function getPendingLixOpenPath(userDataPath) {
	return path.join(userDataPath, WORKSPACE_PENDING_LIX_OPEN_FILE);
}

function isDirectorySync(filePath) {
	try {
		return statSync(filePath).isDirectory();
	} catch {
		return false;
	}
}
