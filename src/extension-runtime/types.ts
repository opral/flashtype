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

/**
 * One-shot launch-time arguments that must not be persisted.
 *
 * @example
 * const launchArgs: ExtensionLaunchArgs = { initialMessage: "Summarize changes" };
 */
export type ExtensionLaunchArgs = Record<string, unknown>;
