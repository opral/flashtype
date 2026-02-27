import {
	DEFAULT_FLASHTYPE_UI_STATE,
	type FlashtypeUiState,
} from "@/shell/ui-state";

export type KeyValueVersionId = "active" | "global" | string;

export type KeyDef<V> = {
	defaultVersionId: KeyValueVersionId;
	untracked: boolean;
	defaultValue?: V | null;
};

// Flashtype keys + per-key defaults
export const KEY_VALUE_DEFINITIONS = {
	// Cross-version UI state, not change-controlled
	flashtype_active_file_id: {
		defaultVersionId: "global",
		untracked: true,
	} as KeyDef<string | null>,

	/**
	 * Serialized layout snapshot for the v2 prototype (panels, tabs, focus).
	 */
	flashtype_ui_state: {
		defaultVersionId: "global",
		untracked: true,
		defaultValue: DEFAULT_FLASHTYPE_UI_STATE,
	} as KeyDef<FlashtypeUiState>,

	/**
	 * Global app theme preference shared across views.
	 */
	flashtype_theme: {
		defaultVersionId: "global",
		untracked: true,
		defaultValue: "light",
	} as KeyDef<"light" | "dark">,

	/**
	 * Developer setting controlling hidden-file visibility in the files widget.
	 */
	flashtype_show_hidden_files: {
		defaultVersionId: "global",
		untracked: true,
		defaultValue: false,
	} as KeyDef<boolean>,

	// Test-only keys used in unit tests to exercise tracked behavior
	flashtype_test_tracked: {
		defaultVersionId: "active",
		untracked: false,
	} as KeyDef<string | null>,

	flashtype_test_tracked_external: {
		defaultVersionId: "active",
		untracked: false,
	} as KeyDef<string | null>,

	flashtype_test_untracked: {
		defaultVersionId: "global",
		untracked: true,
		defaultValue: null,
	} as KeyDef<string | null>,
} as const;

export type KnownKey = keyof typeof KEY_VALUE_DEFINITIONS;

export type ValueOf<K extends string> = K extends KnownKey
	? (typeof KEY_VALUE_DEFINITIONS)[K] extends KeyDef<infer V>
		? V
		: never
	: unknown;
