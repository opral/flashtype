import type {
	CreateCheckpointResult,
	CreateVersionOptions,
	CreateVersionResult,
	ExecuteOptions,
	Lix,
	ObserveEvent,
	ObserveEvents,
	ObserveQuery,
	QueryResult,
	SqlTransaction,
	StateCommitStream,
	StateCommitStreamBatch,
	StateCommitStreamFilter,
	TransactionStatement,
	InstallPluginOptions,
} from "@lix-js/sdk";

type DesktopApi = NonNullable<Window["flashtypeDesktop"]>;
let desktopOperationQueue: Promise<void> = Promise.resolve();

export async function openDesktopLix(): Promise<Lix> {
	const desktop = getDesktopApi();
	await desktop.lix.open();

	let closed = false;

	const ensureOpen = (methodName: string): void => {
		if (closed) {
			throw new Error(`lix is closed; ${methodName}() is unavailable`);
		}
	};

	const acquireTransactionSlot = async (): Promise<(() => void)> => {
		const previous = desktopOperationQueue;
		let releaseCurrent: (() => void) | undefined;
		const current = new Promise<void>((resolve) => {
			releaseCurrent = resolve;
		});
		desktopOperationQueue = previous.then(() => current);
		await previous;
		return () => {
			releaseCurrent?.();
		};
	};

	const runQueued = async <T>(operation: () => Promise<T>): Promise<T> => {
		const release = await acquireTransactionSlot();
		try {
			return await operation();
		} finally {
			release();
		}
	};

	const execute = async (
		sql: string,
		params: ReadonlyArray<unknown> = [],
		options?: ExecuteOptions,
	): Promise<QueryResult> => {
		ensureOpen("execute");
		return await runQueued(() => desktop.lix.execute({ sql, params, options }));
	};

	const beginTransaction = async (
		options?: ExecuteOptions,
	): Promise<SqlTransaction> => {
		ensureOpen("beginTransaction");
		const releaseSlot = await acquireTransactionSlot();
		let transactionClosed = false;
		try {
			await desktop.lix.execute({ sql: "BEGIN", params: [], options });
		} catch (error) {
			releaseSlot();
			throw error;
		}

		const tx = {
			execute: async (
				sql: string,
				params: ReadonlyArray<unknown> = [],
			): Promise<QueryResult> => {
				if (transactionClosed) {
					throw new Error("transaction is closed; execute() is unavailable");
				}
				ensureOpen("transaction.execute");
				return await desktop.lix.execute({ sql, params, options });
			},
			commit: async (): Promise<void> => {
				if (transactionClosed) return;
				try {
					await desktop.lix.execute({ sql: "COMMIT", params: [], options });
				} finally {
					transactionClosed = true;
					releaseSlot();
				}
			},
			rollback: async (): Promise<void> => {
				if (transactionClosed) return;
				try {
					await desktop.lix.execute({ sql: "ROLLBACK", params: [], options });
				} finally {
					transactionClosed = true;
					releaseSlot();
				}
			},
		} satisfies SqlTransaction;

		return tx;
	};

	async function transaction<T>(
		options: ExecuteOptions,
		f: (tx: SqlTransaction) => Promise<T>,
	): Promise<T>;
	async function transaction<T>(f: (tx: SqlTransaction) => Promise<T>): Promise<T>;
	async function transaction<T>(
		first: ExecuteOptions | ((tx: SqlTransaction) => Promise<T>),
		second?: (tx: SqlTransaction) => Promise<T>,
	): Promise<T> {
		ensureOpen("transaction");
		const options = typeof first === "function" ? undefined : first;
		const callback = (typeof first === "function" ? first : second) as
			| ((tx: SqlTransaction) => Promise<T>)
			| undefined;
		if (typeof callback !== "function") {
			throw new Error("transaction requires an async callback");
		}
		const tx = await beginTransaction(options);
		try {
			const value = await callback(tx);
			await tx.commit();
			return value;
		} catch (error) {
			try {
				await tx.rollback();
			} catch {
				// ignore rollback errors; preserve original error
			}
			throw error;
		}
	}

	const executeTransaction = async (
		statements: ReadonlyArray<TransactionStatement>,
		options?: ExecuteOptions,
	): Promise<QueryResult> => {
		ensureOpen("executeTransaction");
		return await runQueued(() =>
			desktop.lix.executeTransaction({
				statements,
				options,
			}),
		);
	};

	const observe = (query: ObserveQuery): ObserveEvents => {
		ensureOpen("observe");

		let localClosed = false;
		let observeIdPromise: Promise<string> | null = null;

		const ensureObserveId = async (): Promise<string> => {
			if (!observeIdPromise) {
				observeIdPromise = desktop.lix.observeStart({ query });
			}
			return await observeIdPromise;
		};

		return {
			async next(): Promise<ObserveEvent | undefined> {
				if (closed || localClosed) {
					return undefined;
				}
				const observeId = await ensureObserveId();
				return await desktop.lix.observeNext({ observeId });
			},
			close(): void {
				if (localClosed) {
					return;
				}
				localClosed = true;
				void (async () => {
					const observeId = await ensureObserveId();
					await desktop.lix.observeClose({ observeId });
				})();
			},
		};
	};

	const stateCommitStream = (
		filter: StateCommitStreamFilter = {},
	): StateCommitStream => {
		ensureOpen("stateCommitStream");

		let localClosed = false;
		let inFlight = false;
		const queue: StateCommitStreamBatch[] = [];
		const streamIdPromise = desktop.lix.stateCommitStreamOpen({ filter });

		const poll = async (): Promise<void> => {
			if (closed || localClosed || inFlight) {
				return;
			}
			inFlight = true;
			try {
				const streamId = await streamIdPromise;
				if (closed || localClosed) {
					return;
				}
				const batch = await desktop.lix.stateCommitStreamTryNext({ streamId });
				if (batch) {
					queue.push(batch);
				}
			} finally {
				inFlight = false;
			}
		};

		const intervalId = window.setInterval(() => {
			void poll();
		}, 50);
		void poll();

		return {
			tryNext(): StateCommitStreamBatch | undefined {
				if (closed || localClosed) {
					return undefined;
				}
				return queue.shift();
			},
			close(): void {
				if (localClosed) {
					return;
				}
				localClosed = true;
				window.clearInterval(intervalId);
				void (async () => {
					const streamId = await streamIdPromise;
					await desktop.lix.stateCommitStreamClose({ streamId });
				})();
			},
		};
	};

	const createVersion = async (
		options: CreateVersionOptions = {},
	): Promise<CreateVersionResult> => {
		ensureOpen("createVersion");
		return await runQueued(() => desktop.lix.createVersion({ options }));
	};

	const switchVersion = async (versionId: string): Promise<void> => {
		ensureOpen("switchVersion");
		await runQueued(() => desktop.lix.switchVersion({ versionId }));
	};

	const createCheckpoint = async (): Promise<CreateCheckpointResult> => {
		ensureOpen("createCheckpoint");
		return await runQueued(() => desktop.lix.createCheckpoint());
	};

	const installPlugin = async (options: InstallPluginOptions): Promise<void> => {
		ensureOpen("installPlugin");
		await runQueued(() => desktop.lix.installPlugin(options));
	};

	const exportSnapshot = async (): Promise<Uint8Array> => {
		ensureOpen("exportSnapshot");
		return await desktop.lix.exportSnapshot();
	};

	const close = async (): Promise<void> => {
		if (closed) {
			return;
		}
		closed = true;
		await desktop.lix.close();
	};

	return {
		execute,
		beginTransaction,
		transaction,
		executeTransaction,
		stateCommitStream,
		observe,
		createVersion,
		createCheckpoint,
		switchVersion,
		installPlugin,
		exportSnapshot,
		close,
	};
}

function getDesktopApi(): DesktopApi {
	if (!window.flashtypeDesktop?.lix) {
		throw new Error(
			"Desktop bridge is unavailable. Start Flashtype via Electron (pnpm dev).",
		);
	}
	return window.flashtypeDesktop;
}
