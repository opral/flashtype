import { dialog } from "electron";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { FsBackend, openLix } from "@lix-js/sdk";

let lixPromise = null;
let lifecycle = Promise.resolve();

function enqueue(operation) {
	lifecycle = lifecycle.catch(() => {}).then(operation);
	return lifecycle;
}

async function getLixWorkspaceDir(parentWindow) {
	const workspacePath = getWorkspacePathArgument(process.argv);
	if (workspacePath !== undefined) {
		return path.resolve(workspacePath);
	}
	return await chooseWorkspaceDir(parentWindow);
}

function getWorkspacePathArgument(argv) {
	const argumentOffset = process.defaultApp === true ? 2 : 1;
	return argv[argumentOffset];
}

export async function ensureLixOpen(parentWindow) {
	let outPromise;
	await enqueue(async () => {
		if (!lixPromise) {
			const openingPromise = (async () => {
				const workspaceDir = await getLixWorkspaceDir(parentWindow);
				await mkdir(workspaceDir, { recursive: true });
				const nativeLix = await openLix({
					backend: new FsBackend({ path: workspaceDir }),
				});
				return createDesktopLixHandle(nativeLix, workspaceDir);
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

async function chooseWorkspaceDir(parentWindow) {
	const options = {
		title: "Open Flashtype Workspace",
		buttonLabel: "Open Workspace",
		properties: ["openDirectory", "createDirectory"],
	};
	const result =
		parentWindow && !parentWindow.isDestroyed()
			? await dialog.showOpenDialog(parentWindow, options)
			: await dialog.showOpenDialog(options);
	const workspaceDir = result.filePaths[0];
	if (result.canceled || workspaceDir === undefined) {
		throw new Error("Workspace selection was canceled.");
	}
	return workspaceDir;
}

export async function closeLix() {
	await enqueue(async () => {
		if (!lixPromise) {
			return;
		}
		const currentPromise = lixPromise;
		try {
			const lix = await currentPromise;
			await lix.close();
		} finally {
			lixPromise = null;
		}
	});
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
			return await runQueued(() => nativeLix.switchBranch(options));
		},
		async exportSnapshot() {
			return await readFile(path.join(workspaceDir, ".lix"));
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
	let polling = false;
	let previousKey;
	const pending = [];
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
			if (previousKey !== undefined && key !== previousKey) {
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
		}
	}

	function rejectNext(error) {
		const waiter = pending.shift();
		if (waiter) {
			waiter.reject(error);
		}
	}
}
