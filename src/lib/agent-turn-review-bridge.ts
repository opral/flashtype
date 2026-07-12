import type { AtelierInstance } from "@opral/atelier";
import type { Lix } from "@/lib/lix-types";
import { buildFlashtypeActiveFilePrompt } from "@/shell/agent-launch";
import { readCurrentAtelierDocumentPath } from "./atelier-document-state";

export type AgentTurnEvent = {
	readonly id: string;
	readonly instanceId?: string;
	readonly agent: "claude" | "codex";
	readonly phase: "turn-start" | "turn-stop";
	readonly sessionId?: string;
	readonly turnId?: string;
	readonly cwd?: string;
	readonly createdAt: number;
};

type ActiveAgentTurn = {
	readonly beforeCommitIdPromise: Promise<string | null>;
};

type AgentTurnFileCaptureApi = Pick<
	NonNullable<Window["flashtypeDesktop"]>["workspace"],
	"beginAgentTurnFileCapture" | "finishAgentTurnFileCapture"
>;

type AgentTurnReviewOptions = {
	readonly fileCapture?: AgentTurnFileCaptureApi;
};

export type AgentTurnEventResult = void | {
	readonly additionalContext: string;
};

type AgentTurnEventHandler = (
	event: AgentTurnEvent,
) => AgentTurnEventResult | Promise<AgentTurnEventResult>;

/**
 * Bridges Electron agent hooks into FlashType's host behavior around Atelier:
 * active-document context on turn start and a diff review on turn stop.
 */
export function createAgentTurnReviewHandler(
	atelier: AtelierInstance,
	options: AgentTurnReviewOptions = {},
) {
	return composeAgentTurnEventHandlers(
		createActiveDocumentContextHandler(atelier),
		createAgentTurnDiffHandler(atelier, options.fileCapture),
	);
}

function createAgentTurnDiffHandler(
	atelier: AtelierInstance,
	fileCapture?: AgentTurnFileCaptureApi,
): AgentTurnEventHandler {
	const activeTurns = new Map<string, ActiveAgentTurn>();
	return async (event: AgentTurnEvent): Promise<void> => {
		const key = agentTurnKey(event);
		if (event.phase === "turn-start") {
			const beforeCommitIdPromise = captureAgentTurnStart(
				atelier,
				fileCapture,
				key,
			).catch((error: unknown) => {
				console.warn(
					"[agent-turn-review] failed to capture start commit",
					error,
				);
				return null;
			});
			activeTurns.set(key, { beforeCommitIdPromise });
			await beforeCommitIdPromise;
			return;
		}

		const activeTurn = activeTurns.get(key);
		try {
			const beforeCommitId = activeTurn
				? await activeTurn.beforeCommitIdPromise
				: null;
			await importAgentTurnTouchedPaths(atelier, fileCapture, key);
			const afterCommitId = await readSyncedActiveCommitId(atelier);
			if (
				!beforeCommitId ||
				!afterCommitId ||
				beforeCommitId === afterCommitId
			) {
				return;
			}
			await atelier.diff.open({
				beforeCommitId,
				afterCommitId,
				source: {
					id: event.agent,
					...(event.sessionId !== undefined
						? { sessionId: event.sessionId }
						: {}),
					...(event.turnId !== undefined ? { turnId: event.turnId } : {}),
				},
			});
		} finally {
			activeTurns.delete(key);
		}
	};
}

async function captureAgentTurnStart(
	atelier: AtelierInstance,
	fileCapture: AgentTurnFileCaptureApi | undefined,
	captureId: string,
): Promise<string | null> {
	if (fileCapture) {
		try {
			const capture = await fileCapture.beginAgentTurnFileCapture({
				captureId,
			});
			await importAgentTurnPaths(atelier, capture.baselinePaths, "baseline");
		} catch (error) {
			console.warn("[agent-turn-review] failed to start file capture", error);
		}
	}
	return await readSyncedActiveCommitId(atelier);
}

async function importAgentTurnTouchedPaths(
	atelier: AtelierInstance,
	fileCapture: AgentTurnFileCaptureApi | undefined,
	captureId: string,
): Promise<void> {
	if (!fileCapture) return;
	let touchedPaths: readonly string[];
	try {
		touchedPaths = await fileCapture.finishAgentTurnFileCapture({ captureId });
	} catch (error) {
		console.warn("[agent-turn-review] failed to finish file capture", error);
		return;
	}
	await importAgentTurnPaths(atelier, touchedPaths, "touched");
}

async function importAgentTurnPaths(
	atelier: AtelierInstance,
	paths: readonly string[],
	kind: "baseline" | "touched",
): Promise<void> {
	const lix = atelier.lix as unknown as Lix;
	const uniquePaths = [...new Set(paths)].sort((left, right) =>
		left.localeCompare(right),
	);
	if (uniquePaths.length === 0) return;
	try {
		await lix.importFilesystemPaths(uniquePaths);
		return;
	} catch (error) {
		console.warn(
			`[agent-turn-review] failed to bulk import ${kind} paths; retrying individually`,
			error,
		);
	}
	for (const path of uniquePaths) {
		try {
			await lix.importFilesystemPaths([path]);
		} catch (error) {
			console.warn(
				`[agent-turn-review] failed to import ${kind} path '${path}'`,
				error,
			);
		}
	}
}

function createActiveDocumentContextHandler(
	atelier: AtelierInstance,
): AgentTurnEventHandler {
	return async (event) => {
		if (event.phase !== "turn-start") return;
		try {
			const filePath = await readCurrentAtelierDocumentPath(
				atelier.lix as unknown as Lix,
			);
			const additionalContext = buildFlashtypeActiveFilePrompt(filePath);
			return additionalContext ? { additionalContext } : undefined;
		} catch (error) {
			console.warn(
				"[agent-turn-context] failed to read the active document",
				error,
			);
			return;
		}
	};
}

/** Runs independent hook concerns together and combines returned context. */
export function composeAgentTurnEventHandlers(
	...handlers: readonly AgentTurnEventHandler[]
): AgentTurnEventHandler {
	return async (event) => {
		const results = await Promise.all(
			handlers.map((handler) => handler(event)),
		);
		const contexts = results
			.map((result) => result?.additionalContext?.trim())
			.filter((context): context is string => Boolean(context));
		return contexts.length > 0
			? { additionalContext: contexts.join("\n\n") }
			: undefined;
	};
}

async function readSyncedActiveCommitId(
	atelier: AtelierInstance,
): Promise<string | null> {
	// The desktop bridge exposes filesystem synchronization in addition to the
	// public Lix surface Atelier consumes.
	const lix = atelier.lix as unknown as Lix;
	await lix.syncDiskToLix();
	const result = await lix.execute(
		"SELECT lix_active_branch_commit_id() AS commit_id",
	);
	const row = result.rows[0];
	if (!row) return null;
	const value = readQueryRowValue(row, "commit_id");
	return typeof value === "string" && value.length > 0 ? value : null;
}

function readQueryRowValue(row: unknown, column: string): unknown {
	if (!row || typeof row !== "object") return undefined;
	if (typeof (row as { get?: unknown }).get === "function") {
		return (row as { get(column: string): unknown }).get(column);
	}
	if (typeof (row as { toObject?: unknown }).toObject === "function") {
		return (row as { toObject(): Record<string, unknown> }).toObject()[column];
	}
	return (row as Record<string, unknown>)[column];
}

function agentTurnKey(event: AgentTurnEvent): string {
	return [
		event.instanceId ?? "unknown-instance",
		event.agent,
		event.sessionId ?? event.cwd ?? "unknown-session",
		event.turnId ?? "current-turn",
	].join(":");
}
