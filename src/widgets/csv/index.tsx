import { Suspense, useMemo, useRef, type CSSProperties } from "react";
import { AlertTriangle, Loader2, Table2 } from "lucide-react";
import { parse } from "papaparse";
import {
	flexRender,
	getCoreRowModel,
	useReactTable,
	type ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { LixProvider, useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { createReactWidgetDefinition } from "../../widget-runtime/react-widget";
import { CSV_WIDGET_KIND } from "../../widget-runtime/widget-instance-helpers";

type CsvViewProps = {
	readonly fileId: string;
};

type CsvRow = {
	readonly rowNumber: number;
	readonly cells: readonly string[];
};

type CsvParseResult = {
	readonly columns: readonly string[];
	readonly rows: readonly CsvRow[];
	readonly warnings: readonly string[];
};

const ROW_NUMBER_COLUMN_WIDTH = 56;
const DATA_COLUMN_WIDTH = 180;
const ROW_HEIGHT = 32;

export function CsvView({ fileId }: CsvViewProps) {
	return (
		<Suspense fallback={<CsvLoadingSpinner />}>
			<CsvViewContent fileId={fileId} />
		</Suspense>
	);
}

function CsvViewContent({ fileId }: CsvViewProps) {
	assertFileId(fileId);

	const fileRow = useQueryTakeFirst((lix) =>
		qb(lix)
			.selectFrom("lix_file")
			.select(["id", "path", "data"])
			.where("id", "=", fileId)
			.limit(1),
	);

	const parsed = useMemo<CsvParseResult | null>(() => {
		if (!fileRow) return null;
		return parseCsv(decodeFileData(fileRow.data));
	}, [fileRow]);

	if (!fileRow) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-neutral-500">
				File not found in the workspace.
			</div>
		);
	}

	if (!parsed || parsed.columns.length === 0) {
		return <CsvEmptyState filePath={fileRow.path} />;
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-background px-2 py-2">
			<div className="mb-2 flex shrink-0 items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
				<span className="truncate font-mono">{fileRow.path}</span>
				<span className="shrink-0">
					{parsed.rows.length.toLocaleString()} rows ·{" "}
					{parsed.columns.length.toLocaleString()} columns
				</span>
			</div>
			{parsed.warnings.length > 0 ? (
				<div className="mb-2 flex shrink-0 items-start gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
					<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
					<span className="min-w-0 truncate">{parsed.warnings[0]}</span>
				</div>
			) : null}
			<CsvTable parsed={parsed} />
		</div>
	);
}

function CsvTable({ parsed }: { readonly parsed: CsvParseResult }) {
	const parentRef = useRef<HTMLDivElement | null>(null);
	const columns = useMemo<ColumnDef<CsvRow>[]>(() => {
		return [
			{
				id: "__row_number",
				header: "#",
				cell: ({ row }) => row.original.rowNumber.toLocaleString(),
				size: ROW_NUMBER_COLUMN_WIDTH,
			},
			...parsed.columns.map((header, index) => ({
				id: `column_${index}`,
				header,
				accessorFn: (row: CsvRow) => row.cells[index] ?? "",
				size: DATA_COLUMN_WIDTH,
			})),
		];
	}, [parsed.columns]);
	const table = useReactTable({
		data: [...parsed.rows],
		columns,
		getCoreRowModel: getCoreRowModel(),
	});
	const rows = table.getRowModel().rows;
	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => ROW_HEIGHT,
		overscan: 12,
	});
	const totalWidth =
		ROW_NUMBER_COLUMN_WIDTH + parsed.columns.length * DATA_COLUMN_WIDTH;

	return (
		<div
			ref={parentRef}
			className="min-h-0 flex-1 overflow-auto rounded border border-border bg-background"
		>
			<div style={{ minWidth: totalWidth }} className="relative">
				<div className="sticky top-0 z-10 flex border-b border-border bg-muted text-xs font-medium text-muted-foreground">
					{table.getHeaderGroups()[0]?.headers.map((header) => (
						<div
							key={header.id}
							className="border-r border-border px-2 py-2 last:border-r-0"
							style={columnStyle(header.getSize())}
							title={String(header.column.columnDef.header ?? "")}
						>
							<div className="truncate">
								{flexRender(
									header.column.columnDef.header,
									header.getContext(),
								)}
							</div>
						</div>
					))}
				</div>
				<div
					className="relative"
					style={{ height: virtualizer.getTotalSize() }}
				>
					{virtualizer.getVirtualItems().map((virtualRow) => {
						const row = rows[virtualRow.index];
						if (!row) return null;
						return (
							<div
								key={row.id}
								className="absolute left-0 flex border-b border-border text-xs text-foreground"
								style={{
									height: virtualRow.size,
									transform: `translateY(${virtualRow.start}px)`,
								}}
							>
								{row.getVisibleCells().map((cell) => (
									<div
										key={cell.id}
										className="border-r border-border px-2 py-1.5 last:border-r-0"
										style={columnStyle(cell.column.getSize())}
										title={String(cell.getValue() ?? "")}
									>
										<div className="truncate">
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</div>
									</div>
								))}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}

function CsvEmptyState({ filePath }: { readonly filePath: string }) {
	return (
		<div className="flex h-full items-center justify-center px-6 py-8 text-center">
			<div className="max-w-sm space-y-2 text-sm text-neutral-600">
				<p className="font-medium text-neutral-800">No CSV rows to display.</p>
				<p>
					<span className="font-mono text-xs text-neutral-700">{filePath}</span>{" "}
					is empty or does not contain a header row.
				</p>
			</div>
		</div>
	);
}

function CsvLoadingSpinner() {
	return (
		<div className="flex h-full items-center justify-center px-3 py-2 text-muted-foreground">
			<div className="flex items-center gap-2 text-sm">
				<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
				<span>Loading CSV…</span>
			</div>
		</div>
	);
}

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

function decodeFileData(data: unknown): string {
	if (typeof data === "string") return data;
	if (data instanceof Uint8Array) return new TextDecoder().decode(data);
	if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
	if (ArrayBuffer.isView(data)) {
		return new TextDecoder().decode(
			new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
		);
	}
	if (Array.isArray(data)) {
		return new TextDecoder().decode(Uint8Array.from(data as number[]));
	}
	return "";
}

function columnStyle(width: number): CSSProperties {
	return {
		flex: `0 0 ${width}px`,
		width,
		minWidth: width,
		maxWidth: width,
	};
}

function assertFileId(fileId: unknown): asserts fileId is string {
	if (typeof fileId !== "string" || fileId.length === 0) {
		throw new Error("CsvView requires a non-empty fileId.");
	}
}

export const widget = createReactWidgetDefinition({
	kind: CSV_WIDGET_KIND,
	label: "CSV",
	description: "Display CSV files as a table.",
	icon: Table2,
	fileExtensions: ["csv"],
	component: ({ context, instance }) => (
		<LixProvider lix={context.lix}>
			<CsvView fileId={instance.state?.fileId as string} />
		</LixProvider>
	),
});
