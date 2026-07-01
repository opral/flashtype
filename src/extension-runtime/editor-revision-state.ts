import type { ExtensionState } from "./types";

export type EditorRevisionState = {
	readonly beforeCommitId: string | null;
	readonly afterCommitId: string | null;
};

export type EditorRevisionMode = "editor" | "snapshot" | "diff";

const BEFORE_COMMIT_ID_STATE_KEY = "beforeCommitId";
const AFTER_COMMIT_ID_STATE_KEY = "afterCommitId";

export function normalizeEditorRevisionState(
	state:
		| ExtensionState
		| {
				readonly beforeCommitId?: unknown;
				readonly afterCommitId?: unknown;
		  }
		| null
		| undefined,
): EditorRevisionState {
	return {
		beforeCommitId: normalizeCommitId(state?.beforeCommitId),
		afterCommitId: normalizeCommitId(state?.afterCommitId),
	};
}

export function editorRevisionMode(
	revision: EditorRevisionState,
): EditorRevisionMode {
	if (revision.beforeCommitId) return "diff";
	if (revision.afterCommitId) return "snapshot";
	return "editor";
}

export function hasHistoricalEditorRevisionState(
	state: ExtensionState | null | undefined,
): boolean {
	const revision = normalizeEditorRevisionState(state);
	return revision.beforeCommitId !== null || revision.afterCommitId !== null;
}

export function stripEditorRevisionState(
	state: ExtensionState | undefined,
): ExtensionState | undefined {
	if (!state) return undefined;
	const {
		[BEFORE_COMMIT_ID_STATE_KEY]: _beforeCommitId,
		[AFTER_COMMIT_ID_STATE_KEY]: _afterCommitId,
		checkpointDiffReviewId: _checkpointDiffReviewId,
		checkpointDiffBranchId: _checkpointDiffBranchId,
		...rest
	} = state;
	return Object.keys(rest).length > 0 ? rest : undefined;
}

export function editorRevisionReviewId(args: {
	readonly fileId: string;
	readonly path: string;
	readonly beforeCommitId: string | null;
	readonly afterCommitId: string | null;
}): string {
	return [
		"editor-revision",
		args.beforeCommitId ?? "none",
		args.afterCommitId ?? "head",
		args.fileId,
		args.path,
	].join(":");
}

function normalizeCommitId(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}
