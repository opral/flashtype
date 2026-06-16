import { FsBackend, bundledPluginArchives, openLix } from "@lix-js/sdk";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { getWorkspace, getWorkspaceLixDatabasePath } from "./workspace.mjs";

let lixPromise = null;
let lifecycle = Promise.resolve();
const LIX_DATABASE_DIR = ".lix";

function enqueue(operation) {
	lifecycle = lifecycle.catch(() => {}).then(operation);
	return lifecycle;
}

export async function ensureLixOpen() {
	let outPromise;
	await enqueue(async () => {
		if (!lixPromise) {
			const openingPromise = (async () => {
				const workspace = getWorkspace();
				if (!workspace) {
					throw new Error(
						"No workspace is open. Open a folder before using lix.",
					);
				}
				await ensureBundledPluginArchivesOnDisk(workspace.path);
				const nativeLix = await openLix({
					backend: new FsBackend({ path: workspace.path }),
				});
				await ensureDefaultPluginsInstalledOnCurrentBranch(nativeLix);
				return createDesktopLixHandle(nativeLix, workspace.path);
			})();
			lixPromise = openingPromise;
			openingPromise.catch(() => {
				if (lixPromise === openingPromise) {
					lixPromise = null;
				}
			});
		}
		outPromise = lixPromise;
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

async function ensureBundledPluginArchivesOnDisk(workspacePath) {
	for (const plugin of await bundledPluginArchives()) {
		const filePath = path.join(
			workspacePath,
			pluginArchivePath(plugin).slice(1),
		);
		if (await fileBytesEqual(filePath, plugin.archiveBytes)) {
			continue;
		}
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(filePath, plugin.archiveBytes);
	}
}

function pluginArchivePath(plugin) {
	return `/.lix_system/plugins/${plugin.key}.lixplugin`;
}

async function readLixFileBytes(lix, path) {
	const result = await lix.execute("SELECT data FROM lix_file WHERE path = $1", [
		path,
	]);
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

async function fileBytesEqual(filePath, expected) {
	try {
		const existing = await readFile(filePath);
		return Buffer.compare(existing, Buffer.from(expected)) === 0;
	} catch (error) {
		if (error?.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

export async function closeLix() {
	await enqueue(async () => {
		await closeCurrentLix();
	});
}

export async function resetLixRepository() {
	await enqueue(async () => {
		const workspace = getWorkspace();
		if (!workspace) {
			throw new Error(
				"No workspace is open. Open a folder before resetting lix.",
			);
		}
		await closeCurrentLix({ ignoreOpenError: true });
		await removeLixDatabaseFiles(workspace.path);
	});
}

export async function exportCurrentLixImage() {
	await ensureLixOpen();

	let bytes;
	await enqueue(async () => {
		await closeCurrentLix();
		await checkpointWorkspaceLixDatabase();
		bytes = await readFile(getWorkspaceLixDatabasePath());
	});
	return bytes;
}

async function closeCurrentLix(options = {}) {
	if (!lixPromise) {
		return;
	}
	const currentPromise = lixPromise;
	try {
		const lix = await currentPromise;
		await lix.close();
	} catch (error) {
		if (!options.ignoreOpenError) {
			throw error;
		}
	} finally {
		if (lixPromise === currentPromise) {
			lixPromise = null;
		}
	}
}

async function removeLixDatabaseFiles(workspacePath) {
	await rm(path.join(workspacePath, LIX_DATABASE_DIR), {
		force: true,
		recursive: true,
	});
}

async function checkpointWorkspaceLixDatabase() {
	const { DatabaseSync } = await import("node:sqlite");
	const database = new DatabaseSync(getWorkspaceLixDatabasePath());
	try {
		database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
	} finally {
		database.close();
	}
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
