import type { PanelSide, PanelState } from "../extension-runtime/types";
import { FILES_EXTENSION_KIND } from "../extension-runtime/extension-instance-helpers";

export const FLASHTYPE_UI_STATE_KEY = "flashtype_ui_state" as const;

/**
 * Serialized layout snapshot persisted in Lix under `flashtype_ui_state`.
 *
 * The structure mirrors the in-memory panel model so we can revive the exact
 * view arrangement (active views, props, focused panel, and optional
 * panel sizes) when the prototype boots.
 *
 * @example
 * const uiState: FlashtypeUiState = {
 *   focusedPanel: "left",
 *   panels: {
 *     left: { views: [...], activeInstance: "files-1" },
 *     central: { views: [], activeInstance: null },
 *     right: { views: [], activeInstance: null },
 *   },
 *   layout: { sizes: { left: 20, central: 60, right: 20 } },
 * };
 */
export type FlashtypeUiState = {
	readonly focusedPanel: PanelSide;
	readonly panels: Record<PanelSide, PanelState>;
	readonly layout?: {
		/**
		 * Last known splitter percentages per panel side (0–100 range).
		 */
		readonly sizes?: Partial<Record<PanelSide, number>>;
	};
};

/**
 * Default UI state used when no persisted snapshot exists in Lix.
 */
export type PanelLayoutSizes = Record<PanelSide, number>;

// Design flex ratios: Files 20 / Editor 50 / Agent 30 — a fresh workspace
// opens with all three islands visible.
const DEFAULT_LAYOUT_SIZES: PanelLayoutSizes = {
	left: 20,
	central: 50,
	right: 30,
};

export const DEFAULT_FLASHTYPE_UI_STATE: FlashtypeUiState = {
	focusedPanel: "central",
	panels: {
		left: {
			views: [{ instance: "files-default", kind: FILES_EXTENSION_KIND }],
			activeInstance: "files-default",
		},
		central: { views: [], activeInstance: null },
		right: { views: [], activeInstance: null },
	},
	layout: { sizes: { ...DEFAULT_LAYOUT_SIZES } },
};

function isPanelSide(value: unknown): value is PanelSide {
	return value === "left" || value === "central" || value === "right";
}

function isViewInstance(value: unknown): value is PanelState["views"][number] {
	if (!value || typeof value !== "object") {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.instance === "string" &&
		typeof candidate.kind === "string" &&
		(candidate.isPending === undefined ||
			typeof candidate.isPending === "boolean")
	);
}

function coercePanelState(raw: unknown, fallback: PanelState): PanelState {
	if (!raw || typeof raw !== "object") {
		return fallback;
	}
	const candidate = raw as Record<string, unknown>;
	const views = Array.isArray(candidate.views)
		? candidate.views.filter(isViewInstance)
		: fallback.views;
	const activeInstance =
		typeof candidate.activeInstance === "string" ||
		candidate.activeInstance === null
			? candidate.activeInstance
			: fallback.activeInstance;
	return { views, activeInstance };
}

/**
 * Coerces persisted key-value payloads into a safe `FlashtypeUiState`.
 *
 * Falls back to defaults for stale/invalid shapes so app boot does not crash.
 */
export function coerceFlashtypeUiState(raw: unknown): FlashtypeUiState {
	if (!raw || typeof raw !== "object") {
		return DEFAULT_FLASHTYPE_UI_STATE;
	}

	const candidate = raw as Record<string, unknown>;
	const panelsCandidate =
		candidate.panels && typeof candidate.panels === "object"
			? (candidate.panels as Record<string, unknown>)
			: {};
	const layoutCandidate =
		candidate.layout && typeof candidate.layout === "object"
			? (candidate.layout as Record<string, unknown>)
			: {};

	const focusedPanel = isPanelSide(candidate.focusedPanel)
		? candidate.focusedPanel
		: DEFAULT_FLASHTYPE_UI_STATE.focusedPanel;

	return {
		focusedPanel,
		panels: {
			left: coercePanelState(
				panelsCandidate.left,
				DEFAULT_FLASHTYPE_UI_STATE.panels.left,
			),
			central: coercePanelState(
				panelsCandidate.central,
				DEFAULT_FLASHTYPE_UI_STATE.panels.central,
			),
			right: coercePanelState(
				panelsCandidate.right,
				DEFAULT_FLASHTYPE_UI_STATE.panels.right,
			),
		},
		layout: {
			sizes: normalizeLayoutSizes(
				(layoutCandidate.sizes as
					| Partial<Record<PanelSide, number>>
					| undefined) ?? undefined,
			),
		},
	};
}

export function normalizeLayoutSizes(
	sizes?: Partial<Record<PanelSide, number>>,
): PanelLayoutSizes {
	return {
		left: sizes?.left ?? DEFAULT_LAYOUT_SIZES.left,
		central: sizes?.central ?? DEFAULT_LAYOUT_SIZES.central,
		right: sizes?.right ?? DEFAULT_LAYOUT_SIZES.right,
	};
}
