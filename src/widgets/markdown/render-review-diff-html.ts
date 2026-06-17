import { renderHtmlDiff } from "@lix-js/html-diff";
import {
	ensureDiffIds,
	renderMarkdownAstEditorHtml,
	supportsDiffId,
} from "@/widgets/markdown/editor/render-markdown-html";
import { parseMarkdown } from "@/widgets/markdown/editor/markdown-rust";
import type { MarkdownReviewDiff } from "./review-diff";

export function renderMarkdownReviewDiffHtml(
	reviewDiff: MarkdownReviewDiff,
): string {
	const beforeAst = parseMarkdown(reviewDiff.beforeMarkdown) as any;
	const afterAst = parseMarkdown(reviewDiff.afterMarkdown) as any;
	ensurePairedDiffIds(beforeAst, afterAst);
	const beforeHtml = renderMarkdownAstEditorHtml(beforeAst);
	const afterHtml = renderMarkdownAstEditorHtml(afterAst);
	return renderHtmlDiff({
		beforeHtml,
		afterHtml,
		diffAttribute: "data-diff-key",
	});
}

function ensurePairedDiffIds(beforeAst: any, afterAst: any): void {
	ensureDiffIds(beforeAst);
	ensureDiffIds(afterAst);
	const beforeBlocks = collectBlocks(beforeAst);
	const afterBlocks = collectBlocks(afterAst);
	const beforeBySignature = groupUnclaimedBySignature(beforeBlocks);

	for (const afterBlock of afterBlocks) {
		const existingId = readDataId(afterBlock.node);
		if (existingId && !existingId.startsWith("diff_")) continue;
		const candidates = beforeBySignature.get(afterBlock.signature) ?? [];
		const beforeBlock = candidates.shift();
		if (!beforeBlock) continue;
		const beforeId = readDataId(beforeBlock.node);
		if (!beforeId) continue;
		writeDataId(afterBlock.node, beforeId);
	}
}

type DiffBlock = {
	readonly node: any;
	readonly signature: string;
};

function collectBlocks(node: any): DiffBlock[] {
	const blocks: DiffBlock[] = [];
	const visit = (current: any) => {
		if (!current || typeof current !== "object") return;
		if (supportsDiffId(current)) {
			blocks.push({
				node: current,
				signature: blockSignature(current),
			});
		}
		for (const child of Array.isArray(current.children)
			? current.children
			: []) {
			visit(child);
		}
	};
	visit(node);
	return blocks;
}

function groupUnclaimedBySignature(
	blocks: readonly DiffBlock[],
): Map<string, DiffBlock[]> {
	const grouped = new Map<string, DiffBlock[]>();
	for (const block of blocks) {
		const id = readDataId(block.node);
		if (id && !id.startsWith("diff_")) continue;
		const entries = grouped.get(block.signature) ?? [];
		entries.push(block);
		grouped.set(block.signature, entries);
	}
	return grouped;
}

function readDataId(node: any): string | null {
	const id = node?.data?.id;
	return typeof id === "string" && id.length > 0 ? id : null;
}

function writeDataId(node: any, id: string): void {
	node.data = node.data && typeof node.data === "object" ? node.data : {};
	node.data.id = id;
}

function blockSignature(node: any): string {
	return `${node.type}:${textContent(node).replace(/\s+/g, " ").trim()}`;
}

function textContent(node: any): string {
	if (!node || typeof node !== "object") return "";
	if (typeof node.value === "string") return node.value;
	const children = Array.isArray(node.children) ? node.children : [];
	return children.map(textContent).join("");
}
