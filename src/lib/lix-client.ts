import type {
	CreateBranchOptions,
	CreateBranchReceipt,
	SwitchBranchOptions,
	SwitchBranchReceipt,
} from "@lix-js/sdk";
import type {
	Lix,
	LixRow,
	LixRuntimeQueryResult,
	LixExecuteOptions,
	ObserveEvent,
	ObserveEvents,
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
		options?: LixExecuteOptions,
	): Promise<LixRuntimeQueryResult> => {
		ensureOpen("execute");
		return toRuntimeQueryResult(
			await runQueued(() => desktop.lix.execute({ sql, params, options })),
		);
	};

	const beginTransaction = async (): Promise<SqlTransaction> => {
		ensureOpen("beginTransaction");
		const releaseSlot = await acquireTransactionSlot();
		let transactionClosed = false;
		let transactionId = "";
		try {
			const handle = await desktop.lix.transactionBegin();
			transactionId = handle.transactionId;
		} catch (error) {
			releaseSlot();
			throw error;
		}

		const tx = {
			execute: async (
				sql: string,
				params: ReadonlyArray<unknown> = [],
				options?: LixExecuteOptions,
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
						options,
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
		callback: (tx: SqlTransaction) => Promise<T>,
	): Promise<T> {
		ensureOpen("transaction");
		if (typeof callback !== "function") {
			throw new Error("transaction requires an async callback");
		}
		const tx = await beginTransaction();
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
	): Promise<LixRuntimeQueryResult> => {
		ensureOpen("executeTransaction");
		return toRuntimeQueryResult(
			await runQueued(() =>
				desktop.lix.executeTransaction({
					statements,
				}),
			),
		);
	};

	const observe = (
		sql: string,
		params: ReadonlyArray<unknown> = [],
	): ObserveEvents => {
		ensureOpen("observe");

		let localClosed = false;
		let observeIdPromise: Promise<string> | null = null;

		const ensureObserveId = async (): Promise<string> => {
			if (!observeIdPromise) {
				observeIdPromise = desktop.lix.observeStart({ sql, params });
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
					mutationSequence: event.mutationSequence,
					result: toRuntimeQueryResult(event.result),
				} as ObserveEvent;
			},
			close(): void {
				if (localClosed) {
					return;
				}
				localClosed = true;
				if (!observeIdPromise) {
					return;
				}
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

	const importFilesystemPaths = async (
		paths: readonly string[],
	): Promise<void> => {
		ensureOpen("importFilesystemPaths");
		await runQueued(() => desktop.lix.importFilesystemPaths({ paths }));
	};

	const syncDiskToLix = async (): Promise<void> => {
		ensureOpen("syncDiskToLix");
		await runQueued(async () => {
			await restoreEphemeralFilesystemPaths(desktop);
			await desktop.lix.syncDiskToLix();
		});
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
		importFilesystemPaths,
		syncDiskToLix,
		close,
	};
	return lix satisfies Lix;
}

/**
 * A filtered FsBackend keeps its selected paths in memory. Reopening the
 * native Lix preserves the tracked files in lix_file but loses that selection,
 * so a plain sync would ignore later disk edits. Restore only the paths the
 * workspace already tracks; this keeps transient workspaces lazy while making
 * external writes observable again.
 */
async function restoreEphemeralFilesystemPaths(
	desktop: DesktopApi,
): Promise<void> {
	const workspace = await desktop.workspace.get();
	if (workspace?.ephemeral !== true) return;

	const result = await desktop.lix.execute({
		sql: `SELECT path
			FROM lix_file
			WHERE path NOT LIKE '/.lix/%'
			ORDER BY path`,
		params: [],
	});
	const paths = result.rows
		.map((row) => row[0])
		.filter((path): path is string => typeof path === "string")
		.filter((path) => !path.startsWith("/.lix/"))
		.map((path) => path.replace(/^\/+/, ""))
		.filter((path) => path.length > 0 && !path.endsWith("/"));
	if (paths.length === 0) return;

	await desktop.lix.importFilesystemPaths({ paths });
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
		rows: result.rows.map((row) => new DesktopRow(result.columns, row)),
		columns: result.columns,
		rowsAffected: result.rowsAffected ?? 0,
		notices: result.notices ?? [],
	};
}

type LixValueLike = ReturnType<LixRow["value"]>;
type LixValueKind = LixValueLike["kind"];

class DesktopRow implements LixRow {
	constructor(
		private readonly columns: string[],
		private readonly values: unknown[],
	) {}

	get(column: string): unknown {
		return this.value(column).toJS();
	}

	value(column: string): LixValueLike {
		const index = this.columns.indexOf(column);
		if (index === -1) {
			throw new Error(
				`Unknown column "${column}". Available columns: ${this.columns.join(", ")}`,
			);
		}
		return new DesktopValue(this.values[index]);
	}

	toObject(): Record<string, unknown> {
		return Object.fromEntries(
			this.columns.map((column, index) => [
				column,
				new DesktopValue(this.values[index]).toJS(),
			]),
		);
	}

	toValueMap(): Record<string, LixValueLike> {
		return Object.fromEntries(
			this.columns.map((column, index) => [
				column,
				new DesktopValue(this.values[index]),
			]),
		);
	}
}

class DesktopValue implements LixValueLike {
	readonly kind: LixValueKind;

	constructor(private readonly raw: unknown) {
		this.kind = valueKind(raw);
	}

	toJS(): unknown {
		if (this.raw instanceof Uint8Array) {
			return new Uint8Array(this.raw);
		}
		return this.raw;
	}

	asBytes(): Uint8Array | undefined {
		if (!(this.raw instanceof Uint8Array)) {
			return undefined;
		}
		return new Uint8Array(this.raw);
	}
}

function valueKind(value: unknown): LixValueKind {
	if (value === null) return "null";
	if (typeof value === "boolean") return "boolean";
	if (typeof value === "string") return "text";
	if (typeof value === "number") {
		return Number.isSafeInteger(value) ? "integer" : "real";
	}
	if (value instanceof Uint8Array) return "blob";
	return "json";
}
