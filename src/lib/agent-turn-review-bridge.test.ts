import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Lix, LixRuntimeQueryResult } from "@/lib/lix-types";
import type { AtelierInstance } from "@opral/atelier";

import { createAgentTurnReviewHandler } from "./agent-turn-review-bridge";

function createTestLix(args: {
	readonly commitIds: readonly string[];
	readonly activeFilePath?: string;
}) {
	const commitIds = [...args.commitIds];
	return {
		syncDiskToLix: vi.fn(async () => {}),
		importFilesystemPaths: vi.fn(async () => {}),
		execute: vi.fn(async (query: string, params?: ReadonlyArray<unknown>) => {
			if (query.includes("lix_key_value_by_branch")) {
				return args.activeFilePath
					? queryResult(
							[uiState("active-file", args.activeFilePath)],
							["value"],
						)
					: queryResult([], ["value"]);
			}
			if (query.includes("FROM lix_file")) {
				return params?.[0] === "active-file" && args.activeFilePath
					? queryResult([args.activeFilePath], ["path"])
					: queryResult([], ["path"]);
			}
			if (query.includes("lix_active_branch_commit_id")) {
				return queryResult([commitIds.shift()], ["commit_id"]);
			}
			throw new Error(`Unexpected query: ${query}`);
		}),
	} as unknown as Lix;
}

describe("createAgentTurnReviewHandler", () => {
	beforeEach(() => vi.clearAllMocks());

	test("opens an Atelier diff for a changed agent turn", async () => {
		const lix = createTestLix({
			commitIds: ["before-commit", "after-commit"],
			activeFilePath: "/notes/active.md",
		});
		const open = vi.fn(async () => {});
		const atelier = {
			lix,
			diff: { open },
		} as unknown as AtelierInstance;
		const handle = createAgentTurnReviewHandler(atelier);

		const startResult = await handle({
			id: "start",
			instanceId: "terminal-1",
			agent: "codex",
			phase: "turn-start",
			sessionId: "session-1",
			turnId: "turn-1",
			createdAt: 10,
		});
		expect(startResult).toEqual({
			additionalContext: "The current document is: ./notes/active.md",
		});
		await handle({
			id: "stop",
			instanceId: "terminal-1",
			agent: "codex",
			phase: "turn-stop",
			sessionId: "session-1",
			turnId: "turn-1",
			createdAt: 20,
		});

		expect(lix.syncDiskToLix).toHaveBeenCalledTimes(2);
		expect(open).toHaveBeenCalledWith({
			beforeCommitId: "before-commit",
			afterCommitId: "after-commit",
			source: {
				id: "codex",
				sessionId: "session-1",
				turnId: "turn-1",
			},
		});
	});

	test("does not create a review range when no commit changed", async () => {
		const lix = createTestLix({
			commitIds: ["same-commit", "same-commit"],
		});
		const open = vi.fn(async () => {});
		const atelier = {
			lix,
			diff: { open },
		} as unknown as AtelierInstance;
		const handle = createAgentTurnReviewHandler(atelier);
		const base = {
			instanceId: "terminal-1",
			agent: "claude" as const,
			sessionId: "session-1",
			turnId: "turn-1",
		};

		await handle({
			...base,
			id: "start",
			phase: "turn-start",
			createdAt: 10,
		});
		await handle({
			...base,
			id: "stop",
			phase: "turn-stop",
			createdAt: 20,
		});

		expect(open).not.toHaveBeenCalled();
	});

	test("omits additional context when no document is active", async () => {
		const lix = createTestLix({ commitIds: ["before-commit"] });
		const atelier = {
			lix,
			diff: { open: vi.fn(async () => {}) },
		} as unknown as AtelierInstance;
		const handle = createAgentTurnReviewHandler(atelier);

		const result = await handle({
			id: "start",
			instanceId: "terminal-1",
			agent: "codex",
			phase: "turn-start",
			sessionId: "session-1",
			turnId: "turn-1",
			createdAt: 10,
		});

		expect(result).toBeUndefined();
		expect(lix.syncDiskToLix).toHaveBeenCalledOnce();
	});

	test("baselines an unopened Markdown file so its turn diff is modified", async () => {
		const result = await runCapturedFileTurn({
			path: "notes/unopened.md",
			before: "before\n",
			after: "after\n",
			baselinePaths: ["notes/unopened.md"],
		});

		expect(result.status).toBe("modified");
		expect(result.imports).toEqual([
			["notes/unopened.md"],
			["notes/unopened.md"],
		]);
	});

	test("imports a Markdown file created during the turn as added", async () => {
		const result = await runCapturedFileTurn({
			path: "notes/created.md",
			after: "created\n",
			baselinePaths: [],
		});

		expect(result.status).toBe("added");
		expect(result.imports).toEqual([["notes/created.md"]]);
	});

	test("keeps a deleted Markdown file in the baseline so its turn diff is deleted", async () => {
		const result = await runCapturedFileTurn({
			path: "notes/deleted.md",
			before: "delete me\n",
			baselinePaths: ["notes/deleted.md"],
		});

		expect(result.status).toBe("deleted");
		expect(result.imports).toEqual([
			["notes/deleted.md"],
			["notes/deleted.md"],
		]);
	});
});

async function runCapturedFileTurn(args: {
	readonly path: string;
	readonly before?: string;
	readonly after?: string;
	readonly baselinePaths: readonly string[];
}) {
	const disk = new Map<string, string>();
	if (args.before !== undefined) disk.set(args.path, args.before);
	const tracked = new Map<string, string>();
	const commits = new Map<string, Map<string, string>>();
	const commitIds = ["before-commit", "after-commit"];
	const imports: string[][] = [];
	const lix = {
		importFilesystemPaths: vi.fn(async (paths: readonly string[]) => {
			imports.push([...paths]);
			for (const path of paths) {
				const content = disk.get(path);
				if (content !== undefined) tracked.set(path, content);
			}
		}),
		syncDiskToLix: vi.fn(async () => {
			for (const path of tracked.keys()) {
				const content = disk.get(path);
				if (content === undefined) tracked.delete(path);
				else tracked.set(path, content);
			}
		}),
		execute: vi.fn(async (query: string) => {
			if (query.includes("lix_key_value_by_branch")) {
				return queryResult([], ["value"]);
			}
			if (query.includes("lix_active_branch_commit_id")) {
				const commitId = commitIds.shift();
				if (!commitId) throw new Error("Missing test commit id.");
				commits.set(commitId, new Map(tracked));
				return queryResult([commitId], ["commit_id"]);
			}
			throw new Error(`Unexpected query: ${query}`);
		}),
	} as unknown as Lix;
	let status: "added" | "deleted" | "modified" | "unchanged" = "unchanged";
	const atelier = {
		lix,
		diff: {
			open: vi.fn(async ({ beforeCommitId, afterCommitId }) => {
				const before = commits.get(beforeCommitId)?.get(args.path);
				const after = commits.get(afterCommitId)?.get(args.path);
				status =
					before === undefined
						? "added"
						: after === undefined
							? "deleted"
							: before === after
								? "unchanged"
								: "modified";
			}),
		},
	} as unknown as AtelierInstance;
	const fileCapture = {
		beginAgentTurnFileCapture: vi.fn(async () => ({
			baselinePaths: [...args.baselinePaths],
		})),
		finishAgentTurnFileCapture: vi.fn(async () => [args.path]),
	};
	const handle = createAgentTurnReviewHandler(atelier, { fileCapture });
	const event = {
		instanceId: "terminal-1",
		agent: "codex" as const,
		sessionId: "session-1",
		turnId: "turn-1",
	};

	await handle({
		...event,
		id: "start",
		phase: "turn-start",
		createdAt: 10,
	});
	if (args.after === undefined) disk.delete(args.path);
	else disk.set(args.path, args.after);
	await handle({
		...event,
		id: "stop",
		phase: "turn-stop",
		createdAt: 20,
	});

	return { imports, status };
}

function uiState(fileId: string, filePath: string) {
	return {
		panels: {
			central: {
				activeInstance: `atelier_file:${fileId}`,
				views: [
					{
						instance: `atelier_file:${fileId}`,
						kind: "atelier_file",
						state: { fileId, filePath },
					},
				],
			},
		},
	};
}

function queryResult(
	row: readonly unknown[],
	columns: readonly string[],
): LixRuntimeQueryResult {
	return {
		rows:
			row.length > 0
				? [
						Object.fromEntries(
							columns.map((column, index) => [column, row[index]]),
						),
					]
				: [],
		columns: [...columns],
		rowsAffected: 0,
		notices: [],
	} as unknown as LixRuntimeQueryResult;
}
