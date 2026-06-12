import type { LucideIcon } from "lucide-react";
import type { Lix } from "@/lib/lix-types";
import type { LixQueryLike } from "@/lib/lix-kysely";

/**
 * Union of registry keys for views available in the layout.
 *
 * @example
 * const activeView: WidgetKind = "flashtype_files";
 */
export type WidgetKind = string;

/**
 * Persisted view state. Only include values that should survive reloads.
 *
 * @example
 * const state: WidgetState = { fileId: "file-123", filePath: "/docs/guide.md" };
 */
export type WidgetState = {
	/**
	 * Flashtype-managed metadata (reserved namespace).
	 */
	readonly flashtype?: {
		readonly label?: string;
		/** Key into the shell's per-instance tab icon set (e.g. "claude"). */
		readonly icon?: string;
	};
	readonly [key: string]: unknown;
};

/**
 * One-shot launch-time arguments that must not be persisted.
 *
 * @example
 * const launchArgs: WidgetLaunchArgs = { initialMessage: "Summarize changes" };
 */
export type WidgetLaunchArgs = Record<string, unknown>;

/**
 * Declares how a diff view should source its data.
 *
 * @example
 * const query = (lix: Lix) => selectRenderableDiffs(lix, fileId);
 */
export type RenderableDiff = {
	readonly entity_id: string;
	readonly schema_key: string;
	readonly status: "added" | "modified" | "removed";
	readonly before_snapshot_content: Record<string, any> | null;
	readonly after_snapshot_content: Record<string, any> | null;
};

export type DiffWidgetConfig = {
	readonly title?: string;
	readonly subtitle?: string;
	readonly query: (lix: Lix) => LixQueryLike<RenderableDiff>;
};

/**
 * Per-panel instance payload used to track which views are open.
 *
 * @example
 * const instance: WidgetInstance = { instance: "files-1", kind: "flashtype_files" };
 */
export interface WidgetInstance {
	readonly instance: string;
	readonly kind: WidgetKind;
	readonly isPending?: boolean;
	/**
	 * Persisted view state (serializable).
	 */
	readonly state?: WidgetState;
	/**
	 * Transient launch args (never persisted).
	 */
	readonly launchArgs?: WidgetLaunchArgs;
}

/**
 * Shape of the static metadata that powers the view switcher UI.
 *
 * @example
 * const filesView: WidgetDefinition = WIDGET_DEFINITIONS[0];
 */
export interface WidgetDefinition {
	readonly kind: WidgetKind;
	readonly label: string;
	readonly description: string;
	readonly icon: LucideIcon;
	/**
	 * Lowercase file extensions this widget can render when a file is opened.
	 *
	 * @example
	 * fileExtensions: ["md", "markdown"]
	 */
	readonly fileExtensions?: readonly string[];
	/**
	 * Allows several instances of this widget in one panel (e.g. multiple
	 * agent terminal sessions). Single-instance kinds are hidden from the
	 * add-view menu once open.
	 */
	readonly multiInstance?: boolean;
	readonly activate?: (args: {
		context: WidgetContext;
		instance: WidgetInstance;
	}) => void | (() => void);
	readonly render: (args: {
		context: WidgetContext;
		instance: WidgetInstance;
		target: HTMLElement;
	}) => void | (() => void);
}

/**
 * Context passed to views for interacting with the layout.
 *
 * The host sets `isActiveView` when the view's tab is visible so consumers can
 * avoid mutating shared state while hidden.
 *
 * @example
 * context.openWidget?.({
 *   panel: "central",
 *   kind: "file-content",
 *   instance: "file-content:file-123",
 *   state: { fileId: "file-123", filePath: "/docs/guide.md" },
 *   pending: true,
 * });
 */
export interface WidgetContext {
	readonly openWidget?: (args: {
		readonly panel: PanelSide;
		readonly kind: WidgetKind;
		readonly state?: WidgetState;
		readonly launchArgs?: WidgetLaunchArgs;
		readonly focus?: boolean;
		readonly instance?: string;
		readonly pending?: boolean;
	}) => void;
	readonly openFile?: (args: {
		readonly panel: PanelSide;
		readonly fileId: string;
		readonly filePath: string;
		readonly state?: WidgetState;
		readonly focus?: boolean;
		readonly pending?: boolean;
	}) => void;
	readonly closeWidget?: (args: {
		readonly panel?: PanelSide;
		readonly instance?: string;
		readonly kind?: WidgetKind;
	}) => void;
	readonly isPanelFocused?: boolean;
	readonly setTabBadgeCount: (count: number | null | undefined) => void;
	readonly moveWidgetToPanel?: (
		targetPanel: PanelSide,
		instance?: string,
	) => void;
	readonly installWidgetFromFiles?: (args: {
		readonly widgetId: string;
		readonly files: ReadonlyArray<{
			readonly path: string;
			readonly data: string | Uint8Array;
		}>;
	}) => Promise<void>;
	readonly uninstallWidget?: (widgetId: string) => Promise<void>;
	readonly resizePanel?: (side: PanelSide, size: number) => void;
	readonly focusPanel?: (side: PanelSide) => void;
	readonly isActiveView?: boolean;
	readonly lix: Lix;
}

/**
 * Lightweight state container that represents one panel island.
 *
 * @example
 * const leftPanel: PanelState = { views: [], activeInstance: null };
 */
export interface PanelState {
	readonly views: WidgetInstance[];
	readonly activeInstance: string | null;
}

/**
 * Declares the available sides that panels can mount on.
 *
 * @example
 * const side: PanelSide = "left";
 */
export type PanelSide = "left" | "right" | "central";
