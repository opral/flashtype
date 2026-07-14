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

export type AtelierDocumentSessionState = {
	readonly activePath: string | null;
	readonly openPaths: readonly string[];
};

/** Reads the central documents Atelier has persisted in Lix. */
export async function readAtelierDocumentSessionState(
	lix: Lix,
	uiState?: unknown,
): Promise<AtelierDocumentSessionState> {
	const rawState =
		uiState === undefined
			? readResultValue(await readAtelierUiState(lix), "value")
			: uiState;
	const candidates = documentCandidates(rawState);
	if (candidates.views.length === 0) {
		return { activePath: null, openPaths: [] };
	}

	const currentPaths = new Map<string, string>();
	for (const view of candidates.views) {
		const fileResult = await lix.execute(
			`SELECT path
			 FROM lix_file
			 WHERE id = $1
			 LIMIT 1`,
			[view.fileId],
		);
		const path = readResultValue(fileResult, "path");
		if (typeof path === "string" && path.length > 0) {
			currentPaths.set(view.fileId, path);
		}
	}

	const activePath = candidates.active
		? (currentPaths.get(candidates.active.fileId) ?? null)
		: null;
	const viewPaths = candidates.views
		.map((view) => currentPaths.get(view.fileId))
		.filter((path): path is string => typeof path === "string");
	const openPaths = [
		...new Set(activePath ? [activePath, ...viewPaths] : viewPaths),
	];
	return { activePath, openPaths };
}

/** Reads Atelier's current central document from its persisted Lix UI state. */
export async function readCurrentAtelierDocumentPath(
	lix: Lix,
	uiState?: unknown,
): Promise<string | null> {
	return (await readAtelierDocumentSessionState(lix, uiState)).activePath;
}

function readAtelierUiState(lix: Lix): Promise<LixRuntimeQueryResult> {
	return lix.execute(
		`SELECT value
		 FROM lix_key_value_by_branch
		 WHERE key = $1
		   AND lixcol_branch_id = $2
		 LIMIT 1`,
		[ATELIER_UI_STATE_KEY, GLOBAL_BRANCH_ID],
	);
}

function documentCandidates(rawState: unknown): {
	readonly active: {
		readonly fileId: string;
		readonly filePath: string;
	} | null;
	readonly views: readonly {
		readonly fileId: string;
		readonly filePath: string;
	}[];
} {
	const state = parseObject(rawState);
	const panels = parseObject(state?.panels);
	const central = parseObject(panels?.central);
	const views = Array.isArray(central?.views)
		? (central.views as readonly PersistedDocumentView[])
		: [];
	const activeInstance =
		typeof central?.activeInstance === "string" ? central.activeInstance : null;
	const candidates = views.flatMap((view) => {
		const fileId = view.state?.fileId;
		const filePath = view.state?.filePath;
		const kind = view.kind;
		if (
			typeof fileId !== "string" ||
			fileId.length === 0 ||
			typeof filePath !== "string" ||
			filePath.length === 0 ||
			typeof kind !== "string" ||
			view.instance !== `${kind}:${fileId}`
		) {
			return [];
		}
		return [{ fileId, filePath, instance: view.instance }];
	});
	const active =
		(activeInstance
			? candidates.find((view) => view.instance === activeInstance)
			: undefined) ?? candidates[0];
	return {
		active: active
			? { fileId: active.fileId, filePath: active.filePath }
			: null,
		views: candidates.map(({ fileId, filePath }) => ({ fileId, filePath })),
	};
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
