import { createRequire } from "node:module";
import { resolve } from "node:path";
import type {
	BundledPluginArchive,
	ExecuteResult,
	Lix as SdkLix,
	OpenLixOptions as SdkOpenLixOptions,
	SqlParam,
} from "../../submodule/lix/packages/js-sdk/dist/index.js";
import type {
	Lix,
	ObserveEvents,
	OpenLixKeyValueEntry,
	SqlTransaction,
	TransactionStatement,
} from "@/lib/lix-types";

export type { Lix, SqlTransaction } from "@/lib/lix-types";
export type { BundledPluginArchive };

type OpenTestLixOptions = SdkOpenLixOptions & {
	keyValues?: ReadonlyArray<OpenLixKeyValueEntry>;
};

type SdkModule =
	typeof import("../../submodule/lix/packages/js-sdk/dist/index.js");

let sdkModulePromise: Promise<SdkModule> | undefined;
const require = createRequire(import.meta.url);

export async function openLix(options: OpenTestLixOptions = {}): Promise<Lix> {
	const { keyValues, ...sdkOptions } = options;
	const sdk = await loadSdk();
	const sdkLix = await sdk.openLix(sdkOptions);
	const lix = createTestLixAdapter(sdkLix);
	if (Array.isArray(keyValues)) {
		await seedKeyValues(lix, keyValues);
	}
	return lix;
}

export async function bundledPluginArchives(): Promise<BundledPluginArchive[]> {
	const sdk = await loadSdk();
	return await sdk.bundledPluginArchives();
}

async function loadSdk(): Promise<SdkModule> {
	if (!sdkModulePromise) {
		const sdkPath = resolve(
			process.cwd(),
			"submodule/lix/packages/js-sdk/dist/index.js",
		);
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
		if (typeof entry.lixcol_branch_id === "string") {
			if (typeof entry.lixcol_global !== "boolean") {
				throw new TypeError(
					"branch-scoped keyValues entries require lixcol_global",
				);
			}
			await lix.execute(
				"INSERT INTO lix_key_value_by_branch (key, value, lixcol_branch_id, lixcol_global, lixcol_untracked) VALUES ($1, $2, $3, $4, $5)",
				[
					entry.key,
					entry.value,
					entry.lixcol_branch_id,
					entry.lixcol_global,
					entry.lixcol_untracked ?? true,
				],
			);
			continue;
		}
		await lix.execute(
			"INSERT INTO lix_key_value (key, value, lixcol_global, lixcol_untracked) VALUES ($1, $2, true, true)",
			[entry.key, entry.value],
		);
	}
}

function createTestLixAdapter(sdkLix: SdkLix): Lix {
	return {
		async execute(sql: string, params: ReadonlyArray<unknown> = []) {
			return await sdkLix.execute(sql, toSqlParams(params));
		},
		async beginTransaction() {
			const transaction = await sdkLix.beginTransaction();
			return {
				async execute(sql: string, params: ReadonlyArray<unknown> = []) {
					return await transaction.execute(sql, toSqlParams(params));
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
		observe(sql: string, params: ReadonlyArray<unknown> = []): ObserveEvents {
			return sdkLix.observe(sql, toSqlParams(params));
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
			await sdkLix.importFilesystemPaths(paths);
		},
		async mergeBranchPreview(options) {
			return await sdkLix.mergeBranchPreview(options);
		},
		async mergeBranch(options) {
			return await sdkLix.mergeBranch(options);
		},
		async close() {
			await sdkLix.close();
		},
	};
}

function emptyExecuteResult(): ExecuteResult {
	return { columns: [], rows: [], rowsAffected: 0, notices: [] };
}

function toSqlParams(params: ReadonlyArray<unknown> | undefined): SqlParam[] {
	return [...(params ?? [])] as SqlParam[];
}
