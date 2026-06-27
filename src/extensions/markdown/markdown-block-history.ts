import type { Lix } from "@/lib/lix-types";
import type { MarkdownBlockSnapshot } from "./review-diff";

// Single source of truth for reading the `markdown_block` snapshots a file had
// at a given commit. Used both by the reactive overlay hook and by the review
// history, which captures snapshots eagerly so a coalesced review keeps a valid
// before-side even once its commit is no longer convenient to query.

export const MARKDOWN_BLOCKS_AT_COMMIT_SQL = `
	WITH ranked AS (
		SELECT
			entity_pk,
			snapshot_content,
			depth,
			ROW_NUMBER() OVER (
				PARTITION BY entity_pk
				ORDER BY depth ASC
			) AS rn
		FROM lix_state_history
		WHERE start_commit_id = ?
			AND file_id = ?
			AND schema_key = 'markdown_block'
	)
	SELECT snapshot_content
	FROM ranked
	WHERE rn = 1
		AND snapshot_content IS NOT NULL
`;

export function parseMarkdownBlockSnapshot(
	value: unknown,
): MarkdownBlockSnapshot | null {
	const snapshot = typeof value === "string" ? safeJsonParse(value) : value;
	if (!snapshot || typeof snapshot !== "object") return null;
	const record = snapshot as Record<string, unknown>;
	const { id, order_key: orderKey, block } = record;
	if (
		typeof id !== "string" ||
		typeof orderKey !== "string" ||
		typeof block !== "string"
	) {
		return null;
	}
	return { id, orderKey, block };
}

export function sortMarkdownBlocks(
	blocks: readonly MarkdownBlockSnapshot[],
): MarkdownBlockSnapshot[] {
	return [...blocks].sort(
		(left, right) =>
			left.orderKey.localeCompare(right.orderKey) ||
			left.id.localeCompare(right.id),
	);
}

/**
 * Load the ordered `markdown_block` snapshots a file had at `commitId`. Returns
 * `undefined` when no commit is given; a best-effort empty list otherwise (a
 * failed query never throws — the caller falls back to the classic review).
 */
export async function loadMarkdownBlocksAtCommit(
	lix: Lix,
	fileId: string,
	commitId: string | undefined,
): Promise<MarkdownBlockSnapshot[] | undefined> {
	if (!commitId) return undefined;
	// A snapshot can lag the commit that produced it by a tick, so a single read
	// races a just-written commit. Retry a few times while the result is empty;
	// callers that legitimately have no blocks just pay a short bounded wait.
	const maxAttempts = 8;
	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		try {
			const result = await lix.execute(MARKDOWN_BLOCKS_AT_COMMIT_SQL, [
				commitId,
				fileId,
			]);
			const blocks = result.rows
				.map((row) => parseMarkdownBlockSnapshot(snapshotContentOf(row)))
				.filter((block): block is MarkdownBlockSnapshot => block !== null);
			if (blocks.length > 0 || attempt === maxAttempts - 1) {
				return sortMarkdownBlocks(blocks);
			}
		} catch {
			return undefined;
		}
		await delay(40);
	}
	return undefined;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function snapshotContentOf(row: unknown): unknown {
	if (row && typeof row === "object") {
		const getter = (row as { get?: (column: string) => unknown }).get;
		if (typeof getter === "function") return getter.call(row, "snapshot_content");
		const toObject = (row as { toObject?: () => Record<string, unknown> })
			.toObject;
		if (typeof toObject === "function") {
			return toObject.call(row).snapshot_content;
		}
		return (row as Record<string, unknown>).snapshot_content;
	}
	return undefined;
}

function safeJsonParse(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}
