import { Suspense, useMemo, useRef, type CSSProperties } from "react";
import { AlertTriangle, Loader2, Table2 } from "lucide-react";
import {
	flexRender,
	getCoreRowModel,
	useReactTable,
	type ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { LixProvider, useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { decodeFileDataToText } from "@/lib/decode-file-data";
import { ExternalWriteReviewControls } from "@/widget-runtime/external-write-review-controls";
import {
	EXTERNAL_WRITE_REVIEW_LAUNCH_ARG,
	type ExternalWriteReview,
} from "@/widget-runtime/external-write-review";
import { createReactWidgetDefinition } from "../../widget-runtime/react-widget";
import { CSV_WIDGET_KIND } from "../../widget-runtime/widget-instance-helpers";
import { parseCsv, type CsvParseResult, type CsvRow } from "./csv-data";
import { renderCsvReviewDiffHtml } from "./render-review-diff-html";
import "./style.css";

type CsvViewProps = {
	readonly fileId: string;
	readonly externalWriteReview?: ExternalWriteReview | null;
	readonly isActiveView?: boolean;
	readonly isPanelFocused?: boolean;
	readonly onAcceptReview?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
	}) => void;
	readonly onRejectReview?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
	}) => Promise<void>;
};

const COLUMN_MIN_WIDTH = 72;
const ROW_HEIGHT = 48;

export function CsvView({
	fileId,
	externalWriteReview = null,
	isActiveView = true,
	isPanelFocused = true,
	onAcceptReview,
	onRejectReview,
}: CsvViewProps) {
	return (
		<Suspense fallback={<CsvLoadingSpinner />}>
			<CsvViewContent
				fileId={fileId}
				externalWriteReview={externalWriteReview}
				isActiveView={isActiveView}
				isPanelFocused={isPanelFocused}
				onAcceptReview={onAcceptReview}
				onRejectReview={onRejectReview}
			/>
		</Suspense>
	);
}

function CsvViewContent({
	fileId,
	externalWriteReview = null,
	isActiveView = true,
	isPanelFocused = true,
	onAcceptReview,
	onRejectReview,
}: CsvViewProps) {
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
		return parseCsv(decodeFileDataToText(fileRow.data));
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
		<div className="csv-view flex min-h-0 flex-1 flex-col bg-background">
			{parsed.warnings.length > 0 ? (
				<div className="mx-5 mt-3 flex shrink-0 items-start gap-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
					<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
					<span className="min-w-0 truncate">{parsed.warnings[0]}</span>
				</div>
			) : null}
			<div className="relative min-h-0 flex-1 overflow-hidden">
				<CsvTable parsed={parsed} />
				{externalWriteReview ? (
					<CsvReviewOverlay
						fileId={fileRow.id}
						review={externalWriteReview}
						isActive={isActiveView && isPanelFocused}
						onAccept={onAcceptReview}
						onReject={onRejectReview}
					/>
				) : null}
			</div>
		</div>
	);
}

function CsvReviewOverlay({
	fileId,
	review,
	isActive,
	onAccept,
	onReject,
}: {
	readonly fileId: string;
	readonly review: ExternalWriteReview;
	readonly isActive: boolean;
	readonly onAccept?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
	}) => void;
	readonly onReject?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
	}) => Promise<void>;
}) {
	const diffHtml = useMemo(() => renderCsvReviewDiffHtml(review), [review]);
	const rejectReview = () =>
		void onReject?.({ fileId, reviewId: review.reviewId });

	return (
		<div className="csv-review-overlay">
			<div
				className="csv-review-table"
				dangerouslySetInnerHTML={{ __html: diffHtml }}
			/>
			<ExternalWriteReviewControls
				isActive={isActive}
				onAccept={() => onAccept?.({ fileId, reviewId: review.reviewId })}
				onReject={rejectReview}
			/>
		</div>
	);
}

function CsvTable({ parsed }: { readonly parsed: CsvParseResult }) {
	const parentRef = useRef<HTMLDivElement | null>(null);
	const columns = useMemo<ColumnDef<CsvRow>[]>(() => {
		return parsed.columns.map((header, index) => ({
			id: `column_${index}`,
			header,
			accessorFn: (row: CsvRow) => row.cells[index] ?? "",
		}));
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
		measureElement:
			typeof window !== "undefined" && !navigator.userAgent.includes("Firefox")
				? (element) => element?.getBoundingClientRect().height
				: undefined,
		overscan: 12,
	});
	const totalWidth = parsed.columns.length * COLUMN_MIN_WIDTH;

	return (
		<div
			ref={parentRef}
			className="h-full min-h-0 flex-1 overflow-auto bg-background"
		>
			<div style={{ minWidth: totalWidth }} className="relative w-full">
				<div className="sticky top-0 z-10 flex h-10 w-full border-b border-island-divider bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.04em] text-neutral-600">
					{table.getHeaderGroups()[0]?.headers.map((header) => (
						<div
							key={header.id}
							className="flex h-10 items-center border-r border-[#f1ece5] px-4 last:border-r-0"
							style={columnStyle()}
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
								data-index={virtualRow.index}
								ref={virtualizer.measureElement}
								className="absolute left-0 flex w-full border-b border-[#f4f1ec] text-[13.5px] text-neutral-700 transition-colors hover:bg-[#faf6f0]"
								style={{
									minHeight: virtualRow.size,
									transform: `translateY(${virtualRow.start}px)`,
								}}
							>
								{row.getVisibleCells().map((cell) => (
									<div
										key={cell.id}
										className="border-r border-[#f4f1ec] px-4 py-0 last:border-r-0"
										style={columnStyle()}
										title={String(cell.getValue() ?? "")}
									>
										<div
											className={cellValueClassName(
												String(cell.getValue() ?? ""),
												cell.column.id === "column_0",
											)}
										>
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

function cellValueClassName(value: string, isFirstColumn: boolean): string {
	const base = "flex min-h-12 items-center whitespace-normal break-words py-2";
	if (isEmailLike(value)) {
		return `${base} font-mono text-[12.5px] text-brand-700`;
	}
	if (isNumericValue(value)) {
		return `${base} font-mono text-[13px] text-neutral-700`;
	}
	if (isFirstColumn) {
		return `${base} font-mono text-[12.5px] text-neutral-400`;
	}
	return `${base} font-normal text-neutral-900`;
}

function isEmailLike(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isNumericValue(value: string): boolean {
	return value.trim() !== "" && /^-?\d+(?:\.\d+)?$/.test(value.trim());
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

export { parseCsv, renderCsvReviewDiffHtml };

function columnStyle(): CSSProperties {
	return {
		flex: "1 0 0",
		minWidth: COLUMN_MIN_WIDTH,
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
			<CsvView
				fileId={instance.state?.fileId as string}
				externalWriteReview={
					(instance.launchArgs?.[EXTERNAL_WRITE_REVIEW_LAUNCH_ARG] as
						| ExternalWriteReview
						| undefined) ?? null
				}
				onAcceptReview={context.acceptExternalWriteReview}
				onRejectReview={context.rejectExternalWriteReview}
				isActiveView={context.isActiveView ?? false}
				isPanelFocused={context.isPanelFocused ?? false}
			/>
		</LixProvider>
	),
});
