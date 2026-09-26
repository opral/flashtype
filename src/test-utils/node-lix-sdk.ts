import { FilesystemStorage } from "@lix-js/storage-filesystem";
import { createRequire } from "node:module";
import type {
	StatementResult as ExecuteResult,
	Lix as SdkLix,
	OpenLixOptions as SdkOpenLixOptions,
	SqlParam,
} from "@lix-js/sdk";
import type {
	Lix,
	LixExecuteOptions,
	ObserveEvents,
	OpenLixKeyValueEntry,
	SqlTransaction,
	TransactionStatement,
} from "@/lib/lix-types";

type ExecuteOptions = LixExecuteOptions;

export type { Lix, SqlTransaction } from "@/lib/lix-types";

type OpenTestLixOptions = SdkOpenLixOptions & {
	keyValues?: ReadonlyArray<OpenLixKeyValueEntry>;
};

type SdkModule = typeof import("@lix-js/sdk");

let sdkModulePromise: Promise<SdkModule> | undefined;
const require = createRequire(import.meta.url);

export async function openLix(options: OpenTestLixOptions = {}): Promise<Lix> {
	const { keyValues, ...sdkOptions } = options;
	const sdk = await loadSdk();
	const sdkLix = await sdk.openLix(sdkOptions);
	const localFilesystem =
		sdkOptions.storage instanceof FilesystemStorage
			? sdkOptions.storage
			: undefined;
	const lix = createTestLixAdapter(sdkLix, localFilesystem);
	if (Array.isArray(keyValues)) {
		await seedKeyValues(lix, keyValues);
	}
	return lix;
}

async function loadSdk(): Promise<SdkModule> {
	if (!sdkModulePromise) {
		const sdkPath = require.resolve("@lix-js/sdk");
		// Vitest aliases @lix-js/sdk to this helper; require the built SDK entry
		// so Node, not Vite, owns the native addon's import.meta.url handling.
		sdkModulePromise = Promise.resolve(require(sdkPath) as SdkModule);
	}
	return await sdkModulePromise;
}

async function seedKeyValues(
	lix: Lix,
	keyValues: ReadonlyArray<OpenLixKeyValueEntry>,
): Promise<void> {
	for (const entry of keyValues) {
		if (!entry || typeof entry.key !== "string") {
			continue;
		}
		await lix.execute(
			"INSERT INTO lix_key_value (key, value, lixcol_global, lixcol_untracked) VALUES ($1, $2, true, true)",
			[entry.key, entry.value],
		);
	}
}

function createTestLixAdapter(
	sdkLix: SdkLix,
	localFilesystem?: FilesystemStorage,
): Lix {
	const observations = new Set<ObserveEvents>();
	let closing = false;

	return {
		async execute(
			sql: string,
			params: ReadonlyArray<unknown> = [],
			options?: ExecuteOptions,
		) {
			return await executeWithOptions(sdkLix, sql, params, options);
		},
		async beginTransaction() {
			const transaction = await sdkLix.beginTransaction();
			return {
				async execute(
					sql: string,
					params: ReadonlyArray<unknown> = [],
					options?: ExecuteOptions,
				) {
					return await executeWithOptions(transaction, sql, params, options);
				},
				async commit() {
					await transaction.commit();
				},
				async rollback() {
					await transaction.rollback();
				},
			};
		},
		async transaction<T>(
			callback: (tx: SqlTransaction) => Promise<T>,
		): Promise<T> {
			if (typeof callback !== "function") {
				throw new TypeError("transaction requires a callback");
			}
			const tx = await this.beginTransaction();
			try {
				const result = await callback(tx);
				await tx.commit();
				return result;
			} catch (error) {
				await tx.rollback();
				throw error;
			}
		},
		async executeTransaction(statements: ReadonlyArray<TransactionStatement>) {
			const transaction = await this.beginTransaction();
			let result: ExecuteResult = emptyExecuteResult();
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
		},
		observe(
			sql: string,
			params: ReadonlyArray<unknown> = [],
			options?: Parameters<Lix["observe"]>[2],
		): ObserveEvents {
			const controller = new AbortController();
			const signal = options?.signal;
			const abort = () => controller.abort();
			if (signal?.aborted) abort();
			else signal?.addEventListener("abort", abort, { once: true });
			const sdkEvents = sdkLix.observe(sql, toSqlParams(params), {
				signal: controller.signal,
			});
			let closed = false;
			const events: ObserveEvents = {
				async next() {
					if (closed || closing) return { done: true, value: undefined };
					try {
						return await sdkEvents.next();
					} catch (error) {
						if (closed || closing) return { done: true, value: undefined };
						throw error;
					}
				},
				async return() {
					if (closed) return { done: true, value: undefined };
					closed = true;
					observations.delete(events);
					controller.abort();
					await sdkEvents.return?.();
					return { done: true, value: undefined };
				},
				[Symbol.asyncIterator]() {
					return this;
				},
			};
			observations.add(events);
			return events;
		},
		async activeBranchId() {
			return await sdkLix.activeBranchId();
		},
		async createBranch(options) {
			return await sdkLix.createBranch(options);
		},
		async switchBranch(options) {
			return await sdkLix.switchBranch(options);
		},
		async importFilesystemPaths(paths) {
			if (!localFilesystem) {
				throw new Error(
					"importFilesystemPaths requires local filesystem storage",
				);
			}
			await localFilesystem.importPaths(paths);
		},
		async syncDiskToLix() {
			if (!localFilesystem) {
				throw new Error("syncDiskToLix requires local filesystem storage");
			}
			await localFilesystem.syncDiskToLix();
		},
		async mergeBranchPreview(options) {
			return await sdkLix.mergeBranchPreview(options);
		},
		async mergeBranch(options) {
			return await sdkLix.mergeBranch(options);
		},
		async close() {
			closing = true;
			for (const observation of [...observations]) {
				await observation.return?.();
			}
			await sdkLix.close();
		},
	};
}

async function executeWithOptions(
	target: { execute(sql: string, params?: SqlParam[]): Promise<ExecuteResult> },
	sql: string,
	params: ReadonlyArray<unknown>,
	options?: ExecuteOptions,
): Promise<ExecuteResult> {
	const execute = target.execute as (
		sql: string,
		params?: SqlParam[],
		options?: ExecuteOptions,
	) => Promise<ExecuteResult>;
	return await execute.call(target, sql, toSqlParams(params), options);
}

function emptyExecuteResult(): ExecuteResult {
	return { columns: [], rows: [], rowsAffected: 0, notices: [] };
}

function toSqlParams(params: ReadonlyArray<unknown> | undefined): SqlParam[] {
	return [...(params ?? [])] as SqlParam[];
}
