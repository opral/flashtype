import { renderHtmlDiff } from "@lix-js/html-diff";
import { decodeFileDataToText } from "@/lib/decode-file-data";
import type { ExternalWriteReviewData } from "@/extension-runtime/external-write-review";
import { parseCsv, type CsvParseResult, type CsvRow } from "./csv-data";

export function renderCsvReviewDiffHtml(data: ExternalWriteReviewData): string {
	const beforeParsed = parseCsv(decodeFileDataToText(data.beforeData));
	const afterParsed = parseCsv(decodeFileDataToText(data.afterData));
	const beforeRows = assignCsvRowKeys(beforeParsed.rows);
	const afterRows = assignCsvRowKeys(afterParsed.rows, beforeRows, "after");
	return renderHtmlDiff({
		beforeHtml: renderStaticCsvTable(beforeParsed, beforeRows),
		afterHtml: renderStaticCsvTable(afterParsed, afterRows),
		diffAttribute: "data-diff-key",
	});
}

type KeyedCsvRow = CsvRow & {
	readonly diffKey: string;
};

function assignCsvRowKeys(
	rows: readonly CsvRow[],
	beforeRows: readonly KeyedCsvRow[] = [],
	unmatchedPrefix = "before",
): KeyedCsvRow[] {
	const availableBeforeRows = new Map<string, KeyedCsvRow[]>();
	for (const row of beforeRows) {
		const signature = csvRowIdentity(row);
		const entries = availableBeforeRows.get(signature) ?? [];
		entries.push(row);
		availableBeforeRows.set(signature, entries);
	}
	const usedKeys = new Set<string>();
	return rows.map((row, index) => {
		const signature = csvRowIdentity(row);
		const match = availableBeforeRows
			.get(signature)
			?.find((entry) => !usedKeys.has(entry.diffKey));
		const diffKey = match?.diffKey ?? `${unmatchedPrefix}_row_${index}`;
		usedKeys.add(diffKey);
		return { ...row, diffKey };
	});
}

function renderStaticCsvTable(
	parsed: CsvParseResult,
	rows: readonly KeyedCsvRow[],
): string {
	const columnCount = parsed.columns.length;
	const header = parsed.columns
		.map(
			(column, index) =>
				`<th data-diff-key="header:${index}" data-diff-mode="words" data-diff-show-when-removed="true">${escapeHtml(
					column,
				)}</th>`,
		)
		.join("");
	const body = rows
		.map((row) => {
			const cells = Array.from({ length: columnCount }, (_, index) => {
				const value = row.cells[index] ?? "";
				return `<td data-diff-key="${escapeAttribute(
					row.diffKey,
				)}:cell:${index}" data-diff-mode="words" data-diff-show-when-removed="true">${escapeHtml(
					value,
				)}</td>`;
			}).join("");
			return `<tr data-diff-key="${escapeAttribute(
				row.diffKey,
			)}" data-diff-show-when-removed="true">${cells}</tr>`;
		})
		.join("");
	return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function csvRowIdentity(row: CsvRow): string {
	const firstCell = row.cells[0]?.trim();
	if (firstCell) return `first:${firstCell}`;
	return `row:${row.cells.join("\u001f")}`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
	return escapeHtml(value).replace(/"/g, "&quot;");
}
