export type SerializedLixValue =
	| null
	| string
	| number
	| boolean
	| Uint8Array
	| SerializedLixValue[]
	| {
			kind: string;
			value: SerializedLixValue;
	  }
	| Record<string, unknown>;

export type SerializedQueryResult = {
	rows: SerializedLixValue[][];
	columns: string[];
	rowsAffected?: number;
	notices?: Array<{
		code: string;
		message: string;
		hint?: string;
	}>;
};

export type DesktopExecuteOptions = {
	writerKey?: string | null;
};

export type DesktopObserveQuery = {
	sql: string;
	params?: ReadonlyArray<unknown>;
};

export type DesktopCreateBranchOptions = {
	id?: string;
	name: string;
	fromCommitId?: string;
};

export type DesktopCreateBranchResult = {
	id: string;
	name: string;
	hidden: boolean;
	commitId: string;
};

export type DesktopSwitchBranchResult = {
	branchId: string;
};

export type DesktopObserveEvent = {
	sequence: number;
	rows: SerializedQueryResult;
};

export type DesktopLixApi = {
	open(): Promise<void>;
	workspaceDir(): Promise<string>;
	execute(payload: {
		sql: string;
		params?: ReadonlyArray<unknown>;
		options?: DesktopExecuteOptions;
	}): Promise<SerializedQueryResult>;
	executeTransaction(payload: {
		statements: ReadonlyArray<{
			sql: string;
			params?: ReadonlyArray<unknown>;
		}>;
		options?: DesktopExecuteOptions;
	}): Promise<SerializedQueryResult>;
	transactionBegin(payload?: {
		options?: DesktopExecuteOptions;
	}): Promise<{ transactionId: string }>;
	transactionExecute(payload: {
		transactionId: string;
		sql: string;
		params?: ReadonlyArray<unknown>;
	}): Promise<SerializedQueryResult>;
	transactionCommit(payload: { transactionId: string }): Promise<void>;
	transactionRollback(payload: { transactionId: string }): Promise<void>;
	observeStart(payload: { query: DesktopObserveQuery }): Promise<string>;
	observeNext(payload: {
		observeId: string;
	}): Promise<DesktopObserveEvent | undefined>;
	observeClose(payload: { observeId: string }): Promise<void>;
	activeBranchId(): Promise<string>;
	createBranch(payload: {
		options: DesktopCreateBranchOptions;
	}): Promise<DesktopCreateBranchResult>;
	switchBranch(payload: {
		branchId: string;
	}): Promise<DesktopSwitchBranchResult>;
	exportSnapshot(): Promise<Uint8Array>;
	close(): Promise<void>;
};

export type DesktopTerminalCreatePayload = {
	cwd: string;
	shell?: string;
	cols?: number;
	rows?: number;
};

export type DesktopTerminalCreateResult = {
	id: string;
};

export type DesktopTerminalDataEvent = {
	id: string;
	data: string;
};

export type DesktopTerminalExitEvent = {
	id: string;
	exitCode: number | null;
	signal: number | null;
};

export type DesktopTerminalApi = {
	create(
		payload: DesktopTerminalCreatePayload,
	): Promise<DesktopTerminalCreateResult>;
	write(payload: { id: string; data: string }): Promise<void>;
	resize(payload: { id: string; cols: number; rows: number }): Promise<void>;
	kill(payload: { id: string }): Promise<void>;
	onData(listener: (event: DesktopTerminalDataEvent) => void): () => void;
	onExit(listener: (event: DesktopTerminalExitEvent) => void): () => void;
};

declare global {
	interface Window {
		flashtypeDesktop?: {
			platform: string;
			lix: DesktopLixApi;
			terminal: DesktopTerminalApi;
		};
	}
}
