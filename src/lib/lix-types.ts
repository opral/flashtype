import type {
	CreateBranchOptions,
	CreateBranchReceipt,
	MergeBranchOptions,
	MergeBranchPreview,
	MergeBranchReceipt,
	OpenLixOptions as JsSdkOpenLixOptions,
	SwitchBranchOptions,
	SwitchBranchReceipt,
} from "@lix-js/sdk";

export type ExecuteOptions = {
	writerKey?: string | null;
};

export type LixRow =
	| ReadonlyArray<unknown>
	| {
			get(column: string): unknown;
			toObject?(): Record<string, unknown>;
	  }
	| Readonly<Record<string, unknown>>;

export type LixRuntimeQueryResult = {
	rows: ReadonlyArray<LixRow>;
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
	rows: ReadonlyArray<ReadonlyArray<unknown>>;
	columns?: string[];
};

export type ObserveEvents = {
	next(): Promise<ObserveEvent | undefined>;
	close(): void;
};

export type OpenLixKeyValueEntry = {
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

export type OpenLixOptions = JsSdkOpenLixOptions & {
	keyValues?: ReadonlyArray<OpenLixKeyValueEntry>;
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
	activeBranchId(): Promise<string>;
	createBranch(options: CreateBranchOptions): Promise<CreateBranchReceipt>;
	switchBranch(options: SwitchBranchOptions): Promise<SwitchBranchReceipt>;
	mergeBranchPreview?(options: MergeBranchOptions): Promise<MergeBranchPreview>;
	mergeBranch?(options: MergeBranchOptions): Promise<MergeBranchReceipt>;
	exportSnapshot(): Promise<Uint8Array>;
	close(): Promise<void>;
}
