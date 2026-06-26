import { app } from "electron";
import { FsBackend, bundledPluginArchives, openLix } from "@lix-js/sdk";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import {
	getWorkspace,
	getWorkspaceFsBackendOptions,
	getWorkspaceLixDatabasePath,
} from "./workspace.mjs";
import {
	clearWorkspaceLixOpenPendingSync,
	markWorkspaceLixOpenPendingSync,
	writeWorkspaceRecoverySync,
} from "./workspace-recovery.mjs";

const LIX_DATABASE_DIR = ".lix";
const sessions = new Map();

export async function ensureLixOpen(window) {
	const session = getOrCreateSession(window);
	let outPromise;
	await enqueue(session, async () => {
		if (!session.lixPromise) {
			const openingPromise = (async () => {
				const workspace = getWorkspace(window);
				if (!workspace) {
					throw new Error(
						"No workspace is open. Open a folder before using lix.",
					);
				}
				let nativeLix;
				const tracksPersistentWorkspace = workspace.ephemeral !== true;
				const userDataPath = app.getPath("userData");
				try {
					if (tracksPersistentWorkspace) {
						markWorkspaceLixOpenPendingSync(
							userDataPath,
							createTrackChangesRecovery(workspace, {
								reason: "lix_open_pending",
							}),
						);
					}
					const backendOptions = await getWorkspaceFsBackendOptions(window);
					nativeLix = await openLix({
						backend: new FsBackend(backendOptions),
					});
					await ensureDefaultPluginsInstalledOnCurrentBranch(nativeLix);
					if (tracksPersistentWorkspace) {
						clearWorkspaceLixOpenPendingSync(userDataPath, workspace.path);
					}
					return createDesktopLixHandle(nativeLix, workspace.path);
				} catch (error) {
					await nativeLix?.close().catch(() => {});
					if (tracksPersistentWorkspace) {
						clearWorkspaceLixOpenPendingSync(userDataPath, workspace.path);
						writeWorkspaceRecoverySync(
							userDataPath,
							createTrackChangesRecovery(workspace, {
								reason: "lix_open_failed",
								message: errorMessage(error),
							}),
						);
					}
					throw error;
				}
			})();
			session.lixPromise = openingPromise;
			openingPromise.catch(() => {
				if (session.lixPromise === openingPromise) {
					session.lixPromise = null;
				}
			});
		}
		outPromise = session.lixPromise;
	});
	return await outPromise;
}

async function ensureDefaultPluginsInstalledOnCurrentBranch(lix) {
	for (const plugin of await bundledPluginArchives()) {
		const archivePath = pluginArchivePath(plugin);
		const existing = await readLixFileBytes(lix, archivePath);
		if (!bytesEqual(existing, plugin.archiveBytes)) {
			await writeLixFileBytes(lix, archivePath, plugin.archiveBytes);
		}
	}
}

function pluginArchivePath(plugin) {
	return `/.lix/plugins/${plugin.key}.lixplugin`;
}

async function readLixFileBytes(lix, path) {
	const result = await lix.execute(
		"SELECT data FROM lix_file WHERE path = $1",
		[path],
	);
	return result.rows[0]?.value("data").asBytes();
}

async function writeLixFileBytes(lix, path, data) {
	await lix.execute(
		"INSERT INTO lix_file (path, data) VALUES ($1, $2) ON CONFLICT (path) DO UPDATE SET data = excluded.data",
		[path, data],
	);
}

function bytesEqual(actual, expected) {
	if (!(actual instanceof Uint8Array)) {
		return false;
	}
	return Buffer.compare(Buffer.from(actual), Buffer.from(expected)) === 0;
}

function createTrackChangesRecovery(workspace, options) {
	return {
		kind: "track_changes",
		workspacePath: workspace.path,
		workspaceName: workspace.name,
		reason: options.reason,
		message: options.message,
		createdAt: new Date().toISOString(),
	};
}

function errorMessage(error) {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

export async function closeLix(window, options = {}) {
	const session = getSession(window);
	if (!session) {
		return;
	}
	await enqueue(session, async () => {
		await closeCurrentLix(session, options);
	});
}

export async function resetLixRepository(window) {
	const session = getOrCreateSession(window);
	await enqueue(session, async () => {
		const workspace = getWorkspace(window);
		if (!workspace) {
			throw new Error(
				"No workspace is open. Open a folder before resetting lix.",
			);
		}
		if (workspace.ephemeral === true) {
			throw new Error("Cannot reset a transient workspace.");
		}
		await closeCurrentLix(session, { ignoreOpenError: true });
		await removeLixDatabaseFiles(workspace.path);
	});
}

export async function exportCurrentLixImage(window) {
	const workspace = getWorkspace(window);
	if (workspace?.ephemeral === true) {
		throw new Error(
			"Cannot export a .lix database from a transient workspace.",
		);
	}
	const session = getOrCreateSession(window);
	await ensureLixOpen(window);

	let bytes;
	await enqueue(session, async () => {
		await closeCurrentLix(session);
		await checkpointWorkspaceLixDatabase(window);
		bytes = await readFile(getWorkspaceLixDatabasePath(window));
	});
	return bytes;
}

export async function closeAllLixSessions(options = {}) {
	await Promise.all(
		[...sessions.values()].map((session) =>
			enqueue(session, async () => {
				await closeCurrentLix(session, options);
			}),
		),
	);
}

async function closeCurrentLix(session, options = {}) {
	if (!session.lixPromise) {
		return;
	}
	const currentPromise = session.lixPromise;
	try {
		const lix = await currentPromise;
		await lix.close();
	} catch (error) {
		if (!options.ignoreOpenError) {
			throw error;
		}
	} finally {
		if (session.lixPromise === currentPromise) {
			session.lixPromise = null;
		}
	}
}

async function removeLixDatabaseFiles(workspacePath) {
	await rm(path.join(workspacePath, LIX_DATABASE_DIR), {
		force: true,
		recursive: true,
	});
}

async function checkpointWorkspaceLixDatabase(window) {
	const { DatabaseSync } = await import("node:sqlite");
	const database = new DatabaseSync(getWorkspaceLixDatabasePath(window));
	try {
		database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
	} finally {
		database.close();
	}
}

function enqueue(session, operation) {
	session.lifecycle = session.lifecycle.catch(() => {}).then(operation);
	return session.lifecycle;
}

function getSession(window) {
	if (!window) {
		return null;
	}
	return sessions.get(window.id) ?? null;
}

function getOrCreateSession(window) {
	if (!window || window.isDestroyed()) {
		throw new Error("A live window is required to open lix.");
	}
	const existing = sessions.get(window.id);
	if (existing) {
		return existing;
	}
	const session = {
		windowId: window.id,
		lixPromise: null,
		lifecycle: Promise.resolve(),
	};
	sessions.set(window.id, session);
	window.once("closed", () => {
		void enqueue(session, async () => {
			await closeCurrentLix(session, { ignoreOpenError: true });
			sessions.delete(session.windowId);
		});
	});
	return session;
}

function createDesktopLixHandle(nativeLix, workspaceDir) {
	let operationQueue = Promise.resolve();

	async function acquireOperationSlot() {
		const previous = operationQueue;
		let releaseCurrent;
		const current = new Promise((resolve) => {
			releaseCurrent = resolve;
		});
		operationQueue = previous.then(() => current);
		await previous;
		return () => {
			releaseCurrent?.();
		};
	}

	async function runQueued(operation) {
		const release = await acquireOperationSlot();
		try {
			return await operation();
		} finally {
			release();
		}
	}

	async function waitForOperationQueueToDrain() {
		const currentQueue = operationQueue;
		await currentQueue.catch(() => {});
		if (currentQueue === operationQueue) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}

	return {
		workspaceDir() {
			return workspaceDir;
		},
		async execute(sql, params = []) {
			return await runQueued(() => nativeLix.execute(sql, [...params]));
		},
		async beginTransaction() {
			const releaseSlot = await acquireOperationSlot();
			let transactionClosed = false;
			let transaction;
			try {
				transaction = await nativeLix.beginTransaction();
			} catch (error) {
				releaseSlot();
				throw error;
			}
			return {
				async execute(sql, params = []) {
					return await transaction.execute(sql, [...params]);
				},
				async commit() {
					if (transactionClosed) {
						return;
					}
					try {
						await transaction.commit();
					} finally {
						transactionClosed = true;
						releaseSlot();
					}
				},
				async rollback() {
					if (transactionClosed) {
						return;
					}
					try {
						await transaction.rollback();
					} finally {
						transactionClosed = true;
						releaseSlot();
					}
				},
			};
		},
		async executeTransaction(statements) {
			return await runQueued(async () => {
				const transaction = await nativeLix.beginTransaction();
				let result = emptyExecuteResult();
				try {
					for (const statement of statements) {
						result = await transaction.execute(statement.sql, [
							...(statement.params ?? []),
						]);
					}
					await transaction.commit();
					return result;
				} catch (error) {
					await transaction.rollback();
					throw error;
				}
			});
		},
		observe(sql, params = []) {
			return createQueuedObserve(
				nativeLix,
				sql,
				[...params],
				waitForOperationQueueToDrain,
			);
		},
		async activeBranchId() {
			return await runQueued(() => nativeLix.activeBranchId());
		},
		async createBranch(options = {}) {
			const created = await runQueued(() =>
				nativeLix.createBranch({
					id: options.id,
					name: options.name ?? "Draft",
					fromCommitId: options.fromCommitId,
				}),
			);
			return {
				id: created.id,
				name: created.name,
				hidden: created.hidden,
				commitId: created.commitId,
			};
		},
		async switchBranch(options) {
			return await runQueued(async () => {
				const receipt = await nativeLix.switchBranch(options);
				await ensureDefaultPluginsInstalledOnCurrentBranch(nativeLix);
				return receipt;
			});
		},
		async importFilesystemPaths(paths = []) {
			return await runQueued(() =>
				nativeLix.importFilesystemPaths([...(paths ?? [])]),
			);
		},
		async close() {
			await runQueued(() => nativeLix.close());
		},
	};
}

function emptyExecuteResult() {
	return { columns: [], rows: [], rowsAffected: 0, notices: [] };
}

function createQueuedObserve(
	nativeLix,
	sql,
	params,
	waitForOperationQueueToDrain,
) {
	let closed = false;
	let events;

	async function ensureEvents() {
		while (!closed) {
			try {
				if (!events) {
					events = nativeLix.observe(sql, params);
				}
				return events;
			} catch (error) {
				if (!isActiveTransactionError(error)) {
					throw error;
				}
				await waitForOperationQueueToDrain();
			}
		}
		return undefined;
	}

	return {
		async next() {
			while (!closed) {
				const currentEvents = await ensureEvents();
				if (!currentEvents) {
					return undefined;
				}
				try {
					return await currentEvents.next();
				} catch (error) {
					if (!isActiveTransactionError(error)) {
						throw error;
					}
					currentEvents.close();
					if (events === currentEvents) {
						events = undefined;
					}
					await waitForOperationQueueToDrain();
				}
			}
			return undefined;
		},
		close() {
			closed = true;
			events?.close();
		},
	};
}

function isActiveTransactionError(error) {
	return error?.code === "LIX_INVALID_TRANSACTION_STATE";
}
