import {
	DEFAULT_FLASHTYPE_UI_STATE,
	type FlashtypeUiState,
} from "@/shell/ui-state";

export type KeyValueBranchId = "active" | "global" | string;

export type KeyDef<V> = {
	defaultBranchId: KeyValueBranchId;
	untracked: boolean;
	defaultValue?: V | null;
};

export const FLASHTYPE_CHECKPOINTS_KEY = "flashtype_checkpoints" as const;

// Flashtype keys + per-key defaults
export const KEY_VALUE_DEFINITIONS = {
	// Cross-branch UI state, not change-controlled
	flashtype_active_file_id: {
		defaultBranchId: "global",
		untracked: true,
	} as KeyDef<string | null>,

	/**
	 * Serialized layout snapshot for the v2 prototype (panels, tabs, focus).
	 */
	flashtype_ui_state: {
		defaultBranchId: "global",
		untracked: true,
		defaultValue: DEFAULT_FLASHTYPE_UI_STATE,
	} as KeyDef<FlashtypeUiState>,

	[FLASHTYPE_CHECKPOINTS_KEY]: {
		defaultBranchId: "active",
		untracked: true,
		defaultValue: [],
	} as KeyDef<readonly string[]>,

	// Test-only keys used in unit tests to exercise tracked behavior
	flashtype_test_tracked: {
		defaultBranchId: "active",
		untracked: false,
	} as KeyDef<string | null>,

	flashtype_test_tracked_external: {
		defaultBranchId: "active",
		untracked: false,
	} as KeyDef<string | null>,

	flashtype_test_untracked: {
		defaultBranchId: "global",
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
