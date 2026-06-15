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
		const existing = await lix.fs.readFile(pluginArchivePath(plugin));
		if (existing === undefined) {
			await lix.installPlugin(plugin.archiveBytes);
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
	if (typeof plugin.path === "string") {
		return plugin.path;
	}
	return `/.lix_system/plugins/${plugin.fileName}`;
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
		observe(query) {
			return createPollingObserve(nativeLix, query, runQueued);
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

function createPollingObserve(nativeLix, query, runQueued) {
	let closed = false;
	let initialized = false;
	let polling = false;
	let previousKey;
	const pending = [];
	const queuedEvents = [];
	let timer;

	const poll = async () => {
		if (closed || polling) {
			return;
		}
		polling = true;
		try {
			const result = await runQueued(() =>
				nativeLix.execute(query?.sql ?? "", [...(query?.params ?? [])]),
			);
			const key = JSON.stringify(result.rows.map((row) => row.toObject()));
			if (!initialized || key !== previousKey) {
				initialized = true;
				resolveNext({ sequence: Date.now(), rows: result });
			}
			previousKey = key;
		} catch (error) {
			rejectNext(error);
		} finally {
			polling = false;
		}
	};

	timer = setInterval(() => {
		void poll();
	}, 500);
	void poll();

	return {
		next() {
			if (closed) {
				return Promise.resolve(undefined);
			}
			const queuedEvent = queuedEvents.shift();
			if (queuedEvent) {
				return Promise.resolve(queuedEvent);
			}
			return new Promise((resolve, reject) => {
				pending.push({ resolve, reject });
			});
		},
		close() {
			if (closed) {
				return;
			}
			closed = true;
			clearInterval(timer);
			while (pending.length > 0) {
				pending.shift()?.resolve(undefined);
			}
		},
	};

	function resolveNext(event) {
		const waiter = pending.shift();
		if (waiter) {
			waiter.resolve(event);
		} else {
			queuedEvents.push(event);
		}
	}

	function rejectNext(error) {
		const waiter = pending.shift();
		if (waiter) {
			waiter.reject(error);
		}
	}
}
