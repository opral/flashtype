import type {
	StatementResult as ExecuteResult,
	Lix as SdkLix,
	ObserveEvent as SdkObserveEvent,
	OpenLixOptions as SdkOpenLixOptions,
} from "@lix-js/sdk";

export type { StatementResult as LixRuntimeQueryResult } from "@lix-js/sdk";
export type ExecuteOptions = { originKey?: string };
export type LixExecuteOptions = ExecuteOptions;

export type LixRow = ExecuteResult["rows"][number];

export type TransactionStatement = {
	sql: string;
	params?: ReadonlyArray<unknown>;
};

export type SqlTransaction = {
	commit(): Promise<void>;
	rollback(): Promise<void>;
	execute(
		sql: string,
		params?: ReadonlyArray<unknown>,
		options?: ExecuteOptions,
	): Promise<ExecuteResult>;
};

export type ObserveEvent = SdkObserveEvent;
export type ObserveEvents = ReturnType<SdkLix["observe"]>;

export type OpenLixKeyValueEntry = {
	key: string;
	value: unknown;
	lixcol_untracked?: boolean;
};

export type OpenLixOptions = SdkOpenLixOptions & {
	keyValues?: ReadonlyArray<OpenLixKeyValueEntry>;
};

type SdkLixBase = Pick<
	SdkLix,
	"activeBranchId" | "createBranch" | "switchBranch" | "close"
>;

export interface FlashtypeLix extends SdkLixBase {
	subscribeActiveBranch?(listener: () => void): () => void;
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
	observe(
		sql: string,
		params?: ReadonlyArray<unknown>,
		options?: Parameters<SdkLix["observe"]>[2],
	): ObserveEvents;
	importFilesystemPaths(paths: readonly string[]): Promise<void>;
	mergeBranchPreview?: SdkLix["mergeBranchPreview"];
	mergeBranch?: SdkLix["mergeBranch"];
	syncDiskToLix(): Promise<void>;
}

export type Lix = FlashtypeLix;
