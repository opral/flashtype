import { parse } from "papaparse";

export type CsvRow = {
	readonly rowNumber: number;
	readonly cells: readonly string[];
};

export type CsvParseResult = {
	readonly columns: readonly string[];
	readonly rows: readonly CsvRow[];
	readonly warnings: readonly string[];
};

export function parseCsv(rawCsv: string): CsvParseResult {
	const result = parse<string[]>(rawCsv.replace(/^\uFEFF/, ""), {
		skipEmptyLines: false,
	});
	const rawRows = trimTrailingEmptyRows(
		result.data.map((row) => row.map((cell) => String(cell ?? ""))),
	);
	const maxColumns = rawRows.reduce((max, row) => Math.max(max, row.length), 0);
	if (rawRows.length === 0 || maxColumns === 0) {
		return { columns: [], rows: [], warnings: csvWarnings(result.errors) };
	}

	const columns = normalizeHeaders(rawRows[0] ?? [], maxColumns);
	const rows = rawRows.slice(1).map((row, index) => ({
		rowNumber: index + 1,
		cells: Array.from({ length: maxColumns }, (_, cellIndex) =>
			String(row[cellIndex] ?? ""),
		),
	}));
	return { columns, rows, warnings: csvWarnings(result.errors) };
}

function normalizeHeaders(
	headerRow: readonly string[],
	columnCount: number,
): string[] {
	const seen = new Map<string, number>();
	return Array.from({ length: columnCount }, (_, index) => {
		const raw = headerRow[index]?.trim();
		const base = raw && raw.length > 0 ? raw : `Column ${index + 1}`;
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		return count === 0 ? base : `${base} ${count + 1}`;
	});
}

function trimTrailingEmptyRows(rows: string[][]): string[][] {
	let end = rows.length;
	while (end > 0 && rows[end - 1]?.every((cell) => cell.trim() === "")) {
		end -= 1;
	}
	return rows.slice(0, end);
}

function csvWarnings(errors: readonly { message: string }[]): string[] {
	return errors.map((error) => error.message).filter(Boolean);
}
