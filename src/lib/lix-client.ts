import type {
	CreateBranchOptions,
	CreateBranchReceipt,
	SwitchBranchOptions,
	SwitchBranchReceipt,
} from "@lix-js/sdk";
import type {
	ExecuteOptions,
	Lix,
	LixRuntimeQueryResult,
	ObserveEvent,
	ObserveEvents,
	ObserveQuery,
	SqlTransaction,
	TransactionStatement,
} from "@/lib/lix-types";

type DesktopApi = NonNullable<Window["flashtypeDesktop"]>;
let desktopOperationQueue: Promise<void> = Promise.resolve();

export async function openDesktopLix(): Promise<Lix> {
	const desktop = getDesktopApi();
	await desktop.lix.open();

	let closed = false;
	const openSqlTransactions = new Set<{
		forceRollback: () => Promise<void>;
	}>();

	const ensureOpen = (methodName: string): void => {
		if (closed) {
			throw new Error(`lix is closed; ${methodName}() is unavailable`);
		}
	};

	const acquireTransactionSlot = async (): Promise<() => void> => {
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
	): Promise<LixRuntimeQueryResult> => {
		ensureOpen("execute");
		return toRuntimeQueryResult(
			await runQueued(() => desktop.lix.execute({ sql, params, options })),
		);
	};

	const beginTransaction = async (
		options?: ExecuteOptions,
	): Promise<SqlTransaction> => {
		ensureOpen("beginTransaction");
		const releaseSlot = await acquireTransactionSlot();
		let transactionClosed = false;
		let transactionId = "";
		try {
			const handle = await desktop.lix.transactionBegin({ options });
			transactionId = handle.transactionId;
		} catch (error) {
			releaseSlot();
			throw error;
		}

		const tx = {
			execute: async (
				sql: string,
				params: ReadonlyArray<unknown> = [],
			): Promise<LixRuntimeQueryResult> => {
				if (transactionClosed) {
					throw new Error("transaction is closed; execute() is unavailable");
				}
				ensureOpen("transaction.execute");
				return toRuntimeQueryResult(
					await desktop.lix.transactionExecute({
						transactionId,
						sql,
						params,
					}),
				);
			},
			commit: async (): Promise<void> => {
				if (transactionClosed) return;
				try {
					await desktop.lix.transactionCommit({ transactionId });
				} finally {
					transactionClosed = true;
					openSqlTransactions.delete(txHandle);
					releaseSlot();
				}
			},
			rollback: async (): Promise<void> => {
				if (transactionClosed) return;
				try {
					await desktop.lix.transactionRollback({ transactionId });
				} finally {
					transactionClosed = true;
					openSqlTransactions.delete(txHandle);
					releaseSlot();
				}
			},
		} satisfies SqlTransaction;

		const txHandle = {
			forceRollback: async (): Promise<void> => {
				if (transactionClosed) {
					return;
				}
				try {
					await desktop.lix.transactionRollback({ transactionId });
				} finally {
					transactionClosed = true;
					releaseSlot();
				}
			},
		};
		openSqlTransactions.add(txHandle);

		return tx;
	};

	async function transaction<T>(
		options: ExecuteOptions,
		f: (tx: SqlTransaction) => Promise<T>,
	): Promise<T>;
	async function transaction<T>(
		f: (tx: SqlTransaction) => Promise<T>,
	): Promise<T>;
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
	): Promise<LixRuntimeQueryResult> => {
		ensureOpen("executeTransaction");
		return toRuntimeQueryResult(
			await runQueued(() =>
				desktop.lix.executeTransaction({
					statements,
					options,
				}),
			),
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
				const event = await desktop.lix.observeNext({ observeId });
				if (!event) {
					return undefined;
				}
				return {
					sequence: event.sequence,
					rows: event.rows.rows,
					columns: event.rows.columns,
				} as ObserveEvent;
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

	const activeBranchId = async (): Promise<string> => {
		ensureOpen("activeBranchId");
		return await runQueued(() => desktop.lix.activeBranchId());
	};

	const createBranch = async (
		options: CreateBranchOptions,
	): Promise<CreateBranchReceipt> => {
		ensureOpen("createBranch");
		return await runQueued(() => desktop.lix.createBranch({ options }));
	};

	const switchBranch = async (
		options: SwitchBranchOptions,
	): Promise<SwitchBranchReceipt> => {
		ensureOpen("switchBranch");
		return await runQueued(() => desktop.lix.switchBranch(options));
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
		for (const tx of [...openSqlTransactions]) {
			try {
				await tx.forceRollback();
			} catch {
				// ignore rollback failures while shutting down
			}
		}
		openSqlTransactions.clear();
		await desktop.lix.close();
	};

	const lix = {
		execute,
		beginTransaction,
		transaction,
		executeTransaction,
		observe,
		activeBranchId,
		createBranch,
		switchBranch,
		exportSnapshot,
		close,
	};
	return lix satisfies Lix;
}

function getDesktopApi(): DesktopApi {
	if (!window.flashtypeDesktop?.lix) {
		throw new Error(
			"Desktop bridge is unavailable. Start Flashtype via Electron (pnpm dev).",
		);
	}
	return window.flashtypeDesktop;
}

function toRuntimeQueryResult(result: {
	rows: unknown[][];
	columns: string[];
	rowsAffected?: number;
	notices?: Array<{
		code: string;
		message: string;
		hint?: string;
	}>;
}): LixRuntimeQueryResult {
	return {
		rows: result.rows,
		columns: result.columns,
		rowsAffected: result.rowsAffected ?? 0,
		notices: result.notices ?? [],
	};
}
