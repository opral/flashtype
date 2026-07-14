import { parseMarkdownSource } from "./editor/markdown";
import type { MarkdownBlockSnapshot } from "./review-diff";

export type HistoricalMarkdownNodeRow = {
	readonly start_commit_id: string;
	readonly snapshot_content: unknown;
};

export function historicalMarkdownNodeBlocks(
	rows: readonly HistoricalMarkdownNodeRow[],
	commitId: string,
	markdown: string,
): MarkdownBlockSnapshot[] | undefined {
	const nodes = rows
		.filter((row) => row.start_commit_id === commitId)
		.map((row) => parseNode(row.snapshot_content))
		.filter(
			(node): node is { id: string; orderKey: string } => node !== null,
		)
		.sort(
			(left, right) =>
				left.orderKey.localeCompare(right.orderKey) ||
				left.id.localeCompare(right.id),
		);
	const segments = sourceSegments(markdown);
	if (!segments || segments.length !== nodes.length) return undefined;
	return nodes.map((node, index) => ({
		...node,
		block: segments[index]!,
	}));
}

function parseNode(value: unknown): { id: string; orderKey: string } | null {
	const snapshot = typeof value === "string" ? safeJsonParse(value) : value;
	if (!snapshot || typeof snapshot !== "object") return null;
	const record = snapshot as Record<string, unknown>;
	if (
		typeof record.id !== "string" ||
		record.parent_id !== "root" ||
		typeof record.order_key !== "string"
	) {
		return null;
	}
	return { id: record.id, orderKey: record.order_key };
}

function sourceSegments(markdown: string): string[] | null {
	const children = parseMarkdownSource(markdown).children ?? [];
	if (children.length === 0) return markdown.length === 0 ? [] : null;
	const starts: number[] = [];
	for (let index = 0; index < children.length; index += 1) {
		const offset = children[index]?.position?.start?.offset;
		if (
			typeof offset !== "number" ||
			offset < 0 ||
			offset > markdown.length ||
			(index > 0 && offset <= starts[index - 1]!)
		) {
			return null;
		}
		starts.push(offset);
	}
	return children.map((_child, index) =>
		markdown.slice(index === 0 ? 0 : starts[index]!, starts[index + 1]),
	);
}

function safeJsonParse(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}
