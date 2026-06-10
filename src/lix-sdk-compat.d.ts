import "@lix-js/sdk";

declare module "@lix-js/sdk" {
	export type ExecuteOptions = {
		writerKey?: string | null;
	};

	export type LixRuntimeQueryResult = {
		rows: any;
		columns: string[];
		rowsAffected: number;
		notices: Array<{
			code: string;
			message: string;
			hint?: string;
		}>;
	};

	export type TransactionStatement = {
		sql: string;
		params?: ReadonlyArray<unknown>;
	};

	export type SqlTransaction = {
		execute(
			sql: string,
			params?: ReadonlyArray<unknown>,
		): Promise<LixRuntimeQueryResult>;
		commit(): Promise<void>;
		rollback(): Promise<void>;
	};

	export type ObserveQuery = {
		sql: string;
		params?: ReadonlyArray<unknown>;
	};

	export type ObserveEvent = {
		sequence: number;
		stateCommitSequence?: number | null;
		rows: any;
		columns?: string[];
	};

	export type ObserveEvents = {
		next(): Promise<ObserveEvent | undefined>;
		close(): void;
	};

	export type InstallPluginOptions = {
		archiveBytes: Uint8Array | ArrayBuffer;
	};

	export interface Lix {
		execute(
			sql: string,
			params?: ReadonlyArray<unknown>,
			options?: ExecuteOptions,
		): Promise<LixRuntimeQueryResult>;
		beginTransaction(options?: ExecuteOptions): Promise<SqlTransaction>;
		transaction<T>(
			options: ExecuteOptions,
			callback: (tx: SqlTransaction) => Promise<T>,
		): Promise<T>;
		transaction<T>(callback: (tx: SqlTransaction) => Promise<T>): Promise<T>;
		executeTransaction(
			statements: ReadonlyArray<TransactionStatement>,
			options?: ExecuteOptions,
		): Promise<LixRuntimeQueryResult>;
		observe(query: ObserveQuery): ObserveEvents;
		installPlugin(options: InstallPluginOptions): Promise<void>;
		exportSnapshot(): Promise<Uint8Array>;
		close(): Promise<void>;
	}

	export function openLix(
		options?: OpenLixOptions & {
			keyValues?: ReadonlyArray<
				{
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
				)
			>;
		},
	): Promise<Lix>;
}
