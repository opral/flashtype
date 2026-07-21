import type { Lix } from "@/lib/lix-types";
import type { CheckpointDiff } from "./checkpoint-diff";

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
			readonly initialPanelMode?: "document";
	  }
	| {
			readonly ephemeral: true;
			readonly path: string;
			readonly name: string;
			readonly initialPanelMode?: "document";
			readonly openFilePaths: readonly string[];
	  };

/**
 * One-shot launch-time arguments that must not be persisted.
 *
 * @example
 * const launchArgs: ExtensionLaunchArgs = { initialMessage: "Summarize changes" };
 */
export type ExtensionLaunchArgs = Record<string, unknown>;

/**
 * FlashType host context consumed by its Files view.
 *
 * Atelier owns extension registration and panel state. This adapter contains
 * only the desktop filesystem behavior that remains owned by FlashType.
 */
export interface ExtensionContext {
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
	readonly checkpointDiff?: CheckpointDiff | null;
	readonly checkpointBranchId?: string | null;
	readonly closeFileViews?: (args: {
		readonly panel?: PanelSide;
		readonly fileId: string;
		readonly filePath?: string;
	}) => void;
	/** File id for the file currently active in the central editor panel. */
	readonly activeFileId?: string | null;
	/** Path for the file currently active in the central editor panel. */
	readonly activeFilePath?: string | null;
	readonly isPanelFocused?: boolean;
	readonly setTabBadgeCount: (count: number | null | undefined) => void;
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
 * Declares the available sides that panels can mount on.
 *
 * @example
 * const side: PanelSide = "left";
 */
export type PanelSide = "left" | "right" | "central";
