import { resolve } from "node:path";
import markdownBlockSchema from "../../submodule/lix/plugins/markdown/schema/markdown_block.json";
import markdownDocumentSchema from "../../submodule/lix/plugins/markdown/schema/markdown_document.json";

type RawNativeValue =
	| { kind: "null"; value: null }
	| { kind: "boolean"; value: boolean }
	| { kind: "integer"; value: number }
	| { kind: "real"; value: number }
	| { kind: "text"; value: string }
	| { kind: "json"; value: unknown }
	| { kind: "blob"; value?: null | Uint8Array; blob?: Uint8Array };

type RawNativeResult = {
	columns: string[];
	rows: RawNativeValue[][];
	rowsAffected: number;
	notices: Array<{ code: string; message: string; hint?: string }>;
};

type RawNativeLix = {
	execute(sql: string, params: RawNativeValue[]): RawNativeResult;
	beginTransaction(): RawNativeTransaction;
	activeBranchId(): string;
	createBranch(options: { id?: string; name: string }): {
		id: string;
		name: string;
		hidden: boolean;
		commitId: string;
	};
	switchBranch(options: { branchId: string }): { branchId: string };
	close(): void;
};

type RawNativeTransaction = {
	execute(sql: string, params: RawNativeValue[]): RawNativeResult;
	commit(): void;
	rollback(): void;
};

type NativeExecuteResult = {
	columns: string[];
	rows: CompatRow[];
	rowsAffected: number;
	notices: Array<{ code: string; message: string; hint?: string }>;
};

type NativeLix = ReturnType<typeof createNativeLixAdapter>;

type ExecuteOptions = {
	writerKey?: string | null;
};

type TransactionStatement = {
	sql: string;
	params?: ReadonlyArray<unknown>;
};

type ObserveQuery = {
	sql: string;
	params?: ReadonlyArray<unknown>;
};

type ObserveEvent = {
	sequence: number;
	rows: unknown[][];
	columns: string[];
};

type ObserveEvents = {
	next(): Promise<ObserveEvent | undefined>;
	close(): void;
};

type OpenLixKeyValueEntry = {
	key: string;
	value: unknown;
	lixcol_untracked?: boolean;
} & (
	| {
			lixcol_branch_id: string;
			lixcol_global: boolean;
	  }
	| {
			lixcol_branch_id?: undefined;
			lixcol_global?: boolean;
	  }
);

type OpenLixOptions = {
	backend?: SqliteBackend;
	keyValues?: ReadonlyArray<OpenLixKeyValueEntry>;
};

const nativeAddonPath = resolve(
	process.cwd(),
	"submodule/lix/packages/js-sdk/lix_js_sdk.node",
);
const nativeModule = { exports: {} as { Lix: any } };
process.dlopen(nativeModule as any, nativeAddonPath);
const addon = nativeModule.exports;

export class SqliteBackend {
	readonly path: string;

	constructor(options: { path: string }) {
		if (!options || typeof options.path !== "string" || options.path === "") {
			throw new TypeError("SqliteBackend requires a non-empty path");
		}
		this.path = options.path;
	}
}

export async function openLix(options: OpenLixOptions = {}) {
	const raw =
		options?.backend instanceof SqliteBackend
			? addon.Lix.openSqlite(options.backend.path)
			: addon.Lix.openMemory();
	const lix = createTestLixAdapter(createNativeLixAdapter(raw));
	if (Array.isArray(options?.keyValues)) {
		for (const entry of options.keyValues) {
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
	return lix;
}

function createNativeLixAdapter(raw: RawNativeLix) {
	return {
		async execute(sql: string, params: ReadonlyArray<unknown> = []) {
			return wrapNativeResult(
				raw.execute(
					sql,
					params.map((param, index) => toNativeParam(param, index)),
				),
			);
		},
		async beginTransaction() {
			const tx = raw.beginTransaction();
			return {
				async execute(sql: string, params: ReadonlyArray<unknown> = []) {
					return wrapNativeResult(
						tx.execute(
							sql,
							params.map((param, index) => toNativeParam(param, index)),
						),
					);
				},
				async commit() {
					tx.commit();
				},
				async rollback() {
					tx.rollback();
				},
			};
		},
		async activeBranchId() {
			return raw.activeBranchId();
		},
		async createBranch(options: { id?: string; name: string }) {
			return raw.createBranch(options);
		},
		async switchBranch(options: { branchId: string }) {
			return raw.switchBranch(options);
		},
		async close() {
			raw.close();
		},
	};
}

class CompatRow {
	constructor(
		private readonly columns: string[],
		private readonly values: unknown[],
	) {}

	get(column: string): unknown {
		return this.values[this.columns.indexOf(column)];
	}

	toObject(): Record<string, unknown> {
		return Object.fromEntries(
			this.columns.map((column, index) => [column, this.values[index]]),
		);
	}
}

function wrapNativeResult(result: RawNativeResult): NativeExecuteResult {
	return {
		columns: result.columns,
		rows: result.rows.map(
			(row) => new CompatRow(result.columns, row.map(fromNativeValue)),
		),
		rowsAffected: result.rowsAffected,
		notices: result.notices,
	};
}

function toNativeParam(value: unknown, index: number): RawNativeValue {
	if (value === null) return { kind: "null", value: null };
	if (typeof value === "boolean") return { kind: "boolean", value };
	if (typeof value === "string") return { kind: "text", value };
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError(`SQL parameter ${index + 1} must be finite`);
		}
		return Number.isSafeInteger(value)
			? { kind: "integer", value }
			: { kind: "real", value };
	}
	if (value instanceof Uint8Array) {
		return { kind: "blob", value: null, blob: new Uint8Array(value) };
	}
	if (typeof value === "object" && value) {
		return { kind: "json", value };
	}
	throw new TypeError(
		`Unsupported SQL parameter ${index + 1}: ${typeof value}`,
	);
}

function fromNativeValue(value: RawNativeValue): unknown {
	if (value.kind === "blob") {
		return new Uint8Array(value.blob ?? value.value ?? []);
	}
	return value.value;
}

function createTestLixAdapter(nativeLix: NativeLix) {
	return {
		async execute(
			sql: string,
			params: ReadonlyArray<unknown> = [],
			_options?: ExecuteOptions,
		) {
			return await nativeLix.execute(sql, [...params]);
		},
		async beginTransaction() {
			const transaction = await nativeLix.beginTransaction();
			return {
				async execute(sql: string, params: ReadonlyArray<unknown> = []) {
					return await transaction.execute(sql, [...params]);
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
			first:
				| ExecuteOptions
				| ((
						tx: Awaited<ReturnType<NativeLix["beginTransaction"]>>,
				  ) => Promise<T>),
			second?: (
				tx: Awaited<ReturnType<NativeLix["beginTransaction"]>>,
			) => Promise<T>,
		): Promise<T> {
			const callback = typeof first === "function" ? first : second;
			if (typeof callback !== "function") {
				throw new TypeError("transaction requires a callback");
			}
			const tx = await this.beginTransaction();
			try {
				const result = await callback(tx as any);
				await tx.commit();
				return result;
			} catch (error) {
				await tx.rollback();
				throw error;
			}
		},
		async executeTransaction(
			statements: ReadonlyArray<TransactionStatement>,
			_options?: ExecuteOptions,
		) {
			const transaction = await this.beginTransaction();
			let result: NativeExecuteResult = emptyExecuteResult();
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
		observe(query: ObserveQuery): ObserveEvents {
			return createPollingObserve(nativeLix, query);
		},
		async activeBranchId() {
			return await nativeLix.activeBranchId();
		},
		async createBranch(options: Parameters<NativeLix["createBranch"]>[0]) {
			return await nativeLix.createBranch(options);
		},
		async switchBranch(options: Parameters<NativeLix["switchBranch"]>[0]) {
			return await nativeLix.switchBranch(options);
		},
		async installPlugin() {
			await seedMarkdownSchemas(nativeLix);
		},
		async exportSnapshot() {
			return new Uint8Array();
		},
		async close() {
			await nativeLix.close();
		},
	};
}

async function seedMarkdownSchemas(nativeLix: NativeLix) {
	for (const schema of [markdownDocumentSchema, markdownBlockSchema]) {
		await nativeLix.execute(
			"INSERT INTO lix_registered_schema (value, lixcol_global, lixcol_untracked) VALUES (lix_json($1), true, false)",
			[JSON.stringify(schema)],
		);
	}
}

function emptyExecuteResult(): NativeExecuteResult {
	return { columns: [], rows: [], rowsAffected: 0, notices: [] } as any;
}

function createPollingObserve(
	nativeLix: NativeLix,
	query: ObserveQuery,
): ObserveEvents {
	let closed = false;
	let polling = false;
	let previousKey: string | undefined;
	const pending: Array<{
		resolve: (event: ObserveEvent | undefined) => void;
		reject: (error: unknown) => void;
	}> = [];

	const poll = async () => {
		if (closed || polling) return;
		polling = true;
		try {
			const result = await nativeLix.execute(query.sql, [
				...(query.params ?? []),
			]);
			const key = JSON.stringify(
				result.rows.map((row: { toObject(): Record<string, unknown> }) =>
					row.toObject(),
				),
			);
			if (previousKey !== undefined && key !== previousKey) {
				pending.shift()?.resolve({
					sequence: Date.now(),
					rows: result.rows.map((row) =>
						result.columns.map((column) => row.get(column)),
					),
					columns: result.columns,
				});
			}
			previousKey = key;
		} catch (error) {
			pending.shift()?.reject(error);
		} finally {
			polling = false;
		}
	};

	const timer = setInterval(() => {
		void poll();
	}, 500);
	void poll();

	return {
		next() {
			if (closed) return Promise.resolve(undefined);
			return new Promise((resolve, reject) => {
				pending.push({ resolve, reject });
			});
		},
		close() {
			closed = true;
			clearInterval(timer);
			while (pending.length > 0) {
				pending.shift()?.resolve(undefined);
			}
		},
	};
}
