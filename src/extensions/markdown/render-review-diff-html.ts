import { renderHtmlDiff } from "@lix-js/html-diff";
import {
	ensureDiffIds,
	renderMarkdownAstEditorHtml,
	supportsDiffId,
} from "@/extensions/markdown/editor/render-markdown-html";
import { parseMarkdown } from "@/extensions/markdown/editor/markdown";
import type { MarkdownReviewDiff } from "./review-diff";

/** A before/after block that a change replaces 1:1, paired for a word diff. */
export type ReviewDiffBlockPairing = {
	readonly beforeId: string;
	readonly afterId: string;
};

export function renderMarkdownReviewDiffHtml(
	reviewDiff: MarkdownReviewDiff,
	options: { blockPairings?: readonly ReviewDiffBlockPairing[] } = {},
): string {
	if (
		reviewDiff.beforeBlocks !== undefined &&
		reviewDiff.afterBlocks !== undefined
	) {
		// Give each 1:1 replaced block the same diff key as the block it replaces,
		// so html-diff aligns them and renders a word-level diff instead of a
		// whole-block remove + add. Blocks Lix kept the id for already share a key.
		const sharedKeyByAfterId = new Map<string, string>();
		for (const { beforeId, afterId } of options.blockPairings ?? []) {
			if (beforeId !== afterId) sharedKeyByAfterId.set(afterId, beforeId);
		}
		const afterBlocks = reviewDiff.afterBlocks.map((block) => {
			const sharedKey = sharedKeyByAfterId.get(block.id);
			return sharedKey ? { ...block, id: sharedKey } : block;
		});
		return normalizeHtmlDiffFragment(
			renderHtmlDiff({
				beforeHtml: renderMarkdownBlocksHtml(reviewDiff.beforeBlocks),
				afterHtml: renderMarkdownBlocksHtml(afterBlocks),
				diffAttribute: "data-diff-key",
			}),
		);
	}

	const beforeAst = parseMarkdown(reviewDiff.beforeMarkdown) as any;
	const afterAst = parseMarkdown(reviewDiff.afterMarkdown) as any;
	ensurePairedDiffIds(beforeAst, afterAst);
	const beforeHtml = renderMarkdownAstEditorHtml(beforeAst);
	const afterHtml = renderMarkdownAstEditorHtml(afterAst);
	return normalizeHtmlDiffFragment(
		renderHtmlDiff({
			beforeHtml,
			afterHtml,
			diffAttribute: "data-diff-key",
		}),
	);
}

function normalizeHtmlDiffFragment(html: string): string {
	// html-diff wraps multi-root fragments in a plain div. The markdown view
	// needs TipTap blocks as direct ProseMirror children, and ProseMirror's
	// break-spaces styling makes top-level whitespace text nodes visible.
	const template = document.createElement("template");
	template.innerHTML = html.trim();
	const childElements = Array.from(template.content.children);
	if (childElements.length !== 1) {
		return serializeHtmlFragmentWithoutWhitespaceText(template.content);
	}
	const wrapper = childElements[0];
	if (wrapper?.tagName !== "DIV" || wrapper.attributes.length > 0) {
		return html;
	}
	if (wrapper.children.length <= 1) {
		return html;
	}
	return serializeHtmlFragmentWithoutWhitespaceText(wrapper);
}

function serializeHtmlFragmentWithoutWhitespaceText(
	root: DocumentFragment | Element,
): string {
	return Array.from(root.childNodes)
		.filter(
			(node) => node.nodeType !== Node.TEXT_NODE || node.textContent?.trim(),
		)
		.map((node) => {
			if (node instanceof Element) return node.outerHTML;
			return node.textContent ?? "";
		})
		.join("");
}

function renderMarkdownBlocksHtml(
	blocks: NonNullable<MarkdownReviewDiff["beforeBlocks"]>,
): string {
	return blocks.map(renderMarkdownBlockHtml).join("\n");
}

function renderMarkdownBlockHtml(
	block: NonNullable<MarkdownReviewDiff["beforeBlocks"]>[number],
): string {
	const ast = parseMarkdown(block.block) as any;
	ensureDiffIds(ast);
	ensureNestedDiffIds(ast, block.id);
	const children = Array.isArray(ast.children) ? ast.children : [];
	for (const child of children) {
		if (supportsDiffId(child)) {
			if (child?.type === "list" || child?.type === "table") {
				clearDataId(child);
			} else {
				writeDataId(child, block.id);
				if (child?.type === "blockquote") {
					writeDataDiffMode(child, "words");
				}
			}
			break;
		}
	}
	return renderMarkdownAstEditorHtml(ast);
}

function ensureNestedDiffIds(ast: any, blockId: string): void {
	const children = Array.isArray(ast?.children) ? ast.children : [];
	for (const child of children) {
		if (child?.type === "list") {
			ensureListItemDiffIds(child, blockId);
		} else if (child?.type === "table") {
			ensureTableDiffIds(child, blockId);
		}
	}
}

function ensureListItemDiffIds(
	listNode: any,
	blockId: string,
	parentKey = "",
): void {
	clearDataId(listNode);
	const items = Array.isArray(listNode.children) ? listNode.children : [];
	const itemKeys = items.map((item: any, index: number) =>
		item?.type === "listItem" ? stableListItemKey(item, index) : "",
	);
	const itemKeyCounts = new Map<string, number>();
	for (const itemKey of itemKeys) {
		if (!itemKey) continue;
		itemKeyCounts.set(itemKey, (itemKeyCounts.get(itemKey) ?? 0) + 1);
	}
	const resolvedKeys = items.map((item: any, index: number) => {
		const stableKey = itemKeys[index] || `index-${index}`;
		if (itemKeyCounts.get(stableKey) === 1) return stableKey;
		return `${stableKey}:${listItemChildSignature(item, index)}`;
	});
	const resolvedKeyCounts = new Map<string, number>();
	for (const key of resolvedKeys) {
		if (!key) continue;
		resolvedKeyCounts.set(key, (resolvedKeyCounts.get(key) ?? 0) + 1);
	}
	items.forEach((item: any, index: number) => {
		if (item?.type !== "listItem") return;
		const resolvedKey = resolvedKeys[index] || `index-${index}`;
		const itemKey =
			resolvedKeyCounts.get(resolvedKey) === 1
				? `${parentKey}${resolvedKey}`
				: `${parentKey}${resolvedKey}:${index}`;
		clearDataId(item);
		writeListItemOwnDiffId(item, `${blockId}:li:${itemKey}`);
		for (const child of Array.isArray(item.children) ? item.children : []) {
			if (child?.type === "list") {
				ensureListItemDiffIds(child, blockId, `${itemKey}:`);
			}
		}
	});
}

function ensureTableDiffIds(tableNode: any, blockId: string): void {
	clearDataId(tableNode);
	const rows = Array.isArray(tableNode.children) ? tableNode.children : [];
	const columnKeys = tableColumnKeys(rows);
	const firstCellCounts = new Map<string, number>();
	for (const row of rows) {
		if (row?.type !== "tableRow") continue;
		const firstCellKey = tableRowFirstCellKey(row);
		firstCellCounts.set(
			firstCellKey,
			(firstCellCounts.get(firstCellKey) ?? 0) + 1,
		);
	}
	rows.forEach((row: any, rowIndex: number) => {
		if (row?.type !== "tableRow") return;
		const rowKey = `${blockId}:tr:${tableRowKey(
			row,
			rowIndex,
			firstCellCounts,
		)}`;
		clearDataId(row);
		const cells = Array.isArray(row.children) ? row.children : [];
		cells.forEach((cell: any, cellIndex: number) => {
			if (cell?.type === "tableCell") {
				writeDataId(
					cell,
					`${rowKey}:td:${columnKeys[cellIndex] ?? `index-${cellIndex}`}`,
				);
			}
		});
	});
}

function tableColumnKeys(rows: any[]): string[] {
	const headerCells: any[] = Array.isArray(rows[0]?.children)
		? rows[0].children
		: [];
	const baseKeys = headerCells.map((cell: any, index: number) =>
		stableTextKey(cell, index),
	);
	const counts = new Map<string, number>();
	for (const key of baseKeys) {
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return baseKeys.map((key, index) =>
		counts.get(key) === 1 ? key : `${key}:${index}`,
	);
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

function clearDataId(node: any): void {
	if (!node || typeof node !== "object") return;
	if (!node.data || typeof node.data !== "object") return;
	delete node.data.id;
}

function writeDataDiffMode(node: any, mode: "words" | "element"): void {
	node.data = node.data && typeof node.data === "object" ? node.data : {};
	node.data.diffMode = mode;
}

function blockSignature(node: any): string {
	return `${node.type}:${textContent(node).replace(/\s+/g, " ").trim()}`;
}

function tableRowKey(
	row: any,
	rowIndex: number,
	firstCellCounts: ReadonlyMap<string, number>,
): string {
	const cells = Array.isArray(row?.children) ? row.children : [];
	const firstCellText = cells.length > 0 ? textContent(cells[0]) : "";
	let identityText = firstCellText;
	if (firstCellCounts.get(tableRowFirstCellKey(row)) !== 1) {
		const disambiguator = duplicateRowDisambiguator(cells.slice(1));
		identityText = `${firstCellText} ${disambiguator ?? ""}`;
	}
	return stableTextKey({ value: identityText }, rowIndex);
}

function duplicateRowDisambiguator(cells: any[]): string | undefined {
	const candidates = cells
		.map(textContent)
		.map((text: string) => text.replace(/\s+/g, " ").trim())
		.filter(Boolean);
	const labelLike = candidates
		.filter((text: string) => /^[A-Z][\p{L}\p{N}\s.'-]{0,39}$/u.test(text))
		.sort((a: string, b: string) => a.length - b.length)[0];
	return (
		labelLike ??
		candidates.sort((a: string, b: string) => b.length - a.length)[0]
	);
}

function tableRowFirstCellKey(row: any): string {
	const cells = Array.isArray(row?.children) ? row.children : [];
	return textContent(cells[0]).replace(/\s+/g, " ").trim().toLowerCase();
}

function stableTextKey(node: any, index: number): string {
	const text = textContent(node).replace(/\s+/g, " ").trim();
	const label = text.match(/^([^:]{1,80}):/)?.[1] ?? text;
	const normalized = label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized || `index-${index}`;
}

function stableListItemKey(item: any, index: number): string {
	const text = listItemOwnText(item).replace(/\s+/g, " ").trim();
	const label = text.match(/^([^:]{1,80}):/)?.[1];
	const identityText = label ?? text.split(/\s+/).slice(0, 3).join(" ");
	const normalized = identityText
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized || `index-${index}`;
}

function listItemOwnText(item: any): string {
	const children = Array.isArray(item?.children) ? item.children : [];
	return children
		.filter((child: any) => child?.type !== "list")
		.map(textContent)
		.join("");
}

function listItemChildSignature(item: any, index: number): string {
	const childKeys = nestedListItems(item)
		.map((child, childIndex) => stableListItemKey(child, childIndex))
		.filter(Boolean)
		.sort();
	const uniqueChildKeys = [...new Set(childKeys)];
	return uniqueChildKeys.length > 0
		? uniqueChildKeys.join("-")
		: `index-${index}`;
}

function nestedListItems(item: any): any[] {
	const out: any[] = [];
	const visit = (node: any) => {
		const children = Array.isArray(node?.children) ? node.children : [];
		for (const child of children) {
			if (child?.type === "list") {
				for (const listItem of Array.isArray(child.children)
					? child.children
					: []) {
					if (listItem?.type === "listItem") {
						out.push(listItem);
						visit(listItem);
					}
				}
			}
		}
	};
	visit(item);
	return out;
}

function writeListItemOwnDiffId(item: any, id: string): void {
	const children = Array.isArray(item?.children) ? item.children : [];
	const ownBlock = children.find(
		(child: any) => child?.type !== "list" && supportsDiffId(child),
	);
	if (ownBlock) {
		writeDataId(ownBlock, id);
		writeDataDiffMode(ownBlock, "words");
	}
}

function textContent(node: any): string {
	if (!node || typeof node !== "object") return "";
	if (typeof node.value === "string") return node.value;
	const children = Array.isArray(node.children) ? node.children : [];
	return children.map(textContent).join("");
}
