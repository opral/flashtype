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
import { useKeyValue } from "@/hooks/key-value/use-key-value";
import { normalizeFilePath } from "@/lib/path";
import { SidePanel } from "./side-panel";
import { CentralPanel } from "./central-panel";
import { TopBar } from "./top-bar";
import { StatusBar } from "./status-bar";
import { qb } from "@/lib/lix-kysely";
import {
	WidgetHostRegistryProvider,
	useWidgetHostRegistry,
} from "../widget-runtime/widget-host-registry";
import type {
	PanelSide,
	PanelState,
	DiffWidgetConfig,
	WidgetInstance,
	WidgetKind,
	WidgetLaunchArgs,
	WidgetState,
	WidgetDefinition,
} from "../widget-runtime/types";
import {
	createWidgetInstanceId,
	WidgetRegistryProvider,
	useWidgetRegistry,
} from "../widget-runtime/widget-registry";
import { loadInstalledWidgetsFromLix } from "../widget-runtime/installed-widget-loader";
import { PanelTabPreview } from "./panel-v2";
import {
	buildFileWidgetProps,
	decodeURIComponentSafe,
	DIFF_WIDGET_KIND,
	diffLabelFromPath,
	fileWidgetInstance,
	fileWidgetInstanceForKind,
	FILE_WIDGET_KIND,
	activeMarkdownFileIdFromWidgetInstance,
} from "../widget-runtime/widget-instance-helpers";
import { findFileHandlerWidget } from "../widget-runtime/file-handlers";
import {
	installWidgetFromFiles as installWidgetFromFilesInLix,
	uninstallWidget as uninstallWidgetInLix,
} from "../widget-runtime/widget-installation";
import {
	coerceFlashtypeUiState,
	DEFAULT_FLASHTYPE_UI_STATE,
	FLASHTYPE_UI_STATE_KEY,
	normalizeLayoutSizes,
	type PanelLayoutSizes,
	type FlashtypeUiState,
} from "./ui-state";
import {
	activatePanelWidget,
	upsertPendingWidget,
} from "../widget-runtime/pending-widget";
import { cloneWidgetInstance, reorderPanelWidgetsByIndex } from "./panel-utils";

const stripLaunchArgs = (view: WidgetInstance): WidgetInstance => {
	const { launchArgs: _omitLaunch, ...rest } = view as any;
	const state = sanitizeWidgetStateForPersistence(rest.state);
	if (state === undefined) {
		const { state: _omitState, ...viewWithoutState } = rest;
		return viewWithoutState;
	}
	return { ...rest, state };
};

const sanitizeWidgetStateForPersistence = (
	state: WidgetState | undefined,
): WidgetState | undefined => {
	if (state === undefined) return undefined;
	const sanitized = sanitizeJsonValue(state);
	if (!isPlainObject(sanitized)) return undefined;
	return Object.keys(sanitized).length > 0
		? (sanitized as WidgetState)
		: undefined;
};

const sanitizeJsonValue = (
	value: unknown,
	seen = new WeakSet<object>(),
): unknown => {
	if (value === null || typeof value === "string" || typeof value === "boolean") {
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
	widgetMap: Map<WidgetKind, WidgetDefinition>,
): PanelState => {
	const views = panel.views
		// Drop unknown view keys that might linger in persisted UI state.
		.filter((view) => widgetMap.has(view.kind))
		.map(upgradeDiffProps);
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

const upgradeDiffProps = (view: WidgetInstance): WidgetInstance => {
	if (view.kind !== DIFF_WIDGET_KIND) return view;
	const state = view.state ?? {};
	const fileId = state.fileId as string | undefined;
	if (!fileId) return view;
	const existing = state.diff as DiffWidgetConfig | undefined;
	const nextLabel =
		(state.flashtype?.label as string | undefined) ??
		diffLabelFromPath(state.filePath as string | undefined) ??
		"Unnamed diff";
	if (existing?.query && state.flashtype?.label === nextLabel) {
		return view;
	}
	return {
		...view,
		state: {
			...state,
			flashtype: { ...(state.flashtype ?? {}), label: nextLabel },
			...(existing?.query ? { diff: existing } : {}),
		},
	};
};

const DEFAULT_PANEL_FALLBACK_SIZES = {
	left: 20,
	central: 60,
	right: 20,
};
const MIN_UNCOLLAPSED_RIGHT_SIZE = 35;
const MIN_VISIBLE_PANEL_SIZE = 1;
const INSTALLED_WIDGET_PATH_LIKE = "/.lix_system/app_data/flashtype/widgets/%";
const INSTALLED_WIDGET_OBSERVE_SQL =
	"SELECT path, data FROM lix_file_by_branch WHERE lixcol_branch_id = ? AND path LIKE ?";
const PANEL_TRANSITION_STYLE: CSSProperties = {
	transitionProperty: "flex-grow, flex-basis",
	transitionDuration: "200ms",
	transitionTimingFunction: "ease-in-out",
};

function deriveUntitledMarkdownPathForSuffix(suffix: number | null): string {
	const baseStem = "new-file";
	if (suffix === null) {
		return normalizeFilePath(`/${baseStem}.md`);
	}
	return normalizeFilePath(`/${baseStem}-${suffix}.md`);
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
	return normalizeFilePath(`/new-file-${Date.now()}.md`);
}

export function V2LayoutShell() {
	return (
		<WidgetRegistryProvider>
			<WidgetHostRegistryProvider>
				<LayoutShellContent />
			</WidgetHostRegistryProvider>
		</WidgetRegistryProvider>
	);
}

/**
 * App layout shell with independent left and right islands.
 *
 * @example
 * <V2LayoutShell />
 */
function LayoutShellContent() {
	const { widgetMap, replaceInstalledWidgets, clearInstalledWidgets } =
		useWidgetRegistry();
	const [uiStateKV, setUiStateKV] = useKeyValue(FLASHTYPE_UI_STATE_KEY);
	const [themePreference] = useKeyValue("flashtype_theme");
	const [activeFileId, setActiveFileId] = useKeyValue(
		"flashtype_active_file_id",
	);
	const theme = themePreference === "dark" ? "dark" : "light";
	const lix = useLix();
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
		hydratePanel(sanitizedPersistedPanels.left, widgetMap),
	);
	const [centralPanel, setCentralPanel] = useState<PanelState>(() =>
		hydratePanel(sanitizedPersistedPanels.central, widgetMap),
	);
	const [rightPanel, setRightPanel] = useState<PanelState>(() =>
		hydratePanel(sanitizedPersistedPanels.right, widgetMap),
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
	const viewHostRegistry = useWidgetHostRegistry();

	useEffect(() => {
		const root = document.documentElement;
		root.dataset.theme = theme;
		root.classList.toggle("dark", theme === "dark");
	}, [theme]);

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

		const reloadInstalledWidgets = async () => {
			if (reloadPromise) {
				await reloadPromise;
				return;
			}
			reloadPromise = (async () => {
				try {
					const installed = await loadInstalledWidgetsFromLix(lix);
					if (!cancelled) {
						replaceInstalledWidgets(installed);
					}
				} catch (error) {
					console.warn(
						"[widget-loader] failed to load installed widgets",
						error,
					);
					if (!cancelled) {
						clearInstalledWidgets();
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
				void reloadInstalledWidgets();
			}, 150);
		};

		void reloadInstalledWidgets();

		const observeEvents = lix.observe({
			sql: INSTALLED_WIDGET_OBSERVE_SQL,
			params: ["global", INSTALLED_WIDGET_PATH_LIKE],
		});

		void (async () => {
			try {
				while (!cancelled) {
					const event = await observeEvents.next();
					if (cancelled || !event) break;
					scheduleReload();
				}
			} catch (error) {
				if (!cancelled) {
					console.warn("[widget-loader] observe failed", error);
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
	}, [lix, replaceInstalledWidgets, clearInstalledWidgets]);

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
				: hydratePanel(sanitizedPersistedPanels.left, widgetMap),
		);
		setCentralPanel((prev) =>
			prev === sanitizedPersistedPanels.central
				? prev
				: hydratePanel(sanitizedPersistedPanels.central, widgetMap),
		);
		setRightPanel((prev) =>
			prev === sanitizedPersistedPanels.right
				? prev
				: hydratePanel(sanitizedPersistedPanels.right, widgetMap),
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
	}, [uiStateKV, sanitizedPersistedPanels, updateDerivedPanelState, widgetMap]);

	useEffect(() => {
		setLeftPanel((current) => hydratePanel(current, widgetMap));
		setCentralPanel((current) => hydratePanel(current, widgetMap));
		setRightPanel((current) => hydratePanel(current, widgetMap));
	}, [widgetMap]);

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
				hydratePanel(reducer(hydratePanel(prev, widgetMap)), widgetMap);
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
		[setLeftPanel, setCentralPanel, setRightPanel, setFocusedPanel, widgetMap],
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
			kind: WidgetKind;
			state?: WidgetState;
			launchArgs?: WidgetLaunchArgs;
			focus?: boolean;
			instance?: string;
			pending?: boolean;
		}) => {
			ensurePanelExpanded(panel);
			setPanelState(
				panel,
				(current) => {
					if (pending) {
						const targetInstance = instance ?? createWidgetInstanceId(kind);
						const nextView: WidgetInstance = {
							instance: targetInstance,
							kind,
							state,
							launchArgs,
							isPending: true,
						};
						return upsertPendingWidget(current, nextView, { activate: true });
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
					const targetInstance = instance ?? createWidgetInstanceId(kind);
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
					const nextView: WidgetInstance = {
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

	const handleOpenFile = useCallback(
		({
			panel,
			fileId,
			filePath,
			state,
			focus = true,
			pending = false,
		}: {
			panel: PanelSide;
			fileId: string;
			filePath: string;
			state?: WidgetState;
			focus?: boolean;
			pending?: boolean;
		}) => {
			const handler =
				findFileHandlerWidget(widgetMap.values(), filePath) ??
				widgetMap.get(FILE_WIDGET_KIND);
			const kind = handler?.kind ?? FILE_WIDGET_KIND;
			handleOpenView({
				panel,
				kind,
				instance: fileWidgetInstanceForKind(kind, fileId),
				state: {
					...buildFileWidgetProps({ fileId, filePath }),
					...(state ?? {}),
				},
				focus,
				pending,
			});
		},
		[handleOpenView, widgetMap],
	);

	const handleCloseView = useCallback(
		({
			panel,
			instance,
			kind,
		}: {
			panel?: PanelSide;
			instance?: string;
			kind?: WidgetKind;
		}) => {
			if (!instance && !kind) return;
			const predicate = (entry: WidgetInstance) => {
				if (instance) return entry.instance === instance;
				if (kind) return entry.kind === kind;
				return false;
			};
			const targetPanels: PanelSide[] = panel
				? [panel]
				: (["central", "left", "right"] as PanelSide[]);
			for (const side of targetPanels) {
				let removed = false;
				setPanelState(side, (current) => {
					const index = current.views.findIndex(predicate);
					if (index === -1) return current;
					removed = true;
					const views = current.views.filter((_, idx) => idx !== index);
					const removedView = current.views[index];
					const activeInstance =
						current.activeInstance === removedView.instance
							? (views[views.length - 1]?.instance ?? null)
							: current.activeInstance;
					return { views, activeInstance };
				});
				if (removed) break;
			}
		},
		[setPanelState],
	);

	const handleAddView = useCallback(
		(side: PanelSide, kind: WidgetKind) => {
			handleOpenView({ panel: side, kind });
		},
		[handleOpenView],
	);

	const focusPanel = useCallback((side: PanelSide) => {
		setFocusedPanel((prev) => (prev === side ? prev : side));
	}, []);

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
				| { instance: string; kind: WidgetKind; fromPanel: PanelSide }
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
						return reorderPanelWidgetsByIndex(panel, fromIndex, toIndex);
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
			const movedView = cloneWidgetInstance(sourcePanel, instance);

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
		? widgetMap.get(activeDragData.kind)
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
		handleOpenFile({
			panel: "central",
			fileId: id,
			filePath: path,
			focus: true,
		});
	}, [handleOpenFile, lix]);

	const activeCentralEntry = useMemo(() => {
		const activeInstance =
			centralPanel.activeInstance ?? centralPanel.views[0]?.instance ?? null;
		if (!activeInstance) return null;
		return (
			centralPanel.views.find((entry) => entry.instance === activeInstance) ??
			null
		);
	}, [centralPanel]);
	const activeCentralFileId =
		activeMarkdownFileIdFromWidgetInstance(activeCentralEntry);

	useEffect(() => {
		if (!activeCentralFileId) return;
		if (activeFileId === activeCentralFileId) return;
		void setActiveFileId(activeCentralFileId);
	}, [activeCentralFileId, activeFileId, setActiveFileId]);

	const activeStatusLabel = useMemo(() => {
		if (!activeCentralEntry) return null;
		const rawPath = activeCentralEntry.state?.filePath as string | undefined;
		if (rawPath) {
			const parts = rawPath.split("/").map((segment, index) => {
				if (index === 0 && segment === "") return "";
				return decodeURIComponentSafe(segment);
			});
			const decoded = parts.join("/");
			return decoded.length > 0 ? decoded : rawPath;
		}
		return (
			(activeCentralEntry.state?.flashtype?.label as string | undefined) ??
			widgetMap.get(activeCentralEntry.kind)?.label ??
			null
		);
	}, [activeCentralEntry, widgetMap]);

	const isLeftFocused = focusedPanel === "left";
	const isCentralFocused = focusedPanel === "central";
	const isRightFocused = focusedPanel === "right";

	const addViewOnLeft = useCallback(
		(type: WidgetKind) => handleAddView("left", type),
		[handleAddView],
	);

	const addViewOnRight = useCallback(
		(type: WidgetKind) => handleAddView("right", type),
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
			setPanelState("central", (panel) => activatePanelWidget(panel, key), {
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
			setPanelState(
				side,
				(panel) => {
					const targetView = panel.views.find(
						(entry) => entry.instance === instance,
					);
					if (!targetView) {
						return panel;
					}
					let views = panel.views.filter(
						(entry) => entry.instance !== instance,
					);
					if (
						side === "central" &&
						targetView.kind === DIFF_WIDGET_KIND &&
						views.length === 0
					) {
						const fileId = targetView.state?.fileId
							? String(targetView.state.fileId)
							: null;
						if (fileId) {
							const filePath =
								typeof targetView.state?.filePath === "string"
									? (targetView.state.filePath as string)
									: undefined;
							const fallbackView: WidgetInstance = {
								instance: fileWidgetInstance(fileId),
								kind: FILE_WIDGET_KIND,
								isPending: true,
								state: buildFileWidgetProps({ fileId, filePath }),
							};
							views = [fallbackView];
							return {
								views,
								activeInstance: fallbackView.instance,
							};
						}
					}
					const nextActive =
						panel.activeInstance === instance
							? (views[views.length - 1]?.instance ?? null)
							: panel.activeInstance;
					return { views, activeInstance: nextActive };
				},
				{ focus: true },
			),
		[setPanelState],
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

	const handleInstallWidgetFromFiles = useCallback(
		async (args: {
			readonly widgetId: string;
			readonly files: ReadonlyArray<{
				readonly path: string;
				readonly data: string | Uint8Array;
			}>;
		}) => {
			await installWidgetFromFilesInLix(lix, args);
		},
		[lix],
	);

	const handleUninstallWidget = useCallback(
		async (widgetId: string) => {
			await uninstallWidgetInLix(lix, widgetId);
		},
		[lix],
	);

	const sharedViewContext = useMemo(
		() => ({
			openWidget: handleOpenView,
			openFile: handleOpenFile,
			closeWidget: handleCloseView,
			setTabBadgeCount: () => {},
			moveWidgetToPanel: handleMoveViewToPanel,
			installWidgetFromFiles: handleInstallWidgetFromFiles,
			uninstallWidget: handleUninstallWidget,
			resizePanel: handleResizePanel,
			focusPanel: focusPanel,
			lix,
		}),
		[
			handleOpenView,
			handleOpenFile,
			handleCloseView,
			handleMoveViewToPanel,
			handleInstallWidgetFromFiles,
			handleUninstallWidget,
			handleResizePanel,
			focusPanel,
			lix,
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

	const isInteractiveTarget = useCallback(
		(target: EventTarget | null): boolean => {
			if (!target || !(target instanceof HTMLElement)) return false;
			const tagName = target.tagName.toLowerCase();
			const isInput =
				tagName === "input" ||
				tagName === "textarea" ||
				tagName === "select" ||
				target.isContentEditable;
			return isInput;
		},
		[],
	);

	useEffect(() => {
		const listener = (event: KeyboardEvent) => {
			const usesPrimaryModifier = isMacPlatform
				? event.metaKey && !event.ctrlKey
				: event.ctrlKey && !event.metaKey;
			if (!usesPrimaryModifier || event.altKey || event.shiftKey) return;

			// CMD+1 for left panel
			if (event.key === "1" || event.code === "Digit1") {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation?.();
				event.returnValue = false;
				if (
					event.type === "keydown" &&
					!event.repeat &&
					!isInteractiveTarget(event.target)
				) {
					toggleLeftSidebar();
				}
				return;
			}

			// CMD+3 for right panel
			if (event.key === "3" || event.code === "Digit3") {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation?.();
				event.returnValue = false;
				if (
					event.type === "keydown" &&
					!event.repeat &&
					!isInteractiveTarget(event.target)
				) {
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
	}, [
		isMacPlatform,
		toggleLeftSidebar,
		toggleRightSidebar,
		isInteractiveTarget,
	]);

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
				className="relative flex flex-col bg-neutral-100 text-neutral-900"
				style={{
					// Pin the shell to the available viewport (inspector offset included) to avoid vertical scrolling.
					height: "calc(100dvh - var(--lix-inspector-offset, 0px))",
				}}
			>
				<TopBar
					onToggleLeftSidebar={toggleLeftSidebar}
					onToggleRightSidebar={toggleRightSidebar}
					isLeftSidebarVisible={!isLeftCollapsed}
					isRightSidebarVisible={!isRightCollapsed}
				/>
				<div className="flex flex-1 min-h-0 overflow-hidden px-2 gap-4">
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
								onSelectWidget={handleSelectLeftView}
								onAddView={addViewOnLeft}
								onRemoveWidget={(key) => handleRemoveView("left", key)}
								viewContext={leftViewContext}
							/>
						</Panel>
						<PanelResizeHandle className="relative w-1 flex items-center justify-center group">
							<div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 h-full rounded-full bg-gradient-to-b from-transparent via-brand-600/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
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
								onSelectWidget={handleSelectCentralView}
								onRemoveWidget={(key) => handleRemoveView("central", key)}
								onFinalizePendingView={(key) =>
									setPanelState(
										"central",
										(panel) => activatePanelWidget(panel, key),
										{ focus: true },
									)
								}
								viewContext={centralViewContext}
								onCreateNewFile={handleCreateNewFile}
							/>
						</Panel>
						<PanelResizeHandle className="relative w-1 flex items-center justify-center group">
							<div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 h-full rounded-full bg-gradient-to-b from-transparent via-brand-600/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
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
								onSelectWidget={handleSelectRightView}
								onAddView={addViewOnRight}
								onRemoveWidget={(key) => handleRemoveView("right", key)}
								viewContext={rightViewContext}
							/>
						</Panel>
					</PanelGroup>
				</div>
				<StatusBar activePath={activeStatusLabel} />
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
