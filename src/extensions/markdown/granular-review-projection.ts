import type { MarkdownBlockSnapshot } from "./review-diff";

// Mirrors the Lix Markdown plugin projection contract. The plugin renders a
// file from its `markdown_block` entities by ordering them, joining the block
// snapshots with a single blank line and appending one trailing newline (see
// `submodule/lix/plugins/markdown/src/markdown_file.rs` `render_projection`).
//
// This renderer is the only authoritative way Flashtype reproduces Lix file
// data from block snapshots. It must never patch source byte ranges or try to
// preserve raw input formatting (BOM, encoding, CRLF, mixed endings, extra
// separators) that Lix has already normalized away.
//
// If the bundled Markdown plugin ever changes its parsing, normalization,
// empty-block handling, ordering, or rendering, the characterization tests in
// `granular-review-projection.test.ts` must be updated and re-run before any
// planner change relies on this renderer.

const BLOCK_SEPARATOR = "\n\n";
const TRAILING_NEWLINE = "\n";

/**
 * Sort block snapshots into the deterministic Lix projection order: ascending
 * `orderKey`, breaking ties by `id`. The input is treated as immutable.
 */
export function orderMarkdownBlocks(
	blocks: readonly MarkdownBlockSnapshot[],
): MarkdownBlockSnapshot[] {
	return [...blocks].sort(
		(left, right) =>
			left.orderKey.localeCompare(right.orderKey) ||
			left.id.localeCompare(right.id),
	);
}

/**
 * Render ordered block snapshots to the canonical Lix projection string.
 */
export function renderMarkdownProjectionText(
	blocks: readonly MarkdownBlockSnapshot[],
): string {
	const ordered = orderMarkdownBlocks(blocks);
	return `${ordered.map((block) => block.block).join(BLOCK_SEPARATOR)}${TRAILING_NEWLINE}`;
}

/**
 * Render ordered block snapshots to canonical Lix projection bytes (UTF-8).
 */
export function renderMarkdownProjection(
	blocks: readonly MarkdownBlockSnapshot[],
): Uint8Array {
	return new TextEncoder().encode(renderMarkdownProjectionText(blocks));
}
