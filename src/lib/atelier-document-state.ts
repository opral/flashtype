import type { Lix, LixRuntimeQueryResult } from "@/lib/lix-types";

const ATELIER_UI_STATE_KEY = "atelier_ui_state";
const GLOBAL_BRANCH_ID = "global";

type PersistedDocumentView = {
	readonly instance?: unknown;
	readonly kind?: unknown;
	readonly state?: {
		readonly fileId?: unknown;
		readonly filePath?: unknown;
	};
};

/** Reads Atelier's current central document from its persisted Lix UI state. */
export async function readCurrentAtelierDocumentPath(
	lix: Lix,
): Promise<string | null> {
	const stateResult = await lix.execute(
		`SELECT value
		 FROM lix_key_value_by_branch
		 WHERE key = $1
		   AND lixcol_branch_id = $2
		 LIMIT 1`,
		[ATELIER_UI_STATE_KEY, GLOBAL_BRANCH_ID],
	);
	const candidate = activeDocumentCandidate(
		readResultValue(stateResult, "value"),
	);
	if (!candidate) return null;

	// Validate the persisted view against the current branch. This prevents a
	// stale deleted document from suppressing FlashType's recent-file fallback.
	const fileResult = await lix.execute(
		`SELECT path
		 FROM lix_file
		 WHERE id = $1
		 LIMIT 1`,
		[candidate.fileId],
	);
	const currentPath = readResultValue(fileResult, "path");
	return typeof currentPath === "string" && currentPath.length > 0
		? currentPath
		: null;
}

function activeDocumentCandidate(
	rawState: unknown,
): { readonly fileId: string; readonly filePath: string } | null {
	const state = parseObject(rawState);
	const panels = parseObject(state?.panels);
	const central = parseObject(panels?.central);
	const views = Array.isArray(central?.views)
		? (central.views as readonly PersistedDocumentView[])
		: [];
	const activeInstance =
		typeof central?.activeInstance === "string" ? central.activeInstance : null;
	const activeView =
		(activeInstance
			? views.find((view) => view?.instance === activeInstance)
			: undefined) ?? views[0];
	if (!activeView) return null;

	const fileId = activeView.state?.fileId;
	const filePath = activeView.state?.filePath;
	const kind = activeView.kind;
	if (
		typeof fileId !== "string" ||
		fileId.length === 0 ||
		typeof filePath !== "string" ||
		filePath.length === 0 ||
		typeof kind !== "string" ||
		activeView.instance !== `${kind}:${fileId}`
	) {
		return null;
	}
	return { fileId, filePath };
}

function parseObject(value: unknown): Record<string, unknown> | null {
	if (typeof value === "string") {
		try {
			return parseObject(JSON.parse(value));
		} catch {
			return null;
		}
	}
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function readResultValue(
	result: LixRuntimeQueryResult,
	column: string,
): unknown {
	const row = result.rows[0];
	if (!row) return undefined;
	if (Array.isArray(row)) {
		const index = result.columns.indexOf(column);
		return index >= 0 ? row[index] : undefined;
	}
	if (typeof (row as { get?: unknown }).get === "function") {
		return (row as { get(column: string): unknown }).get(column);
	}
	if (typeof (row as { toObject?: unknown }).toObject === "function") {
		return (row as { toObject(): Record<string, unknown> }).toObject()[column];
	}
	return (row as Record<string, unknown>)[column];
}
