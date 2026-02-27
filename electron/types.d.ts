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
};

export type DesktopExecuteOptions = {
	writerKey?: string | null;
};

export type DesktopObserveQuery = {
	sql: string;
	params?: ReadonlyArray<unknown>;
};

export type DesktopCreateVersionOptions = {
	id?: string;
	name?: string;
	inheritsFromVersionId?: string;
	hidden?: boolean;
};

export type DesktopCreateVersionResult = {
	id: string;
	name: string;
	inheritsFromVersionId: string;
};

export type DesktopCreateCheckpointResult = {
	id: string;
	changeSetId: string;
};

export type DesktopStateCommitStreamFilter = {
	schemaKeys?: string[];
	entityIds?: string[];
	fileIds?: string[];
	versionIds?: string[];
	writerKeys?: string[];
	excludeWriterKeys?: string[];
	includeUntracked?: boolean;
};

export type DesktopStateCommitStreamOperation = "Insert" | "Update" | "Delete";

export type DesktopStateCommitStreamChange = {
	operation: DesktopStateCommitStreamOperation;
	entityId: string;
	schemaKey: string;
	schemaVersion: string;
	fileId: string;
	versionId: string;
	pluginKey: string;
	snapshotContent: unknown | null;
	untracked: boolean;
	writerKey: string | null;
};

export type DesktopStateCommitStreamBatch = {
	sequence: number;
	changes: DesktopStateCommitStreamChange[];
};

export type DesktopObserveEvent = {
	sequence: number;
	rows: SerializedQueryResult;
	stateCommitSequence: number | null;
};

export type DesktopInstallPluginOptions = {
	archiveBytes: Uint8Array | ArrayBuffer;
};

export type DesktopLixApi = {
	open(): Promise<void>;
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
	observeStart(payload: { query: DesktopObserveQuery }): Promise<string>;
	observeNext(payload: {
		observeId: string;
	}): Promise<DesktopObserveEvent | undefined>;
	observeClose(payload: { observeId: string }): Promise<void>;
	stateCommitStreamOpen(payload: {
		filter?: DesktopStateCommitStreamFilter;
	}): Promise<string>;
	stateCommitStreamTryNext(payload: {
		streamId: string;
	}): Promise<DesktopStateCommitStreamBatch | undefined>;
	stateCommitStreamClose(payload: { streamId: string }): Promise<void>;
	createVersion(payload: {
		options?: DesktopCreateVersionOptions;
	}): Promise<DesktopCreateVersionResult>;
	switchVersion(payload: { versionId: string }): Promise<void>;
	createCheckpoint(): Promise<DesktopCreateCheckpointResult>;
	installPlugin(payload: DesktopInstallPluginOptions): Promise<void>;
	exportSnapshot(): Promise<Uint8Array>;
	close(): Promise<void>;
	wipe(): Promise<void>;
};

declare global {
	interface Window {
		flashtypeDesktop?: {
			platform: string;
			lix: DesktopLixApi;
		};
	}
}
