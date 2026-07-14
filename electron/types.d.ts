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
	open(): Promise<{ sessionId: string }>;
	workspaceDir(): Promise<string>;
	storageDir(): Promise<string>;
	execute(payload: {
		sql: string;
		params?: ReadonlyArray<unknown>;
		options?: { originKey?: string };
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
		options?: { originKey?: string };
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
	importFilesystemPaths(payload: { paths: readonly string[] }): Promise<void>;
	syncDiskToLix(): Promise<void>;
	close(payload?: { sessionId?: string }): Promise<void>;
};

export type DesktopTerminalCreatePayload = {
	cwd: string;
	shell?: string;
	cols?: number;
	rows?: number;
	env?: Record<string, string>;
	pathWrapper?: {
		executableName: "claude-flashtype" | "codex-flashtype";
		command: string;
	};
};

export type DesktopAgentExecutablePaths = {
	claude: string | null;
	codex: string | null;
};

export type DesktopAgentExecutablePathRefreshPayload = {
	cwd?: string;
	shell?: string;
	env?: Record<string, string>;
};

export type DesktopAgentName = "claude" | "codex";

export type DesktopAgentAuthStatus =
	| "unknown"
	| "notSignedIn"
	| "signedIn"
	| "free"
	| "paid";

export type DesktopAgentPreferenceReason =
	| "paid"
	| "free"
	| "signedIn"
	| "supportedVersion"
	| "installed"
	| "fallback";

export type DesktopAgentStatus = {
	authStatus: DesktopAgentAuthStatus;
	installed: boolean;
	supportedVersion: boolean;
	detectedVersion?: string;
};

export type DesktopAgentPreferencePayload =
	DesktopAgentExecutablePathRefreshPayload;

export type DesktopAgentPreferenceResult = {
	preferredAgent: DesktopAgentName;
	autoLaunchAgent: DesktopAgentName | null;
	versionBlockedAutoLaunchAgent: DesktopAgentName | null;
	reason: DesktopAgentPreferenceReason;
	agents: Record<DesktopAgentName, DesktopAgentStatus>;
};

export type DesktopGenerateCheckpointNamePayload = {
	cwd?: string;
	diffContext?: string;
	shell?: string;
	env?: Record<string, string>;
};

export type DesktopGenerateCheckpointNameResult = {
	name: string;
	source: "codex" | "claude" | "timestamp";
};

export type DesktopTerminalCreateResult =
	| {
			status: "created";
			id: string;
			pathWrapperExecutablePath?: string;
	  }
	| {
			status: "agentVersionError";
			agent: "claude" | "codex";
			requiredVersion: string;
			detectedVersion?: string;
			reason: "missing" | "unsupported" | "unparseable" | "failed" | "timeout";
			output?: string;
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
	generateCheckpointName(
		payload?: DesktopGenerateCheckpointNamePayload,
	): Promise<DesktopGenerateCheckpointNameResult>;
	getPreferredAgent(
		payload?: DesktopAgentPreferencePayload,
	): Promise<DesktopAgentPreferenceResult>;
	refreshAgentExecutablePaths(
		payload?: DesktopAgentExecutablePathRefreshPayload,
	): Promise<DesktopAgentExecutablePaths>;
	write(payload: { id: string; data: string }): Promise<void>;
	resize(payload: { id: string; cols: number; rows: number }): Promise<void>;
	kill(payload: { id: string }): Promise<void>;
	onData(listener: (event: DesktopTerminalDataEvent) => void): () => void;
	onExit(listener: (event: DesktopTerminalExitEvent) => void): () => void;
};

export type DesktopAgentTurnEvent = {
	id: string;
	instanceId?: string;
	agent: "claude" | "codex";
	phase: "turn-start" | "turn-stop";
	hookEventName?: string;
	sessionId?: string;
	turnId?: string;
	cwd?: string;
	createdAt: number;
};

export type DesktopAgentTurnFileCapturePayload = {
	captureId: string;
};

export type DesktopAgentTurnEventResult =
	| void
	| string
	| {
			additionalContext?: string | null;
	  };

export type DesktopAgentHooksApi = {
	onTurnEvent(
		listener: (
			event: DesktopAgentTurnEvent,
		) => DesktopAgentTurnEventResult | Promise<DesktopAgentTurnEventResult>,
	): () => void;
};

export type DesktopWorkspace =
	| {
			ephemeral: false;
			path: string;
			name: string;
			initialPanelMode?: "document";
			openFilePaths?: never;
	  }
	| {
			ephemeral: true;
			path: string;
			name: string;
			initialPanelMode?: "document";
			openFilePaths: string[];
	  };

export type DesktopWorkspaceRecovery = {
	kind: "track_changes";
	workspacePath: string;
	workspaceName: string;
	reason: string;
	createdAt: string;
	exitCode?: number;
	message?: string;
};

export type DesktopWorkspaceExtensionProfile = {
	file_extension: string;
	file_count: number;
	total_size_mb: number;
	median_file_size_kb: number;
};

export type DesktopWorkspaceProfile = {
	file_count: number;
	directory_count: number;
	extension_count: number;
	extension_counts: Record<string, number>;
	total_size_mb: number;
	extensions: DesktopWorkspaceExtensionProfile[];
};

export type DesktopMostRecentMarkdownFile = {
	path: string;
};

export type DesktopWatchedFilesystemEntry = {
	id: string;
	parent_id: string | null;
	path: string;
	display_name: string;
	kind: "directory" | "file";
	source: "watched";
};

export type DesktopWorkspaceApi = {
	get(): Promise<DesktopWorkspace | null>;
	getRecovery(): Promise<DesktopWorkspaceRecovery | null>;
	clearRecovery(): Promise<void>;
	/** Returns workspace-relative file paths queued for editor opening. */
	consumePendingOpenFiles(): Promise<string[]>;
	/** Persists the central documents that should reopen with this window. */
	setSessionOpenFilePaths(payload: { filePaths: string[] }): Promise<void>;
	beginAgentTurnFileCapture(
		payload: DesktopAgentTurnFileCapturePayload,
	): Promise<{ baselinePaths: string[] }>;
	finishAgentTurnFileCapture(
		payload: DesktopAgentTurnFileCapturePayload,
	): Promise<string[]>;
	setEphemeralWatchedDirectories(payload: {
		ownerId: string;
		paths: string[];
	}): Promise<DesktopWatchedFilesystemEntry[]>;
	onEphemeralWatchedFileTreeChanged(
		listener: (entries: DesktopWatchedFilesystemEntry[]) => void,
	): () => void;
	profile(): Promise<DesktopWorkspaceProfile | null>;
	getMostRecentMarkdownFile(): Promise<DesktopMostRecentMarkdownFile | null>;
	/** Fired when the native menu asks the workspace UI to start a new file. */
	onNewFile(listener: () => void): () => void;
	/** Fired when the native menu asks the workspace UI to close the active file. */
	onCloseFile(listener: () => void): () => void;
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
	disableTrackChanges(): Promise<DesktopWorkspace>;
	resolveMarkdownImageSrc(payload: {
		src: string;
		sourceFilePath: string;
		workspacePath: string;
	}): string;
	getPathForFile(file: File): string;
};

export type DesktopUpdateCheckStatus =
	| "started"
	| "busy"
	| "disabled"
	| "error"
	| "installing"
	| "not-ready"
	| "ready";

export type DesktopUpdateState = {
	checking: boolean;
	updateReady: boolean;
};

export type DesktopAppApi = {
	checkForUpdates(): Promise<{ status: DesktopUpdateCheckStatus }>;
	getUpdateState(): Promise<DesktopUpdateState>;
	installUpdate(): Promise<{ status: DesktopUpdateCheckStatus }>;
	openExternal(payload: { url: string }): Promise<{ status: "opened" }>;
	onUpdateState(listener: (state: DesktopUpdateState) => void): () => void;
};

export type DesktopTelemetryEventName =
	| "agent_opened"
	| "agent_start_failed"
	| "app_opened"
	| "diff_opened"
	| "diff_resolved"
	| "document_open_attempted"
	| "document_modified"
	| "document_viewed"
	| "prompt_submitted"
	| "workspace_recovery_lifecycle"
	| "workspace_extension_profiled"
	| "workspace_profiled";

export type DesktopTelemetryApi = {
	capture(payload: {
		event: DesktopTelemetryEventName;
		properties?: Record<
			string,
			string | number | boolean | Record<string, string | number> | undefined
		>;
	}): Promise<{
		status: "disabled" | "error" | "ignored" | "queued" | "throttled";
	}>;
	captureException(payload: {
		error: {
			message: string;
			name?: string;
			stack?: string;
		};
		properties?: Record<
			string,
			string | number | boolean | Record<string, string | number> | undefined
		>;
	}): Promise<{
		status: "disabled" | "error" | "ignored" | "queued" | "throttled";
	}>;
	getClientConfig(): Promise<
		| {
				enabled: false;
		  }
		| {
				enabled: true;
				token: string;
				host: string;
				distinctId: string;
				environment: "dev" | "production";
				sessionRecordingEnabled: boolean;
		  }
	>;
	setSessionContext(payload: {
		sessionId: string;
	}): Promise<{ status: "ignored" | "set" }>;
};

declare global {
	interface Window {
		flashtypeDesktop?: {
			agentHooks: DesktopAgentHooksApi;
			app: DesktopAppApi;
			platform: string;
			telemetry: DesktopTelemetryApi;
			lix: DesktopLixApi;
			terminal: DesktopTerminalApi;
			workspace: DesktopWorkspaceApi;
		};
	}
}
