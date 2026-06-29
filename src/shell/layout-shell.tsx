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
import { useLix, useQueryTakeFirst } from "@/lib/lix-react";
import type { Lix } from "@/lib/lix-types";
import { useKeyValue } from "@/hooks/key-value/use-key-value";
import { ACTIVE_FILE_ID_KEY } from "@/hooks/key-value/schema";
import { SidePanel } from "./side-panel";
import { CentralPanel } from "./central-panel";
import { TopBar } from "./top-bar";
import { FlashtypeMenu } from "./top-bar/flashtype-menu";
import { BranchSwitcher } from "./top-bar/branch-switcher";
import { StatusBar } from "./status-bar";
import type { ExternalWriteReview } from "@/extension-runtime/external-write-review";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import { qb } from "@/lib/lix-kysely";
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
	activeMarkdownFileIdFromExtensionInstance,
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
import { buildAgentLaunchArgsWithActiveFile } from "./agent-launch";
import {
	AGENT_TURN_COMMIT_RANGE_KEY,
	clearAgentTurnCommitRangeFile,
	appendAgentTurnCommitRange,
	isAgentTurnCommitRangeStore,
	readAgentTurnCommitRanges,
	type AgentTurnCommitRange,
} from "./agent-turn-review-range";
import {
	getFileDataAtCommit,
	getFirstPendingExternalWriteReviewFile,
	getPendingExternalWriteReviewForFile,
} from "./external-write-review-history";

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

type ResolvedFileViewOpenResult = {
	readonly kind: ExtensionKind;
	readonly instance: string;
};

type AgentDiffReturnTarget = {
	readonly openedInstance: string;
	readonly previousActiveFileId: string | null;
	readonly previousActiveInstance: string | null;
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
): Record<PanelSide, PanelState> => ({
	left: {
		views: panels.left.views.map(stripLaunchArgs),
		activeInstance: panels.left.activeInstance,
	},
	central: {
		views: panels.central.views.map(stripLaunchArgs),
		activeInstance: panels.central.activeInstance,
	},
	right: {
		views: panels.right.views.map(stripLaunchArgs),
		activeInstance: panels.right.activeInstance,
	},
});

const hydratePanel = (
	panel: PanelState,
	extensionMap: Map<ExtensionKind, ExtensionDefinition>,
	options: { preserveUnknownKinds?: boolean } = {},
): PanelState => {
	const views = panel.views
		// Drop unknown view keys that might linger in persisted UI state.
		.filter(
			(view) => options.preserveUnknownKinds || extensionMap.has(view.kind),
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
	const [activeFileId, setActiveFileId] = useKeyValue(ACTIVE_FILE_ID_KEY);
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
	const sanitizedPersistedPanels = useMemo(
		() => sanitizePanels(uiState.panels),
		[uiState],
	);

	const [leftPanel, setLeftPanel] = useState<PanelState>(() =>
		hydratePanel(sanitizedPersistedPanels.left, extensionMap, {
			preserveUnknownKinds: true,
		}),
	);
	const [centralPanel, setCentralPanel] = useState<PanelState>(() =>
		hydratePanel(sanitizedPersistedPanels.central, extensionMap, {
			preserveUnknownKinds: true,
		}),
	);
	const [rightPanel, setRightPanel] = useState<PanelState>(() =>
		hydratePanel(sanitizedPersistedPanels.right, extensionMap, {
			preserveUnknownKinds: true,
		}),
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
	const agentDiffReturnTargetsRef = useRef(
		new Map<string, AgentDiffReturnTarget>(),
	);
	const agentDiffReturnTargetsByFileIdRef = useRef(
		new Map<string, AgentDiffReturnTarget>(),
	);
	const resolveDiffReviewTelemetryRef = useRef<
		| ((
				review: ExternalWriteReview,
				outcome: "accepted" | "abandoned" | "rejected",
		  ) => boolean)
		| null
	>(null);
	const activeAgentTurnsRef = useRef(new Map<string, ActiveAgentTurn>());
	const openFirstAgentDiffForRangeRef = useRef<
		((range: AgentTurnCommitRange) => Promise<void>) | null
	>(null);
	const autoOpenedAgentRangeIdsRef = useRef(new Set<string>());
	const hasSeededAutoOpenedAgentRangesRef = useRef(false);
	const workspaceIdRef = useRef<string | undefined>(undefined);
	const panelStatesRef = useRef({
		left: leftPanel,
		central: centralPanel,
		right: rightPanel,
	});
	const viewHostRegistry = useExtensionHostRegistry();

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

	const agentTurnCommitRangeRow = useQueryTakeFirst<{ value: unknown }>((lix) =>
		qb(lix)
			.selectFrom("lix_key_value_by_branch")
			.select("value")
			.where("key", "=", AGENT_TURN_COMMIT_RANGE_KEY)
			.where("lixcol_branch_id", "=", "global")
			.limit(1),
	);
	const agentTurnCommitRanges = useMemo(
		() =>
			isAgentTurnCommitRangeStore(agentTurnCommitRangeRow?.value)
				? agentTurnCommitRangeRow.value.ranges
				: [],
		[agentTurnCommitRangeRow?.value],
	);

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
		async (event: AgentHookTurnEvent) => {
			const key = agentTurnKey(event);
			if (event.phase === "turn-start") {
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
				return;
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
					autoOpenedAgentRangeIdsRef.current.add(range.id);
					try {
						await openFirstAgentDiffForRangeRef.current?.(range);
					} catch (error: unknown) {
						console.warn(
							"[agent-turn-review] failed to open changed file review",
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
		[lix],
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
		JSON.stringify({
			focusedPanel: uiState.focusedPanel,
			panels: sanitizedPersistedPanels,
			layout: { sizes: initialLayoutSizes },
		} satisfies FlashtypeUiState),
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
				: hydratePanel(
						sanitizedPersistedPanels.left,
						extensionMap,
						hydrateOptions,
					),
		);
		setCentralPanel((prev) =>
			prev === sanitizedPersistedPanels.central
				? prev
				: hydratePanel(
						sanitizedPersistedPanels.central,
						extensionMap,
						hydrateOptions,
					),
		);
		setRightPanel((prev) =>
			prev === sanitizedPersistedPanels.right
				? prev
				: hydratePanel(
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
			hydratePanel(current, extensionMap, hydrateOptions),
		);
		setCentralPanel((current) =>
			hydratePanel(current, extensionMap, hydrateOptions),
		);
		setRightPanel((current) =>
			hydratePanel(current, extensionMap, hydrateOptions),
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
			const applyReducer = (prev: PanelState) =>
				hydratePanel(
					reducer(
						hydratePanel(prev, extensionMap, {
							preserveUnknownKinds: !hasLoadedInstalledExtensions,
						}),
					),
					extensionMap,
					{ preserveUnknownKinds: !hasLoadedInstalledExtensions },
				);
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
			panel,
			fileId,
			filePath,
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
			state?: ExtensionState;
			launchArgs?: ExtensionLaunchArgs;
			focus?: boolean;
			pending?: boolean;
			documentOrigin?: "existing" | "new";
			trackTelemetry?: boolean;
			trackDocumentOpenAttempt?: boolean;
			trackDocumentViewed?: boolean;
		}): ResolvedFileViewOpenResult => {
			const handler =
				findFileHandlerExtension(extensionMap.values(), filePath) ?? undefined;
			const kind = handler?.kind ?? FILE_EXTENSION_KIND;
			const instance = fileExtensionInstanceForKind(kind, fileId);
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
				panel,
				kind,
				instance,
				state: {
					...buildFileExtensionProps({ fileId, filePath }),
					...(state ?? {}),
				},
				launchArgs,
				focus,
				pending,
			});
			return { kind, instance };
		},
		[handleOpenView, extensionMap, captureWorkspaceTelemetry],
	);

	const openFirstAgentDiffForRange = useCallback(
		async (range: AgentTurnCommitRange) => {
			const storedRanges = await readAgentTurnCommitRanges(lix);
			const ranges = storedRanges.some((candidate) => candidate.id === range.id)
				? storedRanges
				: [...storedRanges, range];
			const file = await getFirstPendingExternalWriteReviewFile(
				lix,
				range,
				ranges,
			);
			if (!file) return;
			const review = await getPendingExternalWriteReviewForFile(
				lix,
				file,
				ranges,
			);
			if (!review) return;
			const currentCentralPanel = panelStatesRef.current.central;
			const previousActiveInstance =
				currentCentralPanel.activeInstance ??
				currentCentralPanel.views[0]?.instance ??
				null;
			const previousActiveEntry = previousActiveInstance
				? (currentCentralPanel.views.find(
						(entry) => entry.instance === previousActiveInstance,
					) ?? null)
				: null;
			const previousActiveFileId =
				activeMarkdownFileIdFromExtensionInstance(previousActiveEntry);
			const openedView = openResolvedFileView({
				panel: "central",
				fileId: file.fileId,
				filePath: file.path,
				focus: true,
				trackDocumentOpenAttempt: true,
				trackDocumentViewed: true,
			});
			const target =
				agentDiffReturnTargetsByFileIdRef.current.get(file.fileId) ??
				({
					openedInstance: openedView.instance,
					previousActiveFileId,
					previousActiveInstance,
				} satisfies AgentDiffReturnTarget);
			agentDiffReturnTargetsByFileIdRef.current.set(file.fileId, target);
			agentDiffReturnTargetsRef.current.set(review.reviewId, target);
			void setActiveFileId(file.fileId);
		},
		[lix, openResolvedFileView, setActiveFileId],
	);
	openFirstAgentDiffForRangeRef.current = openFirstAgentDiffForRange;

	useEffect(() => {
		if (!hasSeededAutoOpenedAgentRangesRef.current) {
			for (const range of agentTurnCommitRanges) {
				autoOpenedAgentRangeIdsRef.current.add(range.id);
			}
			hasSeededAutoOpenedAgentRangesRef.current = true;
			return;
		}
		for (const range of agentTurnCommitRanges) {
			if (autoOpenedAgentRangeIdsRef.current.has(range.id)) continue;
			autoOpenedAgentRangeIdsRef.current.add(range.id);
			void openFirstAgentDiffForRange(range).catch((error: unknown) => {
				console.warn(
					"[agent-turn-review] failed to open changed file review",
					error,
				);
			});
		}
	}, [agentTurnCommitRanges, openFirstAgentDiffForRange]);

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
		}) => {
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

	const restoreAgentDiffReturnTarget = useCallback(
		(review: ExternalWriteReview) => {
			const target = agentDiffReturnTargetsRef.current.get(review.reviewId);
			if (!target) return;
			for (const [
				reviewId,
				storedTarget,
			] of agentDiffReturnTargetsRef.current) {
				if (storedTarget === target) {
					agentDiffReturnTargetsRef.current.delete(reviewId);
				}
			}
			agentDiffReturnTargetsByFileIdRef.current.delete(review.fileId);
			setPanelState(
				"central",
				(current) => {
					const views =
						target.previousActiveInstance === null
							? current.views.filter(
									(entry) => entry.instance !== target.openedInstance,
								)
							: current.views;
					const previousViewExists =
						target.previousActiveInstance !== null &&
						views.some(
							(entry) => entry.instance === target.previousActiveInstance,
						);
					const activeInstance = previousViewExists
						? target.previousActiveInstance
						: null;
					return { views, activeInstance };
				},
				{ focus: true },
			);
			void setActiveFileId(target.previousActiveFileId);
		},
		[setActiveFileId, setPanelState],
	);

	const resolveExternalWriteReview = useCallback(
		(
			review: ExternalWriteReview,
			outcome: "accepted" | "abandoned" | "rejected",
		) => {
			const resolved = resolveDiffReviewTelemetry(review, outcome);
			restoreAgentDiffReturnTarget(review);
			return resolved;
		},
		[resolveDiffReviewTelemetry, restoreAgentDiffReturnTarget],
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
			resolveExternalWriteReview(review, outcome);
		},
		[
			lix,
			getExternalWriteReviewForFile,
			isExternalWriteReviewCurrent,
			resolveExternalWriteReview,
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
				resolveExternalWriteReview(review, "abandoned");
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
				resolveExternalWriteReview(review, "abandoned");
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
				resolveExternalWriteReview(review, "rejected");
			} else {
				resolveExternalWriteReview(review, "abandoned");
			}
		},
		[
			lix,
			getExternalWriteReviewForFile,
			isExternalWriteReviewCurrent,
			resolveExternalWriteReview,
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
						resolveExternalWriteReview(review, "abandoned");
					}
					break;
				}
			}
		},
		[setPanelState, resolveExternalWriteReview],
	);

	const handleCloseFileViews = useCallback(
		({ panel, fileId }: { panel?: PanelSide; fileId: string }) => {
			const targetPanels: PanelSide[] = panel
				? [panel]
				: (["central", "left", "right"] as PanelSide[]);
			const matchesFileView = (entry: ExtensionInstance) => {
				if (entry.state?.fileId !== fileId) return false;
				if (typeof entry.state.filePath !== "string") return false;
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
					resolveExternalWriteReview(removedReview, "abandoned");
				}
			}
		},
		[setPanelState, resolveExternalWriteReview],
	);

	const activeCentralEntry = useMemo(() => {
		const activeInstance =
			centralPanel.activeInstance ?? centralPanel.views[0]?.instance ?? null;
		if (!activeInstance) return null;
		return (
			centralPanel.views.find((entry) => entry.instance === activeInstance) ??
			null
		);
	}, [centralPanel]);

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

	const activeCentralFileId =
		activeMarkdownFileIdFromExtensionInstance(activeCentralEntry);

	useEffect(() => {
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
		if (!activeCentralEntry) return null;
		const rawPath = activeCentralEntry.state?.filePath;
		return typeof rawPath === "string" && rawPath.length > 0 ? rawPath : null;
	}, [activeCentralEntry]);

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
			setTabBadgeCount: () => {},
			moveExtensionToPanel: handleMoveViewToPanel,
			resizePanel: handleResizePanel,
			focusPanel: focusPanel,
			registerNewFileDraftHandler,
			acceptExternalWriteReview: handleAcceptExternalWriteReview,
			rejectExternalWriteReview: handleRejectExternalWriteReview,
			registerExternalWriteReview,
			workspace,
			lix,
		}),
		[
			handleOpenView,
			handleOpenFile,
			handleCloseView,
			handleCloseFileViews,
			handleMoveViewToPanel,
			handleResizePanel,
			handleAcceptExternalWriteReview,
			handleRejectExternalWriteReview,
			focusPanel,
			registerNewFileDraftHandler,
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
					onWorkspaceTitleClick={onOpenWorkspace}
					menu={<FlashtypeMenu />}
					onToggleLeftSidebar={toggleLeftSidebar}
					onToggleRightSidebar={toggleRightSidebar}
					isLeftSidebarVisible={!isLeftCollapsed}
					isRightSidebarVisible={!isRightCollapsed}
					isUpdateReady={isUpdateReady}
					onInstallUpdate={onInstallUpdate}
				/>
				<div className="flex flex-1 min-h-0 overflow-hidden px-2">
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
							/>
						</Panel>
					</PanelGroup>
				</div>
				<StatusBar left={<BranchSwitcher />} />
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
