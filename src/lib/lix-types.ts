import type {
	ExecuteResult,
	Lix as SdkLix,
	LixTransaction as SdkLixTransaction,
	OpenLixOptions as SdkOpenLixOptions,
} from "@lix-js/sdk";

export type { ExecuteResult as LixRuntimeQueryResult } from "@lix-js/sdk";
export type ExecuteOptions = { originKey?: string };
export type LixExecuteOptions = ExecuteOptions;

export type LixRow = ExecuteResult["rows"][number];

export type TransactionStatement = {
	sql: string;
	params?: ReadonlyArray<unknown>;
};

export type SqlTransaction = Pick<SdkLixTransaction, "commit" | "rollback"> & {
	execute(
		sql: string,
		params?: ReadonlyArray<unknown>,
		options?: ExecuteOptions,
	): Promise<ExecuteResult>;
};

export type ObserveEvent = {
	sequence: number;
	mutationSequence: number;
	result: ExecuteResult;
};

export type ObserveEvents = {
	/** First event is the current result snapshot; later events are changes. */
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

export type OpenLixOptions = SdkOpenLixOptions & {
	keyValues?: ReadonlyArray<OpenLixKeyValueEntry>;
};

type SdkLixBase = Pick<
	SdkLix,
	"activeBranchId" | "createBranch" | "switchBranch" | "close"
>;

export interface FlashtypeLix extends SdkLixBase {
	execute(
		sql: string,
		params?: ReadonlyArray<unknown>,
		options?: ExecuteOptions,
	): Promise<ExecuteResult>;
	beginTransaction(): Promise<SqlTransaction>;
	transaction<T>(callback: (tx: SqlTransaction) => Promise<T>): Promise<T>;
	executeTransaction(
		statements: ReadonlyArray<TransactionStatement>,
	): Promise<ExecuteResult>;
	observe(sql: string, params?: ReadonlyArray<unknown>): ObserveEvents;
	importFilesystemPaths(paths: readonly string[]): Promise<void>;
	mergeBranchPreview?: SdkLix["mergeBranchPreview"];
	mergeBranch?: SdkLix["mergeBranch"];
	syncDiskToLix(): Promise<void>;
}

export type Lix = FlashtypeLix;
