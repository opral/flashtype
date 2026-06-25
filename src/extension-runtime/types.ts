import type { LucideIcon } from "lucide-react";
import type { Lix } from "@/lib/lix-types";

/**
 * Union of registry keys for views available in the layout.
 *
 * @example
 * const activeView: ExtensionKind = "flashtype_files";
 */
export type ExtensionKind = string;

/**
 * Persisted view state. Only include values that should survive reloads.
 *
 * @example
 * const state: ExtensionState = { fileId: "file-123", filePath: "/docs/guide.md" };
 */
export type ExtensionState = {
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

export type WorkspaceContext =
	| {
			readonly ephemeral: false;
			readonly path: string;
			readonly name: string;
	  }
	| {
			readonly ephemeral: true;
			readonly path: string;
			readonly name: string;
			readonly includePaths: readonly string[];
	  };

/**
 * One-shot launch-time arguments that must not be persisted.
 *
 * @example
 * const launchArgs: ExtensionLaunchArgs = { initialMessage: "Summarize changes" };
 */
export type ExtensionLaunchArgs = Record<string, unknown>;

/**
 * Per-panel instance payload used to track which views are open.
 *
 * @example
 * const instance: ExtensionInstance = { instance: "files-1", kind: "flashtype_files" };
 */
export interface ExtensionInstance {
	readonly instance: string;
	readonly kind: ExtensionKind;
	readonly isPending?: boolean;
	/**
	 * Persisted view state (serializable).
	 */
	readonly state?: ExtensionState;
	/**
	 * Transient launch args (never persisted).
	 */
	readonly launchArgs?: ExtensionLaunchArgs;
}

/**
 * Shape of the static metadata that powers the view switcher UI.
 *
 * @example
 * const filesView: ExtensionDefinition = EXTENSION_DEFINITIONS[0];
 */
export interface ExtensionDefinition {
	readonly kind: ExtensionKind;
	readonly label: string;
	readonly description: string;
	readonly icon: LucideIcon;
	/**
	 * Lowercase file extensions this extension can render when a file is opened.
	 *
	 * @example
	 * fileExtensions: ["md", "markdown"]
	 */
	readonly fileExtensions?: readonly string[];
	/**
	 * Allows several instances of this extension in one panel (e.g. multiple
	 * agent terminal sessions). Single-instance kinds are hidden from the
	 * add-view menu once open.
	 */
	readonly multiInstance?: boolean;
	readonly activate?: (args: {
		context: ExtensionContext;
		instance: ExtensionInstance;
	}) => void | (() => void);
	readonly render: (args: {
		context: ExtensionContext;
		instance: ExtensionInstance;
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
 * context.openExtension?.({
 *   panel: "central",
 *   kind: "file-content",
 *   instance: "file-content:file-123",
 *   state: { fileId: "file-123", filePath: "/docs/guide.md" },
 *   pending: true,
 * });
 */
export interface ExtensionContext {
	readonly openExtension?: (args: {
		readonly panel: PanelSide;
		readonly kind: ExtensionKind;
		readonly state?: ExtensionState;
		readonly launchArgs?: ExtensionLaunchArgs;
		readonly focus?: boolean;
		readonly instance?: string;
		readonly pending?: boolean;
	}) => void;
	readonly openFile?: (args: {
		readonly panel: PanelSide;
		readonly fileId: string;
		readonly filePath: string;
		readonly state?: ExtensionState;
		readonly launchArgs?: ExtensionLaunchArgs;
		readonly focus?: boolean;
		readonly pending?: boolean;
		readonly documentOrigin?: "existing" | "new";
		readonly trackTelemetry?: boolean;
		readonly trackDocumentOpenAttempt?: boolean;
		readonly trackDocumentViewed?: boolean;
	}) => void | Promise<void>;
	readonly acceptExternalWriteReview?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
	}) => void;
	readonly rejectExternalWriteReview?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
	}) => Promise<void>;
	readonly closeExtension?: (args: {
		readonly panel?: PanelSide;
		readonly instance?: string;
		readonly kind?: ExtensionKind;
	}) => void;
	readonly closeFileViews?: (args: {
		readonly panel?: PanelSide;
		readonly fileId: string;
	}) => void;
	readonly isPanelFocused?: boolean;
	readonly setTabBadgeCount: (count: number | null | undefined) => void;
	readonly moveExtensionToPanel?: (
		targetPanel: PanelSide,
		instance?: string,
	) => void;
	readonly resizePanel?: (side: PanelSide, size: number) => void;
	readonly focusPanel?: (side: PanelSide) => void;
	readonly panelSide?: PanelSide;
	readonly viewInstance?: string;
	readonly isActiveView?: boolean;
	readonly registerNewFileDraftHandler?: (registration: {
		readonly panelSide: PanelSide;
		readonly viewInstance: string;
		readonly isActiveView: boolean;
		readonly handler: () => void;
	}) => () => void;
	readonly workspace?: WorkspaceContext;
	readonly lix: Lix;
}

/**
 * Lightweight state container that represents one panel island.
 *
 * @example
 * const leftPanel: PanelState = { views: [], activeInstance: null };
 */
export interface PanelState {
	readonly views: ExtensionInstance[];
	readonly activeInstance: string | null;
}

/**
 * Declares the available sides that panels can mount on.
 *
 * @example
 * const side: PanelSide = "left";
 */
export type PanelSide = "left" | "right" | "central";
