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
	mutationSequence: number;
	result: SerializedQueryResult;
};

export type DesktopLixApi = {
	open(): Promise<void>;
	workspaceDir(): Promise<string>;
	execute(payload: {
		sql: string;
		params?: ReadonlyArray<unknown>;
	}): Promise<SerializedQueryResult>;
	executeTransaction(payload: {
		statements: ReadonlyArray<{
			sql: string;
			params?: ReadonlyArray<unknown>;
		}>;
	}): Promise<SerializedQueryResult>;
	transactionBegin(): Promise<{ transactionId: string }>;
	transactionExecute(payload: {
		transactionId: string;
		sql: string;
		params?: ReadonlyArray<unknown>;
	}): Promise<SerializedQueryResult>;
	transactionCommit(payload: { transactionId: string }): Promise<void>;
	transactionRollback(payload: { transactionId: string }): Promise<void>;
	observeStart(payload: {
		sql: string;
		params?: ReadonlyArray<unknown>;
	}): Promise<string>;
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

export type DesktopWorkspace = {
	kind: "directory" | "ephemeralFiles";
	path: string;
	name: string;
	sourceFilePath?: string;
};

export type DesktopWorkspaceApi = {
	get(): Promise<DesktopWorkspace | null>;
	consumePendingOpenFile(): Promise<string | null>;
	/**
	 * Opens a workspace. With a path (e.g. from a dropped folder) it adopts it
	 * directly; without one it shows the native directory picker. Resolves to
	 * null when the picker is canceled.
	 */
	open(payload?: { path: string }): Promise<DesktopWorkspace | null>;
	/**
	 * Opens a workspace in a new window. Without a path it shows the native
	 * directory picker. Resolves to null when the picker is canceled.
	 */
	openInNewWindow(payload?: { path: string }): Promise<DesktopWorkspace | null>;
	exportLixFile(): Promise<Uint8Array>;
	resetLixRepository(): Promise<void>;
	getPathForFile(file: File): string;
};

export type DesktopUpdateCheckStatus =
	| "started"
	| "busy"
	| "disabled"
	| "error"
	| "installing"
	| "not-ready";

export type DesktopUpdateState = {
	checking: boolean;
	updateReady: boolean;
};

export type DesktopAppApi = {
	checkForUpdates(): Promise<{ status: DesktopUpdateCheckStatus }>;
	getUpdateState(): Promise<DesktopUpdateState>;
	installUpdate(): Promise<{ status: DesktopUpdateCheckStatus }>;
	onUpdateState(listener: (state: DesktopUpdateState) => void): () => void;
};

declare global {
	interface Window {
		flashtypeDesktop?: {
			app: DesktopAppApi;
			platform: string;
			lix: DesktopLixApi;
			terminal: DesktopTerminalApi;
			workspace: DesktopWorkspaceApi;
		};
	}
}
