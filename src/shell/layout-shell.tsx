import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
} from "react";
import {
	Panel,
	PanelGroup,
	PanelResizeHandle,
	type ImperativePanelHandle,
} from "react-resizable-panels";
import {
	DndContext,
	DragOverlay,
	type DragEndEvent,
	type DragStartEvent,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { useLix } from "@/lib/lix-react";
import type { Lix } from "@/lib/lix-types";
import { useKeyValue } from "@/hooks/key-value/use-key-value";
import { SidePanel } from "./side-panel";
import { CentralPanel } from "./central-panel";
import { TopBar } from "./top-bar";
import { FlashtypeMenu } from "./top-bar/flashtype-menu";
import { StatusBar } from "./status-bar";
import type { ExternalWriteReview } from "@/extension-runtime/external-write-review";
import type {
	CheckpointDiff,
	CheckpointDiffBranchRow,
	CheckpointDiffVisibleFile,
	ShowCheckpointDiffArgs,
} from "@/extension-runtime/checkpoint-diff";
import {
	hasHistoricalEditorRevisionState,
	normalizeEditorRevisionState,
	stripEditorRevisionState,
} from "@/extension-runtime/editor-revision-state";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import { qb, sql } from "@/lib/lix-kysely";
import {
	captureTelemetry,
	fileExtensionProperty,
	normalizeTelemetryFileExtension,
	workspaceTelemetryProperties,
} from "@/lib/telemetry";
import { readWorkspaceId } from "@/lib/workspace-profile-telemetry";
import {
	ExtensionHostRegistryProvider,
	useExtensionHostRegistry,
} from "../extension-runtime/extension-host-registry";
import type {
	PanelSide,
	PanelState,
	ExtensionInstance,
	ExtensionKind,
	ExtensionLaunchArgs,
	ExtensionState,
	ExtensionDefinition,
	WorkspaceContext,
} from "../extension-runtime/types";
import {
	createExtensionInstanceId,
	ExtensionRegistryProvider,
	useExtensionRegistry,
} from "../extension-runtime/extension-registry";
import { loadInstalledExtensionsFromLix } from "../extension-runtime/installed-extension-loader";
import { PanelTabPreview } from "./panel-v2";
import {
	buildFileExtensionProps,
	fileExtensionInstanceForKind,
	FILE_EXTENSION_KIND,
	TERMINAL_EXTENSION_KIND,
	activeFileIdFromExtensionInstance,
} from "../extension-runtime/extension-instance-helpers";
import {
	fileExtensionFromPath,
	findFileHandlerExtension,
} from "../extension-runtime/file-handlers";
import {
	coerceFlashtypeUiState,
	DEFAULT_FLASHTYPE_UI_STATE,
	FLASHTYPE_UI_STATE_KEY,
	normalizeLayoutSizes,
	type PanelLayoutSizes,
	type FlashtypeUiState,
} from "./ui-state";
import {
	activatePanelExtension,
	upsertPendingExtension,
} from "../extension-runtime/pending-extension";
import {
	cloneExtensionInstance,
	reorderPanelExtensionsByIndex,
} from "./panel-utils";
import {
	buildAgentLaunchArgsWithActiveFile,
	buildFlashtypeActiveFilePrompt,
} from "./agent-launch";
import { agentLaunchPresetByKey, type AgentKey } from "./agent-icons";
import {
	clearAgentTurnCommitRangeFile,
	appendAgentTurnCommitRange,
	type AgentTurnCommitRange,
} from "./agent-turn-review-range";
import {
	getExternalWriteReview,
	getFileDataAtCommit,
	getPendingExternalWriteReviewPaths,
} from "./external-write-review-history";
import { resolveCheckpointDiff } from "./checkpoint-diff";

type NewFileDraftHandlerRegistration = {
	readonly panelSide: PanelSide;
	readonly viewInstance: string;
	readonly isActiveView: boolean;
	readonly handler: () => void;
};

type AgentHookTurnEvent = {
	readonly id: string;
	readonly instanceId?: string;
	readonly agent: "claude" | "codex";
	readonly phase: "turn-start" | "turn-stop";
	readonly hookEventName?: string;
	readonly sessionId?: string;
	readonly turnId?: string;
	readonly cwd?: string;
	readonly createdAt: number;
};

type ActiveAgentTurn = {
	readonly key: string;
	readonly event: AgentHookTurnEvent;
	readonly beforeCommitIdPromise: Promise<string | null>;
};

const LEGACY_CHECKPOINT_DIFF_INSTANCE_PREFIX = "checkpoint-diff:";
const LEGACY_CHECKPOINT_DIFF_REVIEW_ID_STATE_KEY = "checkpointDiffReviewId";
const LEGACY_CHECKPOINT_DIFF_BRANCH_ID_STATE_KEY = "checkpointDiffBranchId";

type AgentHookTurnEventResult = void | {
	readonly additionalContext?: string | null;
};

const stripLaunchArgs = (view: ExtensionInstance): ExtensionInstance => {
	const { launchArgs: _omitLaunch, ...rest } = view as any;
	const state = sanitizeExtensionStateForPersistence(rest.state);
	if (state === undefined) {
		const { state: _omitState, ...viewWithoutState } = rest;
		return viewWithoutState;
	}
	return { ...rest, state };
};

const sanitizeExtensionStateForPersistence = (
	state: ExtensionState | undefined,
): ExtensionState | undefined => {
	if (state === undefined) return undefined;
	const sanitized = sanitizeJsonValue(state);
	if (!isPlainObject(sanitized)) return undefined;
	return Object.keys(sanitized).length > 0
		? (sanitized as ExtensionState)
		: undefined;
};

const sanitizeJsonValue = (
	value: unknown,
	seen = new WeakSet<object>(),
): unknown => {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	if (Array.isArray(value)) {
		if (seen.has(value)) return undefined;
		seen.add(value);
		const sanitized = value.map((entry) => {
			const next = sanitizeJsonValue(entry, seen);
			return next === undefined ? null : next;
		});
		seen.delete(value);
		return sanitized;
	}
	if (isPlainObject(value)) {
		if (seen.has(value)) return undefined;
		seen.add(value);
		const entries = Object.entries(value)
			.map(([key, entry]) => [key, sanitizeJsonValue(entry, seen)] as const)
			.filter((entry): entry is readonly [string, unknown] => {
				return entry[1] !== undefined;
			});
		seen.delete(value);
		return Object.fromEntries(entries);
	}
	return undefined;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	if (!value || typeof value !== "object") return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

const activeEntryFromPanel = (panel: PanelState): ExtensionInstance | null => {
	const activeInstance =
		panel.activeInstance ?? panel.views[0]?.instance ?? null;
	if (!activeInstance) return null;
	return panel.views.find((entry) => entry.instance === activeInstance) ?? null;
};

const activeFilePathFromPanel = (panel: PanelState): string | null => {
	const rawPath = activeEntryFromPanel(panel)?.state?.filePath;
	return typeof rawPath === "string" && rawPath.length > 0 ? rawPath : null;
};

const isLegacyCheckpointDiffView = (view: ExtensionInstance): boolean => {
	return (
		view.instance.startsWith(LEGACY_CHECKPOINT_DIFF_INSTANCE_PREFIX) ||
		typeof view.state?.[LEGACY_CHECKPOINT_DIFF_REVIEW_ID_STATE_KEY] ===
			"string" ||
		typeof view.state?.[LEGACY_CHECKPOINT_DIFF_BRANCH_ID_STATE_KEY] === "string"
	);
};

const isDocumentView = (view: ExtensionInstance): boolean => {
	const fileId =
		typeof view.state?.fileId === "string" ? view.state.fileId : "";
	if (!fileId) return false;
	return view.instance === fileExtensionInstanceForKind(view.kind, fileId);
};

const canPlaceViewInPanel = (
	view: ExtensionInstance,
	side: PanelSide,
): boolean =>
	side === "central" ? isDocumentView(view) : !isDocumentView(view);

const activeEntryForDocumentSlot = (
	panel: PanelState,
): ExtensionInstance | null => {
	if (panel.activeInstance) {
		const active = panel.views.find(
			(entry) => entry.instance === panel.activeInstance,
		);
		if (active) return active;
	}
	return panel.views[0] ?? null;
};

const normalizePanelForDocumentSlot = (
	side: PanelSide,
	panel: PanelState,
): PanelState => {
	if (side === "central") {
		const activeEntry = activeEntryForDocumentSlot(panel);
		if (!activeEntry || !isDocumentView(activeEntry)) {
			return panel.views.length === 0 && panel.activeInstance === null
				? panel
				: { views: [], activeInstance: null };
		}
		if (
			panel.views.length === 1 &&
			panel.views[0] === activeEntry &&
			panel.activeInstance === activeEntry.instance
		) {
			return panel;
		}
		return {
			views: [activeEntry],
			activeInstance: activeEntry.instance,
		};
	}

	const views = panel.views.filter((view) => !isDocumentView(view));
	const activeInstance = views.some(
		(view) => view.instance === panel.activeInstance,
	)
		? panel.activeInstance
		: (views[views.length - 1]?.instance ?? null);
	if (
		views.length === panel.views.length &&
		activeInstance === panel.activeInstance
	) {
		return panel;
	}
	return { views, activeInstance };
};

const normalizePanelsForDocumentSlot = (
	panels: Record<PanelSide, PanelState>,
): Record<PanelSide, PanelState> => ({
	left: normalizePanelForDocumentSlot("left", panels.left),
	central: normalizePanelForDocumentSlot("central", panels.central),
	right: normalizePanelForDocumentSlot("right", panels.right),
});

const newFileDraftHandlerKey = (
	registration: NewFileDraftHandlerRegistration,
): string => `${registration.panelSide}:${registration.viewInstance}`;

const selectNewFileDraftHandler = (
	registrations: Iterable<NewFileDraftHandlerRegistration>,
	focusedPanel: PanelSide,
): NewFileDraftHandlerRegistration | null => {
	const panelPreference = [
		focusedPanel,
		"left" as const,
		"central" as const,
		"right" as const,
	].filter((side, index, sides) => sides.indexOf(side) === index);
	const registered = [...registrations].filter(
		(registration) => registration.isActiveView,
	);
	for (const panelSide of panelPreference) {
		const registration = registered.find(
			(candidate) => candidate.panelSide === panelSide,
		);
		if (registration) {
			return registration;
		}
	}
	return null;
};

const collectSessionOpenFilePaths = (
	panels: readonly PanelState[],
): string[] => {
	const seen = new Set<string>();
	const openFilePaths: string[] = [];
	for (const panel of panels) {
		for (const view of panel.views) {
			const filePath = sessionOpenFilePath(view.state?.filePath);
			if (!filePath || seen.has(filePath)) {
				continue;
			}
			seen.add(filePath);
			openFilePaths.push(filePath);
		}
	}
	return openFilePaths;
};

const sessionOpenFilePath = (filePath: unknown): string | null => {
	if (typeof filePath !== "string" || !isWorkspaceLixFilePath(filePath)) {
		return null;
	}
	return filePath.slice(1);
};

const isWorkspaceLixFilePath = (filePath: string): boolean => {
	if (!filePath.startsWith("/") || filePath.endsWith("/")) {
		return false;
	}
	const segments = filePath.slice(1).split("/");
	return (
		segments.length > 0 &&
		segments[0] !== ".lix" &&
		segments.every(
			(segment) => segment.length > 0 && segment !== "." && segment !== "..",
		)
	);
};

const sanitizePanels = (
	panels: Record<PanelSide, PanelState>,
): Record<PanelSide, PanelState> => {
	const sanitizePanel = (panel: PanelState): PanelState => {
		const views = panel.views
			.filter((view) => !isLegacyCheckpointDiffView(view))
			.map(stripLaunchArgs);
		const activeInstance = views.some(
			(view) => view.instance === panel.activeInstance,
		)
			? panel.activeInstance
			: (views[views.length - 1]?.instance ?? null);
		return { views, activeInstance };
	};
	return {
		...normalizePanelsForDocumentSlot({
			left: sanitizePanel(panels.left),
			central: sanitizePanel(panels.central),
			right: sanitizePanel(panels.right),
		}),
	};
};

const hydratePanel = (
	panel: PanelState,
	extensionMap: Map<ExtensionKind, ExtensionDefinition>,
	options: { preserveUnknownKinds?: boolean } = {},
): PanelState => {
	const views = panel.views
		// Drop unknown view keys that might linger in persisted UI state.
		.filter(
			(view) =>
				!isLegacyCheckpointDiffView(view) &&
				(options.preserveUnknownKinds || extensionMap.has(view.kind)),
		);
	if (views.length === 0) {
		return { views, activeInstance: null };
	}
	const fallbackActive = views[0]?.instance ?? null;
	const hasDesiredActive = panel.activeInstance
		? views.some((view) => view.instance === panel.activeInstance)
		: false;
	return {
		views,
		activeInstance: hasDesiredActive ? panel.activeInstance : fallbackActive,
	};
};

export const hydratePanelForExtensions = hydratePanel;

const hydratePanelForDocumentSlot = (
	side: PanelSide,
	panel: PanelState,
	extensionMap: Map<ExtensionKind, ExtensionDefinition>,
	options: { preserveUnknownKinds?: boolean } = {},
): PanelState =>
	normalizePanelForDocumentSlot(
		side,
		hydratePanel(panel, extensionMap, options),
	);

async function readCurrentLixFileIds(lix: Lix): Promise<ReadonlySet<string>> {
	const rows = await qb(lix).selectFrom("lix_file").select(["id"]).execute();
	return new Set(rows.map((row) => String(row.id)));
}

function transitionCheckpointEditorRevisionPanel(args: {
	readonly panel: PanelState;
	readonly previousDiff: CheckpointDiff | null;
	readonly nextDiff: CheckpointDiff | null;
	readonly currentFileIds: ReadonlySet<string>;
}): PanelState {
	const views: ExtensionInstance[] = [];
	let changed = false;
	for (const view of args.panel.views) {
		if (isLegacyCheckpointDiffView(view)) {
			changed = true;
			continue;
		}
		let nextView = view;
		if (isCheckpointEditorRevisionView(nextView, args.previousDiff)) {
			const fileId =
				typeof nextView.state?.fileId === "string"
					? nextView.state.fileId
					: null;
			if (!fileId || !args.currentFileIds.has(fileId)) {
				changed = true;
				continue;
			}
			changed = true;
			nextView = {
				...nextView,
				state: stripEditorRevisionState(nextView.state),
			};
		}
		const nextDiff = args.nextDiff;
		const nextDiffFile = checkpointDiffFileForView(nextView, nextDiff);
		if (nextDiff && nextDiffFile) {
			changed = true;
			nextView = {
				...nextView,
				state: {
					...(stripEditorRevisionState(nextView.state) ?? {}),
					beforeCommitId: nextDiff.beforeCommitId,
					afterCommitId: nextDiff.afterIsActiveHead
						? null
						: nextDiff.afterCommitId,
				},
			};
		}
		views.push(nextView);
	}
	if (!changed) return args.panel;
	const activeInstance = views.some(
		(view) => view.instance === args.panel.activeInstance,
	)
		? args.panel.activeInstance
		: (views[views.length - 1]?.instance ?? null);
	return { views, activeInstance };
}

function checkpointDiffFileForView(
	view: ExtensionInstance,
	checkpointDiff: CheckpointDiff | null,
): CheckpointDiffVisibleFile | null {
	if (!checkpointDiff) return null;
	const fileId =
		typeof view.state?.fileId === "string" ? view.state.fileId : "";
	return (
		checkpointDiffEditorFiles(checkpointDiff).find(
			(file) => file.fileId === fileId,
		) ?? null
	);
}

function isCheckpointEditorRevisionView(
	view: ExtensionInstance,
	checkpointDiff: CheckpointDiff | null,
): boolean {
	if (!checkpointDiff || !hasHistoricalEditorRevisionState(view.state)) {
		return false;
	}
	const fileId =
		typeof view.state?.fileId === "string" ? view.state.fileId : "";
	const revision = normalizeEditorRevisionState(view.state);
	const afterCommitId = checkpointDiff.afterIsActiveHead
		? null
		: checkpointDiff.afterCommitId;
	return (
		revision.beforeCommitId === checkpointDiff.beforeCommitId &&
		revision.afterCommitId === afterCommitId &&
		checkpointDiffEditorFiles(checkpointDiff).some(
			(file) => file.fileId === fileId,
		)
	);
}

function checkpointDiffEditorFiles(
	checkpointDiff: CheckpointDiff,
): readonly CheckpointDiffVisibleFile[] {
	return checkpointDiff.visibleFiles ?? checkpointDiff.files;
}

const DEFAULT_PANEL_FALLBACK_SIZES = {
	left: 20,
	central: 60,
	right: 20,
};
const MIN_UNCOLLAPSED_RIGHT_SIZE = 35;
const MIN_VISIBLE_PANEL_SIZE = 1;
const INSTALLED_EXTENSION_PATH_PREFIX = "/.lix/app_data/flashtype/extensions/";
const INSTALLED_EXTENSION_PATH_PREFIX_UPPER_BOUND =
	"/.lix/app_data/flashtype/extensions0";
const INSTALLED_EXTENSION_OBSERVE_SQL =
	"SELECT path, data FROM lix_file WHERE path >= ? AND path < ?";
const PANEL_TRANSITION_STYLE: CSSProperties = {
	transitionProperty: "flex-grow, flex-basis",
	transitionDuration: "200ms",
	transitionTimingFunction: "ease-in-out",
};

function deriveUntitledMarkdownPathForSuffix(suffix: number | null): string {
	const baseStem = "new-file";
	if (suffix === null) {
		return `/${baseStem}.md`;
	}
	return `/${baseStem}-${suffix}.md`;
}

/**
 * Resolves a unique root-level markdown path for a new untitled document.
 *
 * Uses targeted existence checks (`WHERE path = ?`) to avoid scanning all
 * file paths as repositories grow.
 */
async function resolveNextUntitledMarkdownPath(
	lix: ReturnType<typeof useLix>,
): Promise<string> {
	const primary = deriveUntitledMarkdownPathForSuffix(null);
	const primaryExists = await qb(lix)
		.selectFrom("lix_file")
		.where("path", "=", primary)
		.select("id")
		.executeTakeFirst();
	if (!primaryExists) {
		return primary;
	}
	for (let suffix = 2; suffix < 1000; suffix += 1) {
		const candidate = deriveUntitledMarkdownPathForSuffix(suffix);
		const exists = await qb(lix)
			.selectFrom("lix_file")
			.where("path", "=", candidate)
			.select("id")
			.executeTakeFirst();
		if (!exists) {
			return candidate;
		}
	}
	return `/new-file-${Date.now()}.md`;
}

export function V2LayoutShell({
	workspace,
	workspaceName,
	onOpenWorkspace,
	pendingOpenFilePaths,
	canPersistOpenFileSession = true,
	onPendingOpenFileHandled,
	onError,
	isUpdateReady,
	onInstallUpdate,
}: {
	readonly workspace?: WorkspaceContext;
	readonly workspaceName?: string;
	readonly onOpenWorkspace?: () => void;
	readonly pendingOpenFilePaths?: readonly string[];
	readonly canPersistOpenFileSession?: boolean;
	readonly onPendingOpenFileHandled?: (filePath: string) => void;
	readonly onError?: (error: unknown) => void;
	readonly isUpdateReady?: boolean;
	readonly onInstallUpdate?: () => void | Promise<void>;
}) {
	return (
		<ExtensionRegistryProvider>
			<ExtensionHostRegistryProvider>
				<LayoutShellContent
					workspace={workspace}
					workspaceName={workspaceName}
					onOpenWorkspace={onOpenWorkspace}
					pendingOpenFilePaths={pendingOpenFilePaths}
					canPersistOpenFileSession={canPersistOpenFileSession}
					onPendingOpenFileHandled={onPendingOpenFileHandled}
					onError={onError}
					isUpdateReady={isUpdateReady}
					onInstallUpdate={onInstallUpdate}
				/>
			</ExtensionHostRegistryProvider>
		</ExtensionRegistryProvider>
	);
}

type LayoutShellContentProps = {
	readonly workspace?: WorkspaceContext;
	readonly workspaceName?: string;
	readonly onOpenWorkspace?: () => void;
	readonly pendingOpenFilePaths?: readonly string[];
	readonly canPersistOpenFileSession?: boolean;
	readonly onPendingOpenFileHandled?: (filePath: string) => void;
	readonly onError?: (error: unknown) => void;
	readonly isUpdateReady?: boolean;
	readonly onInstallUpdate?: () => void | Promise<void>;
};

type LayoutShellLoadedContentProps = LayoutShellContentProps & {
	readonly lix: ReturnType<typeof useLix>;
	readonly uiStateKV: FlashtypeUiState | null;
	readonly setUiStateKV: (newValue: FlashtypeUiState) => Promise<void>;
	readonly activeFileId: string | null;
	readonly setActiveFileId: (newValue: string | null) => Promise<void>;
};

function fileBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

async function readSyncedActiveCommitId(lix: Lix): Promise<string | null> {
	await lix.syncDiskToLix();
	return readActiveBranchCommitId(lix);
}

async function readActiveBranchCommitId(lix: Lix): Promise<string | null> {
	const result = await lix.execute(
		"SELECT lix_active_branch_commit_id() AS commit_id",
	);
	const rows =
		result && typeof result === "object" && Array.isArray((result as any).rows)
			? ((result as any).rows as unknown[])
			: [];
	const value =
		rows.length > 0 ? readQueryRowValue(rows[0], "commit_id") : null;
	return typeof value === "string" && value.length > 0 ? value : null;
}

function readQueryRowValue(row: unknown, column: string): unknown {
	if (!row || typeof row !== "object") return undefined;
	if (typeof (row as { get?: unknown }).get === "function") {
		return (row as { get(column: string): unknown }).get(column);
	}
	if (typeof (row as { toObject?: unknown }).toObject === "function") {
		return (row as { toObject(): Record<string, unknown> }).toObject()[column];
	}
	return (row as Record<string, unknown>)[column];
}

function isAgentHookTurnEvent(value: unknown): value is AgentHookTurnEvent {
	if (!value || typeof value !== "object") return false;
	const event = value as Partial<AgentHookTurnEvent>;
	return (
		(event.agent === "claude" || event.agent === "codex") &&
		(event.phase === "turn-start" || event.phase === "turn-stop") &&
		typeof event.id === "string" &&
		event.id.length > 0 &&
		typeof event.createdAt === "number" &&
		Number.isFinite(event.createdAt)
	);
}

function agentTurnKey(event: AgentHookTurnEvent): string {
	return [
		event.instanceId ?? "unknown-instance",
		event.agent,
		event.sessionId ?? event.cwd ?? "unknown-session",
		event.turnId ?? "current-turn",
	].join(":");
}

function agentPromptAttemptKey(event: AgentHookTurnEvent): string {
	return [
		event.instanceId ?? "unknown-instance",
		event.agent,
		event.sessionId ?? event.cwd ?? "unknown-session",
	].join(":");
}

function incrementAgentPromptAttemptNumber(
	attempts: Map<string, number>,
	event: AgentHookTurnEvent,
): number {
	const key = agentPromptAttemptKey(event);
	const nextAttemptNumber = (attempts.get(key) ?? 0) + 1;
	attempts.set(key, nextAttemptNumber);
	return nextAttemptNumber;
}

type LixFileForOpen = {
	readonly id: string;
	readonly path: string;
};

function normalizeLixFileOpenPath(filePath: string): string | null {
	if (!filePath) return null;
	const rootedPath = filePath.startsWith("/") ? filePath : `/${filePath}`;
	const segments: string[] = [];
	for (const segment of rootedPath.split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			if (segments.length === 0) return null;
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	if (segments.length === 0) return null;
	return `/${segments.join("/")}`;
}

async function selectLixFileForOpen(
	lix: Lix,
	filePath: string,
): Promise<LixFileForOpen | null> {
	const row = await qb(lix)
		.selectFrom("lix_file")
		.select(["id", "path"])
		.where("path", "=", filePath)
		.executeTakeFirst();
	if (!row) return null;
	return { id: row.id as string, path: row.path as string };
}

export async function resolveLixFileForOpen({
	lix,
	workspace,
	filePath,
}: {
	readonly lix: Lix;
	readonly workspace?: WorkspaceContext;
	readonly filePath: string;
}): Promise<LixFileForOpen | null> {
	const normalizedPath = normalizeLixFileOpenPath(filePath);
	if (!normalizedPath) return null;

	const existingFile = await selectLixFileForOpen(lix, normalizedPath);
	if (existingFile) return existingFile;

	if (workspace?.ephemeral !== true) {
		return null;
	}

	await lix.importFilesystemPaths([normalizedPath]);

	return selectLixFileForOpen(lix, normalizedPath);
}

type CurrentCheckpointChangeState = {
	readonly branchId: string;
	readonly branches: readonly CheckpointDiffBranchRow[];
	readonly count: number | null;
};

type CurrentCheckpointBranchState = {
	readonly key: string;
	readonly branchId: string;
	readonly branches: readonly CheckpointDiffBranchRow[];
};

function useCurrentCheckpointChangeState(
	lix: Lix,
): CurrentCheckpointChangeState {
	const [branchState, setBranchState] =
		useState<CurrentCheckpointBranchState | null>(null);
	const [changedFileCount, setChangedFileCount] = useState<number | null>(null);

	useEffect(() => {
		let closed = false;
		let loadRunId = 0;
		const load = async () => {
			const runId = loadRunId + 1;
			loadRunId = runId;
			try {
				const [branches, branchId] = await Promise.all([
					loadVisibleCheckpointBranches(lix),
					loadActiveCheckpointBranchId(lix),
				]);
				if (closed || loadRunId !== runId) return;
				const nextState =
					branchId && branches.some((branch) => branch.id === branchId)
						? {
								key: checkpointDiffCacheKey(branches, branchId),
								branchId,
								branches,
							}
						: null;
				setBranchState((previous) =>
					previous?.key === nextState?.key ? previous : nextState,
				);
			} catch (error: unknown) {
				if (closed) return;
				console.warn("Failed to load checkpoint footer state", error);
				setBranchState(null);
			}
		};

		void load();

		const branchesQuery = visibleCheckpointBranchesQuery(lix).compile();
		const activeBranchQuery = activeCheckpointBranchQuery(lix).compile();
		const branchEvents = lix.observe(
			branchesQuery.sql,
			branchesQuery.parameters,
		);
		const activeBranchEvents = lix.observe(
			activeBranchQuery.sql,
			activeBranchQuery.parameters,
		);
		const observe = async (events: typeof branchEvents) => {
			try {
				while (!closed) {
					const event = await events.next();
					if (closed || !event) break;
					void load();
				}
			} catch (error: unknown) {
				if (!closed) {
					console.warn("Failed to observe checkpoint footer state", error);
				}
			}
		};

		void observe(branchEvents);
		void observe(activeBranchEvents);

		return () => {
			closed = true;
			branchEvents.close();
			activeBranchEvents.close();
		};
	}, [lix]);

	useEffect(() => {
		if (!branchState) {
			setChangedFileCount(0);
			return;
		}

		let closed = false;
		setChangedFileCount(null);
		void resolveCheckpointDiff({
			lix,
			branches: branchState.branches,
			branchId: branchState.branchId,
		})
			.then((diff) => {
				if (closed) return;
				setChangedFileCount(diff?.files.length ?? 0);
			})
			.catch((error: unknown) => {
				if (closed) return;
				console.warn("Failed to resolve checkpoint footer count", error);
				setChangedFileCount(0);
			});
		return () => {
			closed = true;
		};
	}, [branchState, lix]);

	return {
		branchId: branchState?.branchId ?? "",
		branches: branchState?.branches ?? [],
		count: branchState ? changedFileCount : null,
	};
}

function visibleCheckpointBranchesQuery(lix: Lix) {
	return qb(lix)
		.selectFrom("lix_branch")
		.select(["id", "name", "commit_id"])
		.where(
			() =>
				sql`COALESCE(CAST(lix_branch.hidden AS TEXT), 'false') NOT IN ('true', '1', 't')`,
		)
		.orderBy("name", "asc");
}

async function loadVisibleCheckpointBranches(
	lix: Lix,
): Promise<CheckpointDiffBranchRow[]> {
	return (await visibleCheckpointBranchesQuery(
		lix,
	).execute()) as CheckpointDiffBranchRow[];
}

function activeCheckpointBranchQuery(lix: Lix) {
	return qb(lix)
		.selectFrom("lix_key_value")
		.where("key", "=", "lix_workspace_branch_id")
		.select(["value"]);
}

async function loadActiveCheckpointBranchId(lix: Lix): Promise<string | null> {
	const row = await activeCheckpointBranchQuery(lix).executeTakeFirst();
	return typeof row?.value === "string" && row.value.length > 0
		? row.value
		: null;
}

function checkpointDiffCacheKey(
	branches: readonly CheckpointDiffBranchRow[],
	branchId: string,
): string {
	return [
		branchId,
		...branches.map((branch) =>
			[branch.id, branch.name, branch.commit_id ?? ""].join(":"),
		),
	].join("|");
}

function formatChangedFileCount(count: number): string {
	return `${count} ${count === 1 ? "file" : "files"} changed since last checkpoint`;
}

function CurrentCheckpointFooterReviewButton({
	lix,
	checkpointDiff,
	showCheckpointDiff,
	clearCheckpointDiff,
}: {
	readonly lix: Lix;
	readonly checkpointDiff: CheckpointDiff | null;
	readonly showCheckpointDiff: (
		args: ShowCheckpointDiffArgs,
	) => Promise<CheckpointDiff | null>;
	readonly clearCheckpointDiff: () => void;
}) {
	const currentCheckpointChange = useCurrentCheckpointChangeState(lix);
	if (currentCheckpointChange.count === null) return null;
	const status = formatChangedFileCount(currentCheckpointChange.count);
	const isReviewingCurrentCheckpoint =
		checkpointDiff?.branchId === currentCheckpointChange.branchId;

	return (
		<button
			type="button"
			className="min-w-0 cursor-pointer truncate rounded-[5px] border-0 bg-transparent px-1 py-0.5 text-left font-[inherit] text-inherit hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
			data-attr="checkpoint-footer-review"
			aria-pressed={isReviewingCurrentCheckpoint}
			onClick={() => {
				if (isReviewingCurrentCheckpoint) {
					clearCheckpointDiff();
					return;
				}
				void showCheckpointDiff({
					branchId: currentCheckpointChange.branchId,
					branches: currentCheckpointChange.branches,
				});
			}}
		>
			{status}
		</button>
	);
}

function documentOpenAttemptTelemetryProperties({
	filePath,
	handler,
}: {
	readonly filePath: string;
	readonly handler: ExtensionDefinition | undefined;
}) {
	const fileExtension = fileExtensionFromPath(filePath);
	if (handler) {
		return {
			document_open_result: "viewed",
			file_extension: fileExtensionProperty(filePath),
		};
	}
	return {
		document_open_result: "unsupported",
		file_extension: fileExtension
			? normalizeTelemetryFileExtension(fileExtension)
			: "(none)",
		unsupported_reason: fileExtension ? "no_renderer" : "no_extension",
	};
}

function isPanelShortcutBlockedTarget(target: EventTarget | null): boolean {
	if (!target || !(target instanceof HTMLElement)) {
		return false;
	}
	if (target.closest(".ProseMirror")) {
		return false;
	}
	if (target.isContentEditable) return true;
	const tagName = target.tagName;
	if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
		return true;
	}
	return Boolean(target.closest("input, textarea, select, [contenteditable]"));
}

/**
 * App layout shell with independent left and right islands.
 *
 * @example
 * <V2LayoutShell />
 */
function LayoutShellContent({
	workspace,
	workspaceName,
	onOpenWorkspace,
	pendingOpenFilePaths,
	canPersistOpenFileSession,
	onPendingOpenFileHandled,
	onError,
	isUpdateReady,
	onInstallUpdate,
}: LayoutShellContentProps) {
	const lix = useLix();
	return (
		<LayoutShellUiStateLoader
			workspaceName={workspaceName}
			workspace={workspace}
			onOpenWorkspace={onOpenWorkspace}
			pendingOpenFilePaths={pendingOpenFilePaths}
			canPersistOpenFileSession={canPersistOpenFileSession}
			onPendingOpenFileHandled={onPendingOpenFileHandled}
			onError={onError}
			isUpdateReady={isUpdateReady}
			onInstallUpdate={onInstallUpdate}
			lix={lix}
		/>
	);
}

function LayoutShellUiStateLoader(
	props: LayoutShellContentProps & {
		readonly lix: ReturnType<typeof useLix>;
	},
) {
	const [uiStateKV, setUiStateKV] = useKeyValue(FLASHTYPE_UI_STATE_KEY);
	return (
		<LayoutShellActiveFileLoader
			{...props}
			uiStateKV={uiStateKV}
			setUiStateKV={setUiStateKV}
		/>
	);
}

function LayoutShellActiveFileLoader(
	props: LayoutShellContentProps & {
		readonly lix: ReturnType<typeof useLix>;
		readonly uiStateKV: FlashtypeUiState | null;
		readonly setUiStateKV: (newValue: FlashtypeUiState) => Promise<void>;
	},
) {
	const [activeFileId, setActiveFileId] = useKeyValue(
		"flashtype_active_file_id",
	);
	return (
		<LayoutShellLoadedContent
			{...props}
			activeFileId={activeFileId}
			setActiveFileId={setActiveFileId}
		/>
	);
}

function LayoutShellLoadedContent({
	workspace,
	workspaceName,
	onOpenWorkspace,
	pendingOpenFilePaths,
	canPersistOpenFileSession,
	onPendingOpenFileHandled,
	onError,
	isUpdateReady,
	onInstallUpdate,
	lix,
	uiStateKV,
	setUiStateKV,
	activeFileId,
	setActiveFileId,
}: LayoutShellLoadedContentProps) {
	const [hasLoadedInstalledExtensions, setHasLoadedInstalledExtensions] =
		useState(false);
	const { extensionMap, replaceInstalledExtensions, clearInstalledExtensions } =
		useExtensionRegistry();
	const uiState = useMemo(
		() => coerceFlashtypeUiState(uiStateKV ?? DEFAULT_FLASHTYPE_UI_STATE),
		[uiStateKV],
	);

	const initialLayoutSizes = normalizeLayoutSizes(uiState.layout?.sizes);
	const sanitizedPersistedPanels = useMemo(() => {
		return sanitizePanels(uiState.panels);
	}, [uiState]);

	const [leftPanel, setLeftPanel] = useState<PanelState>(() =>
		hydratePanelForDocumentSlot(
			"left",
			sanitizedPersistedPanels.left,
			extensionMap,
			{
				preserveUnknownKinds: true,
			},
		),
	);
	const [centralPanel, setCentralPanel] = useState<PanelState>(() =>
		hydratePanelForDocumentSlot(
			"central",
			sanitizedPersistedPanels.central,
			extensionMap,
			{
				preserveUnknownKinds: true,
			},
		),
	);
	const [rightPanel, setRightPanel] = useState<PanelState>(() =>
		hydratePanelForDocumentSlot(
			"right",
			sanitizedPersistedPanels.right,
			extensionMap,
			{
				preserveUnknownKinds: true,
			},
		),
	);
	const [focusedPanel, setFocusedPanel] = useState<PanelSide>(
		() => uiState.focusedPanel,
	);
	const [panelSizes, setPanelSizes] = useState<PanelLayoutSizes>(
		() => initialLayoutSizes,
	);
	const [isLeftCollapsed, setIsLeftCollapsed] = useState(
		() => initialLayoutSizes.left <= MIN_VISIBLE_PANEL_SIZE,
	);
	const [isRightCollapsed, setIsRightCollapsed] = useState(
		() => initialLayoutSizes.right <= MIN_VISIBLE_PANEL_SIZE,
	);
	const [shouldAnimatePanels, setShouldAnimatePanels] = useState(false);
	const [preferredAgent, setPreferredAgent] = useState<AgentKey | null>(null);
	const [checkpointDiff, setCheckpointDiff] = useState<CheckpointDiff | null>(
		null,
	);
	const checkpointDiffRef = useRef<CheckpointDiff | null>(null);
	const animationTimeoutRef = useRef<number | null>(null);
	const newFileDraftHandlersRef = useRef(
		new Map<string, NewFileDraftHandlerRegistration>(),
	);
	const lastNonZeroSizesRef = useRef({
		left:
			initialLayoutSizes.left > MIN_VISIBLE_PANEL_SIZE
				? initialLayoutSizes.left
				: DEFAULT_PANEL_FALLBACK_SIZES.left,
		right:
			initialLayoutSizes.right > MIN_VISIBLE_PANEL_SIZE
				? initialLayoutSizes.right
				: DEFAULT_PANEL_FALLBACK_SIZES.right,
	});
	const leftPanelRef = useRef<ImperativePanelHandle | null>(null);
	const rightPanelRef = useRef<ImperativePanelHandle | null>(null);
	const diffOpenedReviewIdsRef = useRef(new Set<string>());
	const diffResolvedReviewIdsRef = useRef(new Set<string>());
	const openDiffReviewByFileIdRef = useRef(
		new Map<string, ExternalWriteReview>(),
	);
	const resolveDiffReviewTelemetryRef = useRef<
		| ((
				review: ExternalWriteReview,
				outcome: "accepted" | "abandoned" | "rejected",
		  ) => boolean)
		| null
	>(null);
	const activeAgentTurnsRef = useRef(new Map<string, ActiveAgentTurn>());
	const agentPromptAttemptNumbersRef = useRef(new Map<string, number>());
	const autoOpenFirstAgentReviewFileRef = useRef(
		async (_range: AgentTurnCommitRange) => {},
	);
	const agentPreferenceAttemptedRef = useRef(false);
	const agentPreferenceRunRef = useRef(0);
	const fileOpenInterruptRevisionRef = useRef(0);
	const workspaceIdRef = useRef<string | undefined>(undefined);
	const mostRecentMarkdownFallbackAttemptedRef = useRef(false);
	const panelStatesRef = useRef({
		left: leftPanel,
		central: centralPanel,
		right: rightPanel,
	});
	const viewHostRegistry = useExtensionHostRegistry();
	const mostRecentMarkdownFallbackWorkspaceKey = useMemo(() => {
		if (!workspace) return "none";
		return `${workspace.ephemeral ? "ephemeral" : "persistent"}:${workspace.path}`;
	}, [workspace]);

	const captureWorkspaceTelemetry = useCallback(
		(
			event: Parameters<typeof captureTelemetry>[0],
			properties: Parameters<typeof captureTelemetry>[1] = {},
		) => {
			void (async () => {
				const workspaceId =
					workspaceIdRef.current ?? (await readWorkspaceId(lix));
				workspaceIdRef.current = workspaceId;
				captureTelemetry(event, {
					...properties,
					...workspaceTelemetryProperties(workspaceId),
				});
			})().catch((error: unknown) => {
				console.warn("Failed to capture workspace telemetry", error);
			});
		},
		[lix],
	);

	useEffect(() => {
		workspaceIdRef.current = undefined;
	}, [lix]);

	useEffect(() => {
		mostRecentMarkdownFallbackAttemptedRef.current = false;
	}, [lix, mostRecentMarkdownFallbackWorkspaceKey]);

	useEffect(() => {
		agentPreferenceAttemptedRef.current = false;
		agentPreferenceRunRef.current += 1;
		setPreferredAgent(null);
	}, [lix, mostRecentMarkdownFallbackWorkspaceKey]);

	useEffect(() => {
		panelStatesRef.current = {
			left: leftPanel,
			central: centralPanel,
			right: rightPanel,
		};
	}, [leftPanel, centralPanel, rightPanel]);

	const claimDiffReviewResolution = useCallback(
		(review: ExternalWriteReview) => {
			if (diffResolvedReviewIdsRef.current.has(review.reviewId)) {
				return false;
			}
			diffResolvedReviewIdsRef.current.add(review.reviewId);
			return true;
		},
		[],
	);

	const registerExternalWriteReview = useCallback(
		(review: ExternalWriteReview) => {
			if (diffResolvedReviewIdsRef.current.has(review.reviewId)) {
				return () => {};
			}
			const existingReview = openDiffReviewByFileIdRef.current.get(
				review.fileId,
			);
			if (existingReview && existingReview.reviewId !== review.reviewId) {
				resolveDiffReviewTelemetryRef.current?.(existingReview, "abandoned");
			}
			openDiffReviewByFileIdRef.current.set(review.fileId, review);
			if (!diffOpenedReviewIdsRef.current.has(review.reviewId)) {
				diffOpenedReviewIdsRef.current.add(review.reviewId);
				captureWorkspaceTelemetry("diff_opened", {
					diff_review_id: review.reviewId,
					file_extension: fileExtensionProperty(review.path),
					source: "renderer",
				});
			}
			return () => {
				const current = openDiffReviewByFileIdRef.current.get(review.fileId);
				if (current?.reviewId === review.reviewId) {
					openDiffReviewByFileIdRef.current.delete(review.fileId);
				}
			};
		},
		[captureWorkspaceTelemetry],
	);

	const captureDiffResolvedTelemetry = useCallback(
		(
			review: ExternalWriteReview,
			outcome: "accepted" | "abandoned" | "rejected",
		) => {
			captureWorkspaceTelemetry("diff_resolved", {
				diff_review_id: review.reviewId,
				file_extension: fileExtensionProperty(review.path),
				outcome,
				source: "renderer",
			});
		},
		[captureWorkspaceTelemetry],
	);

	const resolveDiffReviewTelemetry = useCallback(
		(
			review: ExternalWriteReview,
			outcome: "accepted" | "abandoned" | "rejected",
		) => {
			if (!claimDiffReviewResolution(review)) {
				return false;
			}
			const openReview = openDiffReviewByFileIdRef.current.get(review.fileId);
			if (openReview?.reviewId === review.reviewId) {
				openDiffReviewByFileIdRef.current.delete(review.fileId);
			}
			captureDiffResolvedTelemetry(review, outcome);
			return true;
		},
		[claimDiffReviewResolution, captureDiffResolvedTelemetry],
	);
	resolveDiffReviewTelemetryRef.current = resolveDiffReviewTelemetry;

	const handleAgentHookTurnEvent = useCallback(
		async (event: AgentHookTurnEvent): Promise<AgentHookTurnEventResult> => {
			const key = agentTurnKey(event);
			if (event.phase === "turn-start") {
				const attemptNumber = incrementAgentPromptAttemptNumber(
					agentPromptAttemptNumbersRef.current,
					event,
				);
				captureWorkspaceTelemetry("prompt_submitted", {
					agent: event.agent,
					surface: "terminal",
					source: "agent_hook",
					attempt_number: attemptNumber,
				});
				const additionalContext = buildFlashtypeActiveFilePrompt(
					activeFilePathFromPanel(panelStatesRef.current.central),
				);
				const beforeCommitIdPromise = readSyncedActiveCommitId(lix).catch(
					(error: unknown) => {
						console.warn(
							"[agent-turn-review] failed to capture start commit",
							error,
						);
						return null;
					},
				);
				activeAgentTurnsRef.current.set(key, {
					key,
					event,
					beforeCommitIdPromise,
				});
				await beforeCommitIdPromise;
				return additionalContext ? { additionalContext } : undefined;
			}

			try {
				const activeTurn = activeAgentTurnsRef.current.get(key);
				const beforeCommitId = activeTurn
					? await activeTurn.beforeCommitIdPromise
					: null;
				const afterCommitId = await readSyncedActiveCommitId(lix);
				activeAgentTurnsRef.current.delete(key);

				if (
					beforeCommitId &&
					afterCommitId &&
					beforeCommitId !== afterCommitId
				) {
					const range: AgentTurnCommitRange = {
						id: [
							event.instanceId ?? "unknown-instance",
							event.agent,
							event.sessionId ?? "unknown-session",
							event.turnId ?? String(event.createdAt),
							beforeCommitId,
							afterCommitId,
						].join(":"),
						agent: event.agent,
						beforeCommitId,
						afterCommitId,
						sessionId: event.sessionId,
						turnId: event.turnId,
						startedAt: activeTurn?.event.createdAt ?? event.createdAt,
						completedAt: Date.now(),
					};
					await appendAgentTurnCommitRange(lix, range);
					try {
						await autoOpenFirstAgentReviewFileRef.current(range);
					} catch (error: unknown) {
						console.warn(
							"[agent-turn-review] failed to open first edited review file",
							error,
						);
					}
				}
			} catch (error: unknown) {
				activeAgentTurnsRef.current.delete(key);
				console.warn(
					"[agent-turn-review] failed to capture stop commit",
					error,
				);
				throw error;
			}
		},
		[lix, captureWorkspaceTelemetry],
	);

	useEffect(() => {
		const unsubscribe = window.flashtypeDesktop?.agentHooks?.onTurnEvent(
			(event: unknown) => {
				if (isAgentHookTurnEvent(event)) {
					return handleAgentHookTurnEvent(event);
				}
				return undefined;
			},
		);
		return () => {
			unsubscribe?.();
		};
	}, [handleAgentHookTurnEvent]);

	const activeInstances = useMemo(() => {
		const keys = new Set<string>();
		for (const view of leftPanel.views) keys.add(view.instance);
		for (const view of centralPanel.views) keys.add(view.instance);
		for (const view of rightPanel.views) keys.add(view.instance);
		return keys;
	}, [leftPanel.views, centralPanel.views, rightPanel.views]);

	useEffect(() => {
		viewHostRegistry.pruneHosts(activeInstances);
	}, [viewHostRegistry, activeInstances]);

	useEffect(() => {
		let cancelled = false;
		let debounceId: number | null = null;
		let reloadPromise: Promise<void> | null = null;

		const reloadInstalledExtensions = async () => {
			if (reloadPromise) {
				await reloadPromise;
				return;
			}
			reloadPromise = (async () => {
				try {
					const installed = await loadInstalledExtensionsFromLix(lix);
					if (!cancelled) {
						replaceInstalledExtensions(installed);
						setHasLoadedInstalledExtensions(true);
					}
				} catch (error) {
					console.warn(
						"[extension-loader] failed to load installed extensions",
						error,
					);
					if (!cancelled) {
						clearInstalledExtensions();
						setHasLoadedInstalledExtensions(true);
					}
				}
			})();
			try {
				await reloadPromise;
			} finally {
				reloadPromise = null;
			}
		};

		const scheduleReload = () => {
			if (cancelled) return;
			if (debounceId !== null) {
				window.clearTimeout(debounceId);
			}
			debounceId = window.setTimeout(() => {
				debounceId = null;
				void reloadInstalledExtensions();
			}, 150);
		};

		void reloadInstalledExtensions();

		const observeEvents = lix.observe(INSTALLED_EXTENSION_OBSERVE_SQL, [
			INSTALLED_EXTENSION_PATH_PREFIX,
			INSTALLED_EXTENSION_PATH_PREFIX_UPPER_BOUND,
		]);

		void (async () => {
			try {
				while (!cancelled) {
					const event = await observeEvents.next();
					if (cancelled || !event) break;
					scheduleReload();
				}
			} catch (error) {
				if (!cancelled) {
					console.warn("[extension-loader] observe failed", error);
				}
			}
		})();

		return () => {
			cancelled = true;
			if (debounceId !== null) {
				window.clearTimeout(debounceId);
				debounceId = null;
			}
			observeEvents.close();
		};
	}, [lix, replaceInstalledExtensions, clearInstalledExtensions]);

	const lastPersistedRef = useRef<string>(
		JSON.stringify(uiStateKV ?? DEFAULT_FLASHTYPE_UI_STATE),
	);
	const pendingPersistRef = useRef<string | null>(null);
	const hydratingRef = useRef(false);

	const updateDerivedPanelState = useCallback(
		(next: PanelLayoutSizes) => {
			if (next.left > MIN_VISIBLE_PANEL_SIZE) {
				lastNonZeroSizesRef.current.left = next.left;
			}
			if (next.right > MIN_VISIBLE_PANEL_SIZE) {
				lastNonZeroSizesRef.current.right = next.right;
			}
			setIsLeftCollapsed(next.left <= MIN_VISIBLE_PANEL_SIZE);
			setIsRightCollapsed(next.right <= MIN_VISIBLE_PANEL_SIZE);
		},
		[setIsLeftCollapsed, setIsRightCollapsed],
	);

	useEffect(() => {
		const hydrateOptions = {
			preserveUnknownKinds: !hasLoadedInstalledExtensions,
		};
		if (!uiStateKV) return;
		const serialized = JSON.stringify(uiStateKV);
		if (
			serialized === lastPersistedRef.current ||
			serialized === pendingPersistRef.current
		) {
			lastPersistedRef.current = serialized;
			if (pendingPersistRef.current === serialized) {
				pendingPersistRef.current = null;
			}
			return;
		}
		hydratingRef.current = true;
		lastPersistedRef.current = serialized;
		setLeftPanel((prev) =>
			prev === sanitizedPersistedPanels.left
				? prev
				: hydratePanelForDocumentSlot(
						"left",
						sanitizedPersistedPanels.left,
						extensionMap,
						hydrateOptions,
					),
		);
		setCentralPanel((prev) =>
			prev === sanitizedPersistedPanels.central
				? prev
				: hydratePanelForDocumentSlot(
						"central",
						sanitizedPersistedPanels.central,
						extensionMap,
						hydrateOptions,
					),
		);
		setRightPanel((prev) =>
			prev === sanitizedPersistedPanels.right
				? prev
				: hydratePanelForDocumentSlot(
						"right",
						sanitizedPersistedPanels.right,
						extensionMap,
						hydrateOptions,
					),
		);
		setFocusedPanel((prev) =>
			prev === uiStateKV.focusedPanel ? prev : uiStateKV.focusedPanel,
		);
		setPanelSizes((prev) => {
			const next = normalizeLayoutSizes(uiStateKV.layout?.sizes);
			if (
				prev.left === next.left &&
				prev.central === next.central &&
				prev.right === next.right
			) {
				return prev;
			}
			updateDerivedPanelState(next);
			return next;
		});
		queueMicrotask(() => {
			hydratingRef.current = false;
			if (pendingPersistRef.current === serialized) {
				pendingPersistRef.current = null;
			}
		});
	}, [
		uiStateKV,
		sanitizedPersistedPanels,
		updateDerivedPanelState,
		extensionMap,
		hasLoadedInstalledExtensions,
	]);

	useEffect(() => {
		const hydrateOptions = {
			preserveUnknownKinds: !hasLoadedInstalledExtensions,
		};
		setLeftPanel((current) =>
			hydratePanelForDocumentSlot(
				"left",
				current,
				extensionMap,
				hydrateOptions,
			),
		);
		setCentralPanel((current) =>
			hydratePanelForDocumentSlot(
				"central",
				current,
				extensionMap,
				hydrateOptions,
			),
		);
		setRightPanel((current) =>
			hydratePanelForDocumentSlot(
				"right",
				current,
				extensionMap,
				hydrateOptions,
			),
		);
	}, [extensionMap, hasLoadedInstalledExtensions]);

	useEffect(() => {
		if (hydratingRef.current) return;
		const nextState: FlashtypeUiState = {
			focusedPanel,
			panels: sanitizePanels({
				left: leftPanel,
				central: centralPanel,
				right: rightPanel,
			}),
			layout: { sizes: panelSizes },
		};
		const serialized = JSON.stringify(nextState);
		if (
			serialized === lastPersistedRef.current ||
			serialized === pendingPersistRef.current
		) {
			return;
		}
		pendingPersistRef.current = serialized;
		const timeoutId = setTimeout(() => {
			void setUiStateKV(nextState);
		}, 200);
		return () => {
			clearTimeout(timeoutId);
			if (pendingPersistRef.current === serialized) {
				pendingPersistRef.current = null;
			}
		};
	}, [
		leftPanel,
		centralPanel,
		rightPanel,
		focusedPanel,
		panelSizes,
		setUiStateKV,
	]);

	const setPanelState = useCallback(
		(
			side: PanelSide,
			reducer: (state: PanelState) => PanelState,
			options: { focus?: boolean } = {},
		) => {
			const applyReducer = (prev: PanelState) => {
				const next = hydratePanel(
					reducer(
						hydratePanelForDocumentSlot(side, prev, extensionMap, {
							preserveUnknownKinds: !hasLoadedInstalledExtensions,
						}),
					),
					extensionMap,
					{ preserveUnknownKinds: !hasLoadedInstalledExtensions },
				);
				return normalizePanelForDocumentSlot(side, next);
			};
			if (side === "left") {
				setLeftPanel(applyReducer);
			} else if (side === "central") {
				setCentralPanel(applyReducer);
			} else {
				setRightPanel(applyReducer);
			}
			if (options.focus) {
				setFocusedPanel((prev) => (prev === side ? prev : side));
			}
		},
		[
			setLeftPanel,
			setCentralPanel,
			setRightPanel,
			setFocusedPanel,
			extensionMap,
			hasLoadedInstalledExtensions,
		],
	);

	useEffect(() => {
		checkpointDiffRef.current = checkpointDiff;
	}, [checkpointDiff]);

	const transitionCheckpointEditorRevisions = useCallback(
		(args: {
			readonly previousDiff: CheckpointDiff | null;
			readonly nextDiff: CheckpointDiff | null;
		}) => {
			void (async () => {
				const currentFileIds = args.previousDiff
					? await readCurrentLixFileIds(lix)
					: new Set<string>();
				const transitionPanel =
					(side: PanelSide) =>
					(panel: PanelState): PanelState =>
						normalizePanelForDocumentSlot(
							side,
							transitionCheckpointEditorRevisionPanel({
								panel,
								previousDiff: args.previousDiff,
								nextDiff: args.nextDiff,
								currentFileIds,
							}),
						);
				setLeftPanel(transitionPanel("left"));
				setCentralPanel(transitionPanel("central"));
				setRightPanel(transitionPanel("right"));
			})().catch((error: unknown) => {
				onError?.(error);
			});
		},
		[lix, onError],
	);

	const clearCheckpointDiff = useCallback(() => {
		const previousDiff = checkpointDiffRef.current;
		checkpointDiffRef.current = null;
		setCheckpointDiff(null);
		transitionCheckpointEditorRevisions({
			previousDiff,
			nextDiff: null,
		});
	}, [transitionCheckpointEditorRevisions]);

	const schedulePanelAnimation = useCallback(() => {
		setShouldAnimatePanels(true);
		if (animationTimeoutRef.current !== null) {
			window.clearTimeout(animationTimeoutRef.current);
		}
		animationTimeoutRef.current = window.setTimeout(() => {
			setShouldAnimatePanels(false);
			animationTimeoutRef.current = null;
		}, 220);
	}, []);

	const ensurePanelExpanded = useCallback(
		(side: PanelSide) => {
			if (side === "central") return;
			const panelRef =
				side === "left" ? leftPanelRef.current : rightPanelRef.current;
			const isCollapsed = side === "left" ? isLeftCollapsed : isRightCollapsed;
			if (!panelRef || !isCollapsed) return;
			const initialSize =
				side === "left" ? initialLayoutSizes.left : initialLayoutSizes.right;
			const lastSize =
				side === "left"
					? lastNonZeroSizesRef.current.left
					: lastNonZeroSizesRef.current.right;
			const fallbackSize =
				side === "left"
					? DEFAULT_PANEL_FALLBACK_SIZES.left
					: DEFAULT_PANEL_FALLBACK_SIZES.right;
			const desiredSize =
				lastSize > MIN_VISIBLE_PANEL_SIZE ? lastSize : initialSize;
			let targetSize =
				desiredSize > MIN_VISIBLE_PANEL_SIZE ? desiredSize : fallbackSize;
			if (side === "right") {
				targetSize = Math.max(targetSize, MIN_UNCOLLAPSED_RIGHT_SIZE);
			}
			schedulePanelAnimation();
			if (side === "left") {
				setIsLeftCollapsed(false);
			} else {
				setIsRightCollapsed(false);
			}
			panelRef.resize(targetSize);
		},
		[
			initialLayoutSizes.left,
			initialLayoutSizes.right,
			isLeftCollapsed,
			isRightCollapsed,
			schedulePanelAnimation,
		],
	);

	const handleOpenView = useCallback(
		({
			panel,
			kind,
			state,
			launchArgs,
			focus = true,
			instance,
			pending = false,
		}: {
			panel: PanelSide;
			kind: ExtensionKind;
			state?: ExtensionState;
			launchArgs?: ExtensionLaunchArgs;
			focus?: boolean;
			instance?: string;
			pending?: boolean;
		}) => {
			if (panel === "central") {
				const candidate: ExtensionInstance = {
					instance: instance ?? "",
					kind,
					state,
					launchArgs,
					isPending: pending || undefined,
				};
				if (!isDocumentView(candidate)) return;
			}
			ensurePanelExpanded(panel);
			setPanelState(
				panel,
				(current) => {
					if (pending) {
						const targetInstance = instance ?? createExtensionInstanceId(kind);
						const nextView: ExtensionInstance = {
							instance: targetInstance,
							kind,
							state,
							launchArgs,
							isPending: true,
						};
						return upsertPendingExtension(current, nextView, {
							activate: true,
						});
					}
					if (!instance) {
						const existing = current.views.find((entry) => entry.kind === kind);
						if (existing) {
							const views =
								state || launchArgs
									? current.views.map((entry) =>
											entry.instance === existing.instance
												? {
														...entry,
														state: state ?? entry.state,
														launchArgs: launchArgs ?? entry.launchArgs,
													}
												: entry,
										)
									: current.views;
							return {
								views,
								activeInstance: existing.instance,
							};
						}
					}
					const targetInstance = instance ?? createExtensionInstanceId(kind);
					const existingByInstance = instance
						? current.views.find((entry) => entry.instance === instance)
						: null;
					if (existingByInstance) {
						const views = current.views.map((entry) =>
							entry.instance === targetInstance
								? {
										...entry,
										kind,
										state: state ?? entry.state,
										launchArgs: launchArgs ?? entry.launchArgs,
									}
								: entry,
						);
						return {
							views,
							activeInstance: targetInstance,
						};
					}
					const nextView: ExtensionInstance = {
						instance: targetInstance,
						kind,
						state,
						launchArgs,
					};
					return {
						views: [...current.views, nextView],
						activeInstance: nextView.instance,
					};
				},
				{ focus },
			);
		},
		[ensurePanelExpanded, setPanelState],
	);

	const openResolvedFileView = useCallback(
		({
			panel: _requestedPanel,
			fileId,
			filePath,
			instance,
			state,
			launchArgs,
			focus = true,
			pending = false,
			documentOrigin = "existing",
			trackTelemetry = true,
			trackDocumentOpenAttempt = trackTelemetry,
			trackDocumentViewed = trackTelemetry,
		}: {
			panel: PanelSide;
			fileId: string;
			filePath: string;
			instance?: string;
			state?: ExtensionState;
			launchArgs?: ExtensionLaunchArgs;
			focus?: boolean;
			pending?: boolean;
			documentOrigin?: "existing" | "new";
			trackTelemetry?: boolean;
			trackDocumentOpenAttempt?: boolean;
			trackDocumentViewed?: boolean;
		}) => {
			const handler =
				findFileHandlerExtension(extensionMap.values(), filePath) ?? undefined;
			const kind = handler?.kind ?? FILE_EXTENSION_KIND;
			if (trackDocumentOpenAttempt) {
				captureWorkspaceTelemetry("document_open_attempted", {
					...documentOpenAttemptTelemetryProperties({ filePath, handler }),
					document_origin: documentOrigin,
					source: "renderer",
					view_kind: kind,
				});
			}
			if (trackDocumentViewed && handler) {
				captureWorkspaceTelemetry("document_viewed", {
					document_origin: documentOrigin,
					file_extension: fileExtensionProperty(filePath),
					source: "renderer",
					view_kind: kind,
				});
			}
			handleOpenView({
				panel: "central",
				kind,
				instance: instance ?? fileExtensionInstanceForKind(kind, fileId),
				state: {
					...buildFileExtensionProps({ fileId, filePath }),
					...(state ?? {}),
				},
				launchArgs,
				focus,
				pending,
			});
		},
		[handleOpenView, extensionMap, captureWorkspaceTelemetry],
	);

	const showCheckpointDiff = useCallback(
		async ({ branchId, branches }: ShowCheckpointDiffArgs) => {
			const previousDiff = checkpointDiffRef.current;
			const [resolvedDiff, activeBranchId] = await Promise.all([
				resolveCheckpointDiff({ lix, branches, branchId }),
				lix.activeBranchId().catch(() => null),
			]);
			const nextDiff =
				resolvedDiff && activeBranchId === branchId
					? { ...resolvedDiff, afterIsActiveHead: true }
					: resolvedDiff;
			checkpointDiffRef.current = nextDiff;
			setCheckpointDiff(nextDiff);
			transitionCheckpointEditorRevisions({
				previousDiff,
				nextDiff,
			});
			return nextDiff;
		},
		[lix, transitionCheckpointEditorRevisions],
	);

	const autoOpenFirstAgentReviewFile = useCallback(
		async (range: AgentTurnCommitRange) => {
			const centralPanelState = panelStatesRef.current.central;
			const activeInstance =
				centralPanelState.activeInstance ??
				centralPanelState.views[0]?.instance ??
				null;
			const activeEntry = activeInstance
				? centralPanelState.views.find(
						(entry) => entry.instance === activeInstance,
					)
				: null;
			const activeFileId =
				typeof activeEntry?.state?.fileId === "string"
					? activeEntry.state.fileId
					: null;
			const activeFilePath =
				typeof activeEntry?.state?.filePath === "string"
					? activeEntry.state.filePath
					: null;
			if (activeFileId && activeFilePath) {
				const activeReview = await getExternalWriteReview(
					lix,
					activeFileId,
					activeFilePath,
				);
				if (activeReview) {
					return;
				}
			}

			const files = await qb(lix)
				.selectFrom("lix_file")
				.select(["id", "path"])
				.orderBy("path", "asc")
				.execute();
			const reviewableFiles = files.map((file) => ({
				fileId: file.id as string,
				path: file.path as string,
			}));
			const pendingPaths = await getPendingExternalWriteReviewPaths(
				lix,
				reviewableFiles,
				[range],
			);
			const firstReviewFile = reviewableFiles.find((file) =>
				pendingPaths.has(file.path),
			);
			if (!firstReviewFile) {
				return;
			}
			openResolvedFileView({
				panel: "central",
				fileId: firstReviewFile.fileId,
				filePath: firstReviewFile.path,
				focus: true,
			});
		},
		[lix, openResolvedFileView],
	);
	autoOpenFirstAgentReviewFileRef.current = autoOpenFirstAgentReviewFile;

	const handleOpenFile = useCallback(
		async ({
			panel,
			fileId: _requestedFileId,
			filePath,
			state,
			launchArgs,
			focus,
			pending,
			documentOrigin,
			trackTelemetry,
			trackDocumentOpenAttempt,
			trackDocumentViewed,
			startupFallbackRevision,
		}: {
			panel: PanelSide;
			fileId: string;
			filePath: string;
			state?: ExtensionState;
			launchArgs?: ExtensionLaunchArgs;
			focus?: boolean;
			pending?: boolean;
			documentOrigin?: "existing" | "new";
			trackTelemetry?: boolean;
			trackDocumentOpenAttempt?: boolean;
			trackDocumentViewed?: boolean;
			startupFallbackRevision?: number;
		}) => {
			const shouldAbortStartupFallback = () =>
				startupFallbackRevision !== undefined &&
				(fileOpenInterruptRevisionRef.current !== startupFallbackRevision ||
					Boolean(activeEntryFromPanel(panelStatesRef.current.central)));

			if (startupFallbackRevision === undefined) {
				fileOpenInterruptRevisionRef.current += 1;
			} else if (shouldAbortStartupFallback()) {
				return;
			}

			if (hasHistoricalEditorRevisionState(state)) {
				if (shouldAbortStartupFallback()) return;
				openResolvedFileView({
					panel,
					fileId: _requestedFileId,
					filePath,
					state,
					launchArgs,
					focus,
					pending,
					documentOrigin,
					trackTelemetry,
					trackDocumentOpenAttempt,
					trackDocumentViewed,
				});
				return;
			}

			let resolvedFile: LixFileForOpen | null = null;
			try {
				resolvedFile = await resolveLixFileForOpen({
					lix,
					workspace,
					filePath,
				});
			} catch (error) {
				onError?.(error);
				return;
			}
			if (!resolvedFile) {
				onError?.(
					new Error(`File not found in the opened workspace: ${filePath}`),
				);
				return;
			}

			if (shouldAbortStartupFallback()) return;
			openResolvedFileView({
				panel,
				fileId: resolvedFile.id,
				filePath: resolvedFile.path,
				state,
				launchArgs,
				focus,
				pending,
				documentOrigin,
				trackTelemetry,
				trackDocumentOpenAttempt,
				trackDocumentViewed,
			});
		},
		[lix, workspace, onError, openResolvedFileView],
	);

	useEffect(() => {
		if (!pendingOpenFilePaths || pendingOpenFilePaths.length === 0) return;
		let cancelled = false;
		(async () => {
			const openedFiles: Array<{ id: string; path: string }> = [];
			const handledFilePaths: string[] = [];
			for (const pendingOpenFilePath of pendingOpenFilePaths) {
				const file = await resolveLixFileForOpen({
					lix,
					workspace,
					filePath: `/${pendingOpenFilePath}`,
				});
				if (cancelled) return;
				if (!file) {
					throw new Error(
						`File not found in the opened workspace: ${pendingOpenFilePath}`,
					);
				}
				openResolvedFileView({
					panel: "central",
					fileId: file.id as string,
					filePath: file.path as string,
					focus: false,
					trackDocumentOpenAttempt: true,
					trackDocumentViewed: false,
				});
				openedFiles.push({ id: file.id as string, path: file.path as string });
				handledFilePaths.push(pendingOpenFilePath);
			}
			const firstFile = openedFiles[0];
			if (!cancelled && firstFile) {
				openResolvedFileView({
					panel: "central",
					fileId: firstFile.id,
					filePath: firstFile.path,
					focus: true,
					trackDocumentOpenAttempt: false,
					trackDocumentViewed: true,
				});
			}
			if (!cancelled) {
				for (const handledFilePath of handledFilePaths) {
					onPendingOpenFileHandled?.(handledFilePath);
				}
			}
		})().catch((error: unknown) => {
			if (!cancelled) {
				onError?.(error);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [
		lix,
		onError,
		onPendingOpenFileHandled,
		openResolvedFileView,
		pendingOpenFilePaths,
		workspace,
	]);

	const getExternalWriteReviewForFile = useCallback(
		({
			fileId,
			reviewId,
			review,
		}: {
			readonly fileId: string;
			readonly reviewId: string;
			readonly review?: ExternalWriteReview;
		}): ExternalWriteReview | null => {
			if (review?.fileId === fileId && review.reviewId === reviewId) {
				return review;
			}
			const openReview = openDiffReviewByFileIdRef.current.get(fileId);
			return openReview?.reviewId === reviewId ? openReview : null;
		},
		[],
	);

	const isExternalWriteReviewCurrent = useCallback(
		async (review: ExternalWriteReview): Promise<boolean> => {
			const [current, afterData] = await Promise.all([
				qb(lix)
					.selectFrom("lix_file")
					.select(["data"])
					.where("id", "=", review.fileId)
					.limit(1)
					.executeTakeFirst(),
				getFileDataAtCommit(lix, review.fileId, review.afterCommitId),
			]);
			return (
				!!current &&
				!!afterData &&
				fileBytesEqual(decodeFileDataToBytes(current.data), afterData)
			);
		},
		[lix],
	);

	const handleAcceptExternalWriteReview = useCallback(
		async (args: {
			readonly fileId: string;
			readonly reviewId: string;
			readonly review?: ExternalWriteReview;
		}) => {
			const review = getExternalWriteReviewForFile(args);
			if (!review) {
				return;
			}
			if (diffResolvedReviewIdsRef.current.has(review.reviewId)) return;
			await clearAgentTurnCommitRangeFile(lix, {
				fileId: review.fileId,
				reviewId: review.reviewId,
				agentTurnRangeIds: review.agentTurnRangeIds,
			});
			const outcome = (await isExternalWriteReviewCurrent(review))
				? "accepted"
				: "abandoned";
			resolveDiffReviewTelemetry(review, outcome);
		},
		[
			lix,
			getExternalWriteReviewForFile,
			isExternalWriteReviewCurrent,
			resolveDiffReviewTelemetry,
		],
	);

	const handleRejectExternalWriteReview = useCallback(
		async (args: {
			readonly fileId: string;
			readonly reviewId: string;
			readonly review?: ExternalWriteReview;
		}) => {
			const review = getExternalWriteReviewForFile(args);
			if (!review) {
				return;
			}
			if (diffResolvedReviewIdsRef.current.has(review.reviewId)) return;
			if (!(await isExternalWriteReviewCurrent(review))) {
				await clearAgentTurnCommitRangeFile(lix, {
					fileId: review.fileId,
					reviewId: review.reviewId,
					agentTurnRangeIds: review.agentTurnRangeIds,
				});
				resolveDiffReviewTelemetry(review, "abandoned");
				return;
			}
			const beforeData = await getFileDataAtCommit(
				lix,
				review.fileId,
				review.beforeCommitId,
			);
			if (!beforeData) {
				await clearAgentTurnCommitRangeFile(lix, {
					fileId: review.fileId,
					reviewId: review.reviewId,
					agentTurnRangeIds: review.agentTurnRangeIds,
				});
				resolveDiffReviewTelemetry(review, "abandoned");
				return;
			}
			const { fileId } = args;
			const result = await qb(lix)
				.updateTable("lix_file")
				.set({ data: beforeData })
				.where("id", "=", fileId)
				.executeTakeFirst();
			await clearAgentTurnCommitRangeFile(lix, {
				fileId: review.fileId,
				reviewId: review.reviewId,
				agentTurnRangeIds: review.agentTurnRangeIds,
			});
			if (Number(result.numUpdatedRows) > 0) {
				resolveDiffReviewTelemetry(review, "rejected");
			} else {
				resolveDiffReviewTelemetry(review, "abandoned");
			}
		},
		[
			lix,
			getExternalWriteReviewForFile,
			isExternalWriteReviewCurrent,
			resolveDiffReviewTelemetry,
		],
	);

	const handleCloseView = useCallback(
		({
			panel,
			instance,
			kind,
			focus = false,
		}: {
			panel?: PanelSide;
			instance?: string;
			kind?: ExtensionKind;
			focus?: boolean;
		}) => {
			if (!instance && !kind) return;
			const predicate = (entry: ExtensionInstance) => {
				if (instance) return entry.instance === instance;
				if (kind) return entry.kind === kind;
				return false;
			};
			const targetPanels: PanelSide[] = panel
				? [panel]
				: (["central", "left", "right"] as PanelSide[]);
			for (const side of targetPanels) {
				const currentPanel = panelStatesRef.current[side];
				const removedView = currentPanel.views.find(predicate);
				const removedFileId =
					typeof removedView?.state?.fileId === "string"
						? removedView.state.fileId
						: null;
				const removedReview = removedFileId
					? openDiffReviewByFileIdRef.current.get(removedFileId)
					: null;
				let removed = false;
				setPanelState(
					side,
					(current) => {
						const index = current.views.findIndex(predicate);
						if (index === -1) return current;
						removed = true;
						const views = current.views.filter((_, idx) => idx !== index);
						const removedEntry = current.views[index];
						const activeInstance =
							current.activeInstance === removedEntry?.instance
								? (views[views.length - 1]?.instance ?? null)
								: current.activeInstance;
						return { views, activeInstance };
					},
					{ focus },
				);
				if (removed) {
					const review = removedReview;
					if (
						review &&
						!diffResolvedReviewIdsRef.current.has(review.reviewId)
					) {
						resolveDiffReviewTelemetry(review, "abandoned");
					}
					break;
				}
			}
		},
		[setPanelState, resolveDiffReviewTelemetry],
	);

	const handleCloseFileViews = useCallback(
		({ panel, fileId }: { panel?: PanelSide; fileId: string }) => {
			const targetPanels: PanelSide[] = panel
				? [panel]
				: (["central", "left", "right"] as PanelSide[]);
			const matchesFileView = (entry: ExtensionInstance) => {
				if (entry.state?.fileId !== fileId) return false;
				return (
					entry.instance === fileExtensionInstanceForKind(entry.kind, fileId)
				);
			};
			for (const side of targetPanels) {
				const removedReview = openDiffReviewByFileIdRef.current.get(fileId);
				let removed = false;
				setPanelState(side, (current) => {
					const views = current.views.filter(
						(entry) => !matchesFileView(entry),
					);
					if (views.length === current.views.length) {
						return current;
					}
					removed = true;
					const activeInstance = views.some(
						(entry) => entry.instance === current.activeInstance,
					)
						? current.activeInstance
						: (views[views.length - 1]?.instance ?? null);
					return { views, activeInstance };
				});
				if (
					removed &&
					removedReview &&
					!diffResolvedReviewIdsRef.current.has(removedReview.reviewId)
				) {
					resolveDiffReviewTelemetry(removedReview, "abandoned");
				}
			}
		},
		[setPanelState, resolveDiffReviewTelemetry],
	);

	const activeCentralEntry = useMemo(() => {
		return activeEntryFromPanel(centralPanel);
	}, [centralPanel]);

	useEffect(() => {
		if (mostRecentMarkdownFallbackAttemptedRef.current) return;
		if (canPersistOpenFileSession !== true) return;
		if ((pendingOpenFilePaths?.length ?? 0) > 0) return;
		if (activeCentralEntry) {
			mostRecentMarkdownFallbackAttemptedRef.current = true;
			return;
		}

		const workspaceApi = window.flashtypeDesktop?.workspace;
		if (!workspaceApi?.getMostRecentMarkdownFile) {
			mostRecentMarkdownFallbackAttemptedRef.current = true;
			return;
		}

		mostRecentMarkdownFallbackAttemptedRef.current = true;
		const fallbackRevision = fileOpenInterruptRevisionRef.current;
		let cancelled = false;
		void workspaceApi
			.getMostRecentMarkdownFile()
			.then(async (file) => {
				if (cancelled || !file?.path) return;
				if (fileOpenInterruptRevisionRef.current !== fallbackRevision) return;
				if (activeEntryFromPanel(panelStatesRef.current.central)) return;
				await handleOpenFile({
					panel: "central",
					fileId: "",
					filePath: file.path,
					focus: true,
					documentOrigin: "existing",
					startupFallbackRevision: fallbackRevision,
				});
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					onError?.(error);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [
		activeCentralEntry,
		canPersistOpenFileSession,
		handleOpenFile,
		onError,
		pendingOpenFilePaths,
	]);

	const handleAddView = useCallback(
		(side: PanelSide, kind: ExtensionKind, state?: ExtensionState) => {
			// Multi-instance kinds (agent terminals) get a fresh instance per
			// add; single-instance kinds reuse the existing view.
			const instance = extensionMap.get(kind)?.multiInstance
				? createExtensionInstanceId(kind)
				: undefined;
			const launchArgs = buildAgentLaunchArgsWithActiveFile({
				state,
				activeFilePath:
					typeof activeCentralEntry?.state?.filePath === "string"
						? activeCentralEntry.state.filePath
						: null,
			});
			const agent =
				kind === TERMINAL_EXTENSION_KIND &&
				typeof state?.flashtype?.icon === "string"
					? state.flashtype.icon
					: undefined;
			if (agent) {
				captureWorkspaceTelemetry("agent_opened", {
					agent,
					panel: side,
					source: "renderer",
					surface: "terminal",
				});
			}
			handleOpenView({ panel: side, kind, state, launchArgs, instance });
		},
		[
			activeCentralEntry,
			handleOpenView,
			extensionMap,
			captureWorkspaceTelemetry,
		],
	);

	useEffect(() => {
		if (agentPreferenceAttemptedRef.current) return;
		if (!extensionMap.has(TERMINAL_EXTENSION_KIND)) return;
		if (rightPanel.views.length > 0) {
			agentPreferenceAttemptedRef.current = true;
			return;
		}

		const terminalApi = window.flashtypeDesktop?.terminal;
		if (!terminalApi?.getPreferredAgent) {
			agentPreferenceAttemptedRef.current = true;
			return;
		}

		agentPreferenceAttemptedRef.current = true;
		const runId = (agentPreferenceRunRef.current += 1);
		void (async () => {
			const cwd = await window.flashtypeDesktop?.lix?.workspaceDir?.();
			const preference = await terminalApi.getPreferredAgent(
				cwd ? { cwd } : undefined,
			);
			if (runId !== agentPreferenceRunRef.current) return;
			if (
				preference.preferredAgent === "claude" ||
				preference.preferredAgent === "codex"
			) {
				setPreferredAgent(preference.preferredAgent);
			}
			const autoLaunchAgent =
				preference.autoLaunchAgent ?? preference.versionBlockedAutoLaunchAgent;
			if (autoLaunchAgent !== "claude" && autoLaunchAgent !== "codex") {
				return;
			}
			if (panelStatesRef.current.right.views.length > 0) {
				return;
			}
			const preset = agentLaunchPresetByKey(autoLaunchAgent);
			if (!preset) {
				return;
			}
			handleAddView("right", TERMINAL_EXTENSION_KIND, preset.state);
		})().catch((error: unknown) => {
			if (runId === agentPreferenceRunRef.current) {
				onError?.(error);
			}
		});
	}, [
		extensionMap,
		handleAddView,
		mostRecentMarkdownFallbackWorkspaceKey,
		onError,
		rightPanel.views.length,
	]);

	const focusPanel = useCallback((side: PanelSide) => {
		setFocusedPanel((prev) => (prev === side ? prev : side));
	}, []);

	const registerNewFileDraftHandler = useCallback(
		(registration: NewFileDraftHandlerRegistration) => {
			const key = newFileDraftHandlerKey(registration);
			newFileDraftHandlersRef.current.set(key, registration);
			return () => {
				if (newFileDraftHandlersRef.current.get(key) === registration) {
					newFileDraftHandlersRef.current.delete(key);
				}
			};
		},
		[],
	);

	const [activeId, setActiveId] = useState<string | null>(null);
	const hydratedLeft = leftPanel;
	const hydratedCentral = centralPanel;
	const hydratedRight = rightPanel;

	const pointerSensorOptions = useMemo(
		() => ({ activationConstraint: { distance: 8 } }),
		[],
	);
	const pointerSensor = useSensor(PointerSensor, pointerSensorOptions);
	const sensors = useSensors(pointerSensor);

	const handleLayoutChange = useCallback(
		(sizes: number[]) => {
			if (sizes.length !== 3) return;
			setPanelSizes((prev) => {
				const next = {
					left: sizes[0],
					central: sizes[1],
					right: sizes[2],
				};
				if (
					prev.left === next.left &&
					prev.central === next.central &&
					prev.right === next.right
				) {
					return prev;
				}
				updateDerivedPanelState(next);
				return next;
			});
		},
		[updateDerivedPanelState],
	);

	const handleDragStart = useCallback((event: DragStartEvent) => {
		setActiveId(event.active.id as string);
	}, []);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			setActiveId(null);
			const { active, over } = event;

			if (!over) return;

			const dragData = active.data.current as
				| { instance: string; kind: ExtensionKind; fromPanel: PanelSide }
				| undefined;
			const dropData = over.data.current as
				| {
						panel?: PanelSide;
						instance?: string;
						sortable?: { index: number };
				  }
				| undefined;
			const overSortable = (over.data.current as any)?.sortable as
				| { index: number }
				| undefined;

			if (!dragData || !dropData) return;

			const { instance, kind: _kind, fromPanel } = dragData;
			const toPanel = dropData.panel ?? fromPanel;
			const targetInstance = dropData.instance;

			if (toPanel === fromPanel) {
				setPanelState(
					fromPanel,
					(panel) => {
						const fromIndex = panel.views.findIndex(
							(entry) => entry.instance === instance,
						);
						if (fromIndex === -1) return panel;
						let toIndex: number | null = null;
						if (overSortable?.index != null) {
							toIndex = overSortable.index;
						} else if (targetInstance) {
							toIndex = panel.views.findIndex(
								(entry) => entry.instance === targetInstance,
							);
						} else {
							toIndex = panel.views.length - 1;
						}
						if (toIndex == null || toIndex === -1) {
							return panel;
						}
						return reorderPanelExtensionsByIndex(panel, fromIndex, toIndex);
					},
					{ focus: true },
				);
				return;
			}

			const sourcePanel =
				fromPanel === "left"
					? leftPanel
					: fromPanel === "central"
						? centralPanel
						: rightPanel;
			const movedView = cloneExtensionInstance(sourcePanel, instance);

			if (!movedView) return;
			if (!canPlaceViewInPanel(movedView, toPanel)) return;

			setPanelState(fromPanel, (panel) => {
				const remaining = panel.views.filter(
					(entry) => entry.instance !== instance,
				);
				const nextActive =
					panel.activeInstance === instance
						? (remaining[remaining.length - 1]?.instance ?? null)
						: panel.activeInstance;
				return { views: remaining, activeInstance: nextActive };
			});

			setPanelState(
				toPanel,
				(panel) => {
					const views = [...panel.views];
					let insertIndex = views.length;
					if (overSortable?.index != null) {
						insertIndex = Math.min(overSortable.index, views.length);
					} else if (targetInstance) {
						const targetIndex = views.findIndex(
							(entry) => entry.instance === targetInstance,
						);
						if (targetIndex !== -1) {
							insertIndex = targetIndex;
						}
					}
					views.splice(insertIndex, 0, movedView);
					return {
						views,
						activeInstance: movedView.instance,
					};
				},
				{ focus: true },
			);
		},
		[centralPanel, leftPanel, rightPanel, setPanelState],
	);

	const activeDragData = activeId
		? [
				...hydratedLeft.views,
				...hydratedCentral.views,
				...hydratedRight.views,
			].find((view) => view.instance === activeId)
		: null;
	const activeDragView = activeDragData
		? extensionMap.get(activeDragData.kind)
		: null;

	const handleCreateNewFile = useCallback(async () => {
		if (!lix) return;
		const path = await resolveNextUntitledMarkdownPath(lix);
		await qb(lix)
			.insertInto("lix_file")
			.values({
				path,
				data: new TextEncoder().encode(""),
			})
			.execute();
		const createdFile = await qb(lix)
			.selectFrom("lix_file")
			.select("id")
			.where("path", "=", path)
			.executeTakeFirstOrThrow();
		const id = createdFile.id;
		await handleOpenFile({
			panel: "central",
			fileId: id,
			filePath: path,
			documentOrigin: "new",
			state: { focusOnLoad: true, defaultBlock: "heading1" },
			focus: true,
		});
	}, [handleOpenFile, lix]);

	const handleNativeNewFile = useCallback(async () => {
		const visibleDraftHandlers = [
			...newFileDraftHandlersRef.current.values(),
		].filter((registration) => {
			if (registration.panelSide === "left") {
				return !isLeftCollapsed;
			}
			if (registration.panelSide === "right") {
				return !isRightCollapsed;
			}
			return true;
		});
		const filesViewHandler = selectNewFileDraftHandler(
			visibleDraftHandlers,
			focusedPanel,
		);
		if (filesViewHandler) {
			focusPanel(filesViewHandler.panelSide);
			filesViewHandler.handler();
			return;
		}
		try {
			await handleCreateNewFile();
		} catch (error) {
			if (onError) {
				onError(error);
				return;
			}
			console.error("Failed to create new file from native menu", error);
		}
	}, [
		focusPanel,
		focusedPanel,
		handleCreateNewFile,
		isLeftCollapsed,
		isRightCollapsed,
		onError,
	]);

	useEffect(() => {
		const unsubscribe =
			window.flashtypeDesktop?.workspace.onNewFile?.(handleNativeNewFile);
		return () => {
			unsubscribe?.();
		};
	}, [handleNativeNewFile]);

	const handleNativeCloseFile = useCallback(() => {
		if (!activeCentralEntry?.instance) return;
		if (typeof activeCentralEntry.state?.filePath !== "string") return;
		handleCloseView({
			panel: "central",
			instance: activeCentralEntry.instance,
			focus: true,
		});
	}, [activeCentralEntry, handleCloseView]);

	useEffect(() => {
		const unsubscribe = window.flashtypeDesktop?.workspace.onCloseFile?.(
			handleNativeCloseFile,
		);
		return () => {
			unsubscribe?.();
		};
	}, [handleNativeCloseFile]);

	const activeCentralFileId =
		activeFileIdFromExtensionInstance(activeCentralEntry);

	useEffect(() => {
		if (!activeCentralFileId) return;
		if (activeFileId === activeCentralFileId) return;
		void setActiveFileId(activeCentralFileId);
	}, [activeCentralFileId, activeFileId, setActiveFileId]);

	const activeFileName = useMemo(() => {
		if (!activeCentralEntry) return null;
		const rawPath = activeCentralEntry.state?.filePath as string | undefined;
		if (rawPath) {
			const segments = rawPath.split("/").filter(Boolean);
			return segments[segments.length - 1] ?? rawPath;
		}
		return (
			(activeCentralEntry.state?.flashtype?.label as string | undefined) ??
			extensionMap.get(activeCentralEntry.kind)?.label ??
			null
		);
	}, [activeCentralEntry, extensionMap]);

	const activeFilePath = useMemo(() => {
		return activeFilePathFromPanel(centralPanel);
	}, [centralPanel]);

	useEffect(() => {
		void window.flashtypeDesktop?.workspace.setActiveFilePath({
			filePath: activeFilePath,
		});
	}, [activeFilePath]);

	const sessionOpenFilePaths = useMemo(
		() => collectSessionOpenFilePaths([leftPanel, centralPanel, rightPanel]),
		[leftPanel, centralPanel, rightPanel],
	);

	useEffect(() => {
		if (!canPersistOpenFileSession) return;
		void window.flashtypeDesktop?.workspace.setOpenFilePaths({
			filePaths: sessionOpenFilePaths,
		});
	}, [canPersistOpenFileSession, sessionOpenFilePaths]);

	const isLeftFocused = focusedPanel === "left";
	const isCentralFocused = focusedPanel === "central";
	const isRightFocused = focusedPanel === "right";

	const addViewOnLeft = useCallback(
		(type: ExtensionKind, state?: ExtensionState) =>
			handleAddView("left", type, state),
		[handleAddView],
	);

	const addViewOnRight = useCallback(
		(type: ExtensionKind, state?: ExtensionState) =>
			handleAddView("right", type, state),
		[handleAddView],
	);

	const handleSelectLeftView = useCallback(
		(key: string) =>
			setPanelState(
				"left",
				(panel) => ({
					views: panel.views,
					activeInstance: key,
				}),
				{ focus: true },
			),
		[setPanelState],
	);

	const handleSelectCentralView = useCallback(
		(key: string) =>
			setPanelState("central", (panel) => activatePanelExtension(panel, key), {
				focus: true,
			}),
		[setPanelState],
	);

	const handleSelectRightView = useCallback(
		(key: string) =>
			setPanelState(
				"right",
				(panel) => ({
					views: panel.views,
					activeInstance: key,
				}),
				{ focus: true },
			),
		[setPanelState],
	);

	const handleRemoveView = useCallback(
		(side: PanelSide, instance: string) =>
			handleCloseView({ panel: side, instance, focus: true }),
		[handleCloseView],
	);

	const handleMoveViewToPanel = useCallback(
		(targetPanel: PanelSide, instance?: string) => {
			// Find the view in any panel
			const allViews = [
				...leftPanel.views.map((v) => ({
					...v,
					sourcePanel: "left" as PanelSide,
				})),
				...centralPanel.views.map((v) => ({
					...v,
					sourcePanel: "central" as PanelSide,
				})),
				...rightPanel.views.map((v) => ({
					...v,
					sourcePanel: "right" as PanelSide,
				})),
			];

			const viewToMove = instance
				? allViews.find((v) => v.instance === instance)
				: null;

			if (!viewToMove) return;

			const sourcePanel = viewToMove.sourcePanel;
			if (sourcePanel === targetPanel) return;
			if (!canPlaceViewInPanel(viewToMove, targetPanel)) return;

			// Remove from source panel
			setPanelState(sourcePanel, (panel) => {
				const views = panel.views.filter(
					(v) => v.instance !== viewToMove.instance,
				);
				const nextActive =
					panel.activeInstance === viewToMove.instance
						? (views[views.length - 1]?.instance ?? null)
						: panel.activeInstance;
				return { views, activeInstance: nextActive };
			});

			// Add to target panel
			setPanelState(
				targetPanel,
				(panel) => ({
					views: [
						...panel.views,
						{
							instance: viewToMove.instance,
							kind: viewToMove.kind,
							state: viewToMove.state,
							launchArgs: viewToMove.launchArgs,
						},
					],
					activeInstance: viewToMove.instance,
				}),
				{ focus: true },
			);
		},
		[leftPanel, centralPanel, rightPanel, setPanelState],
	);

	const handleResizePanel = useCallback(
		(side: PanelSide, size: number) => {
			const panel =
				side === "left" ? leftPanelRef.current : rightPanelRef.current;
			if (!panel) return;

			const clampedSize = Math.max(10, Math.min(40, size));
			setPanelSizes((prev) => ({
				...prev,
				[side]: clampedSize,
			}));

			if (side === "left") {
				setIsLeftCollapsed(clampedSize <= MIN_VISIBLE_PANEL_SIZE);
			} else {
				setIsRightCollapsed(clampedSize <= MIN_VISIBLE_PANEL_SIZE);
			}

			schedulePanelAnimation();
			panel.resize(clampedSize);
		},
		[schedulePanelAnimation],
	);

	const sharedViewContext = useMemo(
		() => ({
			openExtension: handleOpenView,
			openFile: handleOpenFile,
			closeExtension: handleCloseView,
			closeFileViews: handleCloseFileViews,
			checkpointDiff,
			showCheckpointDiff,
			clearCheckpointDiff,
			setTabBadgeCount: () => {},
			moveExtensionToPanel: handleMoveViewToPanel,
			resizePanel: handleResizePanel,
			focusPanel: focusPanel,
			registerNewFileDraftHandler,
			acceptExternalWriteReview: handleAcceptExternalWriteReview,
			rejectExternalWriteReview: handleRejectExternalWriteReview,
			registerExternalWriteReview,
			activeFileId: activeCentralFileId,
			activeFilePath,
			workspace,
			lix,
		}),
		[
			handleOpenView,
			handleOpenFile,
			handleCloseView,
			handleCloseFileViews,
			checkpointDiff,
			showCheckpointDiff,
			clearCheckpointDiff,
			handleMoveViewToPanel,
			handleResizePanel,
			handleAcceptExternalWriteReview,
			handleRejectExternalWriteReview,
			focusPanel,
			registerNewFileDraftHandler,
			activeCentralFileId,
			activeFilePath,
			workspace,
			lix,
			registerExternalWriteReview,
		],
	);

	const leftViewContext = useMemo(
		() => ({
			...sharedViewContext,
			isPanelFocused: isLeftFocused,
		}),
		[sharedViewContext, isLeftFocused],
	);

	const centralViewContext = useMemo(
		() => ({
			...sharedViewContext,
			isPanelFocused: isCentralFocused,
		}),
		[sharedViewContext, isCentralFocused],
	);

	const rightViewContext = useMemo(
		() => ({
			...sharedViewContext,
			isPanelFocused: isRightFocused,
		}),
		[sharedViewContext, isRightFocused],
	);

	useEffect(() => {
		return () => {
			if (animationTimeoutRef.current !== null) {
				window.clearTimeout(animationTimeoutRef.current);
			}
		};
	}, []);

	const toggleLeftSidebar = useCallback(() => {
		const panel = leftPanelRef.current;
		if (!panel) return;
		if (isLeftCollapsed) {
			const desiredSize =
				lastNonZeroSizesRef.current.left > MIN_VISIBLE_PANEL_SIZE
					? lastNonZeroSizesRef.current.left
					: initialLayoutSizes.left;
			const target =
				desiredSize > MIN_VISIBLE_PANEL_SIZE
					? desiredSize
					: DEFAULT_PANEL_FALLBACK_SIZES.left;
			setIsLeftCollapsed(false);
			schedulePanelAnimation();
			panel.resize(target);
		} else {
			setIsLeftCollapsed(true);
			schedulePanelAnimation();
			panel.resize(0);
		}
	}, [isLeftCollapsed, initialLayoutSizes.left, schedulePanelAnimation]);

	const toggleRightSidebar = useCallback(() => {
		const panel = rightPanelRef.current;
		if (!panel) return;
		if (isRightCollapsed) {
			const desiredSize =
				lastNonZeroSizesRef.current.right > MIN_VISIBLE_PANEL_SIZE
					? lastNonZeroSizesRef.current.right
					: initialLayoutSizes.right;
			let target =
				desiredSize > MIN_VISIBLE_PANEL_SIZE
					? desiredSize
					: DEFAULT_PANEL_FALLBACK_SIZES.right;
			target = Math.max(target, MIN_UNCOLLAPSED_RIGHT_SIZE);
			setIsRightCollapsed(false);
			schedulePanelAnimation();
			panel.resize(target);
		} else {
			setIsRightCollapsed(true);
			schedulePanelAnimation();
			panel.resize(0);
		}
	}, [isRightCollapsed, initialLayoutSizes.right, schedulePanelAnimation]);

	const isMacPlatform = useMemo(() => {
		if (typeof navigator === "undefined") return false;
		const platformCandidates = [
			((navigator as any).userAgentData?.platform as string | undefined) ??
				null,
			navigator.platform ?? null,
			navigator.userAgent ?? null,
		].filter(Boolean) as string[];
		const combined = platformCandidates.join(" ").toLowerCase();
		return /mac|iphone|ipad|ipod/.test(combined);
	}, []);

	useEffect(() => {
		const listener = (event: KeyboardEvent) => {
			const usesPrimaryModifier = isMacPlatform
				? event.metaKey && !event.ctrlKey
				: event.ctrlKey && !event.metaKey;
			if (!usesPrimaryModifier || event.altKey || event.shiftKey) return;
			if (isPanelShortcutBlockedTarget(event.target)) return;

			// CMD+1 for left panel
			if (event.key === "1" || event.code === "Digit1") {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation?.();
				event.returnValue = false;
				if (event.type === "keydown" && !event.repeat) {
					toggleLeftSidebar();
				}
				return;
			}

			// CMD+2 for right panel
			if (event.key === "2" || event.code === "Digit2") {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation?.();
				event.returnValue = false;
				if (event.type === "keydown" && !event.repeat) {
					toggleRightSidebar();
				}
				return;
			}
		};

		const options: AddEventListenerOptions = { capture: true, passive: false };
		const eventTypes: Array<"keydown" | "keypress" | "keyup"> = [
			"keydown",
			"keypress",
			"keyup",
		];
		const targets: EventTarget[] = [window, document];
		if (document.body) {
			targets.push(document.body);
		}
		for (const target of targets) {
			for (const type of eventTypes) {
				target.addEventListener(type, listener as EventListener, options);
			}
		}
		return () => {
			for (const target of targets) {
				for (const type of eventTypes) {
					target.removeEventListener(type, listener as EventListener, options);
				}
			}
		};
	}, [isMacPlatform, toggleLeftSidebar, toggleRightSidebar]);

	const animatedPanelClass = shouldAnimatePanels
		? "transition-[flex-basis] duration-200 ease-in-out"
		: undefined;
	const animatedPanelStyle = shouldAnimatePanels
		? PANEL_TRANSITION_STYLE
		: undefined;

	return (
		<DndContext
			sensors={sensors}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
		>
			<div
				className="relative flex flex-col bg-[var(--color-bg-app)] text-[var(--color-text-primary)]"
				style={{
					// Pin the shell to the available viewport (inspector offset included) to avoid vertical scrolling.
					height: "calc(100dvh - var(--lix-inspector-offset, 0px))",
				}}
			>
				<TopBar
					workspaceName={workspaceName}
					activeFileName={activeFileName}
					isReviewingCheckpoint={Boolean(checkpointDiff)}
					onWorkspaceTitleClick={onOpenWorkspace}
					menu={<FlashtypeMenu />}
					onToggleLeftSidebar={toggleLeftSidebar}
					onToggleRightSidebar={toggleRightSidebar}
					isLeftSidebarVisible={!isLeftCollapsed}
					isRightSidebarVisible={!isRightCollapsed}
					isUpdateReady={isUpdateReady}
					onInstallUpdate={onInstallUpdate}
				/>
				<div className="flex flex-1 min-h-0 overflow-hidden px-2 pb-2">
					<PanelGroup direction="horizontal" onLayout={handleLayoutChange}>
						<Panel
							ref={leftPanelRef}
							defaultSize={panelSizes.left}
							minSize={10}
							maxSize={40}
							collapsible
							collapsedSize={0}
							className={animatedPanelClass}
							style={animatedPanelStyle}
						>
							<SidePanel
								side="left"
								title="Navigator"
								panel={leftPanel}
								isFocused={focusedPanel === "left"}
								onFocusPanel={focusPanel}
								onSelectView={handleSelectLeftView}
								onAddView={addViewOnLeft}
								onRemoveView={(key) => handleRemoveView("left", key)}
								viewContext={leftViewContext}
							/>
						</Panel>
						<PanelResizeHandle className="group relative flex w-1.75 items-center justify-center">
							<div className="absolute inset-y-0 left-1/2 h-full w-0.5 -translate-x-1/2 rounded-full bg-[linear-gradient(to_bottom,transparent,color-mix(in_srgb,var(--color-icon-brand)_50%,transparent),transparent)] opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
						</PanelResizeHandle>
						<Panel
							defaultSize={panelSizes.central}
							minSize={30}
							className={animatedPanelClass}
							style={animatedPanelStyle}
						>
							<CentralPanel
								panel={centralPanel}
								isFocused={focusedPanel === "central"}
								onFocusPanel={focusPanel}
								onSelectView={handleSelectCentralView}
								onRemoveView={(key) => handleRemoveView("central", key)}
								onFinalizePendingView={(key) =>
									setPanelState(
										"central",
										(panel) => activatePanelExtension(panel, key),
										{ focus: true },
									)
								}
								viewContext={centralViewContext}
								onCreateNewFile={handleCreateNewFile}
							/>
						</Panel>
						<PanelResizeHandle className="group relative flex w-1.75 items-center justify-center">
							<div className="absolute inset-y-0 left-1/2 h-full w-0.5 -translate-x-1/2 rounded-full bg-[linear-gradient(to_bottom,transparent,color-mix(in_srgb,var(--color-icon-brand)_50%,transparent),transparent)] opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
						</PanelResizeHandle>
						<Panel
							ref={rightPanelRef}
							defaultSize={panelSizes.right}
							minSize={10}
							maxSize={40}
							collapsible
							collapsedSize={0}
							className={animatedPanelClass}
							style={animatedPanelStyle}
						>
							<SidePanel
								side="right"
								title="Secondary"
								panel={rightPanel}
								isFocused={focusedPanel === "right"}
								onFocusPanel={focusPanel}
								onSelectView={handleSelectRightView}
								onAddView={addViewOnRight}
								onRemoveView={(key) => handleRemoveView("right", key)}
								viewContext={rightViewContext}
								preferredAgent={preferredAgent}
							/>
						</Panel>
					</PanelGroup>
				</div>
				<StatusBar
					left={
						<CurrentCheckpointFooterReviewButton
							lix={lix}
							checkpointDiff={checkpointDiff}
							showCheckpointDiff={showCheckpointDiff}
							clearCheckpointDiff={clearCheckpointDiff}
						/>
					}
				/>
			</div>
			<DragOverlay>
				{activeId && activeDragView ? (
					<div className="cursor-grabbing">
						<PanelTabPreview
							icon={activeDragView.icon}
							label={activeDragView.label}
							isActive={true}
							isFocused={true}
						/>
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}
