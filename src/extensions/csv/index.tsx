import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Table2 } from "lucide-react";
import {
	DataEditor,
	GridCellKind,
	type GridCell,
	type GridColumn,
	type Item,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { LixProvider, useLix, useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import {
	decodeFileDataToBytes,
	decodeFileDataToText,
} from "@/lib/decode-file-data";
import { ExternalWriteReviewControls } from "@/extension-runtime/external-write-review-controls";
import type {
	ExternalWriteReview,
	ExternalWriteReviewData,
} from "@/extension-runtime/external-write-review";
import type {
	CheckpointDiff,
	CheckpointDiffFile,
} from "@/extension-runtime/checkpoint-diff";
import {
	editorRevisionMode,
	editorRevisionReviewId,
	normalizeEditorRevisionState,
	type EditorRevisionState,
} from "@/extension-runtime/editor-revision-state";
import {
	useExternalWriteReview,
	useExternalWriteReviewData,
} from "@/shell/external-write-review-history";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { CSV_EXTENSION_KIND } from "../../extension-runtime/extension-instance-helpers";
import { parseCsv, type CsvParseResult, type CsvRow } from "./csv-data";
import { renderCsvReviewDiffHtml } from "./render-review-diff-html";
import "./style.css";

type CsvViewProps = {
	readonly fileId: string;
	readonly filePath?: string;
	readonly isActiveView?: boolean;
	readonly isPanelFocused?: boolean;
	readonly checkpointDiff?: CheckpointDiff | null;
	readonly beforeCommitId?: string | null;
	readonly afterCommitId?: string | null;
	readonly registerExternalWriteReview?: (
		review: ExternalWriteReview,
	) => () => void;
	readonly onAcceptReview?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
		readonly review?: ExternalWriteReview;
	}) => Promise<void>;
	readonly onRejectReview?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
		readonly review?: ExternalWriteReview;
	}) => Promise<void>;
};

const COLUMN_MIN_WIDTH = 112;
const COLUMN_MAX_WIDTH = 520;
const COLUMN_SAMPLE_ROW_LIMIT = 100;
const ROW_HEIGHT = 48;
const HEADER_HEIGHT = 40;
const CSV_GRID_THEME = {
	accentColor: "rgb(194, 65, 12)",
	accentFg: "rgb(255, 255, 255)",
	accentLight: "rgb(251, 239, 228)",
	bgHeader: "rgb(255, 255, 255)",
	bgHeaderHasFocus: "rgb(255, 255, 255)",
	bgHeaderHovered: "rgb(255, 255, 255)",
	borderColor: "rgb(244, 241, 236)",
	headerBottomBorderColor: "rgb(244, 241, 236)",
	horizontalBorderColor: "rgb(244, 241, 236)",
	linkColor: "rgb(194, 65, 12)",
	resizeIndicatorColor: "rgb(234, 88, 12)",
	textHeaderSelected: "rgb(124, 45, 18)",
};

type CsvFileRow = {
	readonly id: string;
	readonly path: string;
	readonly data: Uint8Array;
};

type HistoricalFileSnapshotRow = {
	readonly id: string;
	readonly path: string;
	readonly data: unknown;
};

type HistoricalCsvFile = {
	readonly fileRow: CsvFileRow;
	readonly review: ExternalWriteReview | null;
	readonly reviewData: ExternalWriteReviewData | undefined;
	readonly controls: "review" | "none";
};

const EMPTY_FILE_DATA = new Uint8Array();

export function CsvView({
	fileId,
	filePath,
	isActiveView = true,
	isPanelFocused = true,
	checkpointDiff,
	beforeCommitId,
	afterCommitId,
	registerExternalWriteReview,
	onAcceptReview,
	onRejectReview,
}: CsvViewProps) {
	return (
		<Suspense fallback={<CsvLoadingSpinner />}>
			<CsvViewContent
				fileId={fileId}
				filePath={filePath}
				isActiveView={isActiveView}
				isPanelFocused={isPanelFocused}
				checkpointDiff={checkpointDiff}
				beforeCommitId={beforeCommitId}
				afterCommitId={afterCommitId}
				registerExternalWriteReview={registerExternalWriteReview}
				onAcceptReview={onAcceptReview}
				onRejectReview={onRejectReview}
			/>
		</Suspense>
	);
}

function CsvViewContent({ fileId, ...props }: CsvViewProps) {
	assertFileId(fileId);

	const fileRow = useQueryTakeFirst<CsvFileRow>((lix) =>
		qb(lix)
			.selectFrom("lix_file")
			.select(["id", "path", "data"])
			.where("id", "=", fileId)
			.limit(1),
	);
	return <CsvViewData fileId={fileId} fileRow={fileRow} {...props} />;
}

function CsvViewData({
	fileId,
	filePath,
	fileRow,
	checkpointDiff,
	beforeCommitId,
	afterCommitId,
	registerExternalWriteReview,
	...props
}: CsvViewProps & {
	readonly fileRow?: CsvFileRow | undefined;
}) {
	const editorRevision = normalizeEditorRevisionState({
		beforeCommitId,
		afterCommitId,
	});
	const revisionMode = editorRevisionMode(editorRevision);
	if (revisionMode !== "editor") {
		return (
			<CsvHistoricalViewData
				fileId={fileId}
				filePath={filePath}
				fileRow={fileRow}
				checkpointDiff={checkpointDiff}
				editorRevision={editorRevision}
				{...props}
			/>
		);
	}

	const effectiveFileRow = fileRow;
	const externalWriteReview = useExternalWriteReview({
		fileId: effectiveFileRow?.id,
		path: effectiveFileRow?.path,
	});
	useEffect(() => {
		if (!externalWriteReview) return;
		return registerExternalWriteReview?.(externalWriteReview);
	}, [externalWriteReview, registerExternalWriteReview]);

	if (!effectiveFileRow) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">
				File not found in the workspace.
			</div>
		);
	}

	return (
		<CsvViewLoaded
			fileRow={effectiveFileRow}
			externalWriteReview={externalWriteReview}
			reviewControls="review"
			{...props}
		/>
	);
}

function CsvHistoricalViewData({
	fileId,
	filePath,
	fileRow,
	checkpointDiff,
	editorRevision,
	...props
}: Omit<CsvViewProps, "fileId"> & {
	readonly fileId: string;
	readonly fileRow?: CsvFileRow | undefined;
	readonly editorRevision: EditorRevisionState;
}) {
	const checkpointDiffFile = useMemo(
		() =>
			checkpointDiffFileForRevision(
				checkpointDiff,
				fileId,
				filePath ?? fileRow?.path,
				editorRevision,
			),
		[checkpointDiff, editorRevision, fileId, filePath, fileRow?.path],
	);
	const beforeSnapshot = useHistoricalFileSnapshot(
		fileId,
		checkpointDiffFile ? null : editorRevision.beforeCommitId,
	);
	const afterSnapshot = useHistoricalFileSnapshot(
		fileId,
		checkpointDiffFile ? null : editorRevision.afterCommitId,
	);
	const historicalFile = useMemo(
		() =>
			buildHistoricalCsvFile({
				fileId,
				filePath,
				fileRow,
				revision: editorRevision,
				checkpointDiffFile,
				beforeSnapshot,
				afterSnapshot,
			}),
		[
			beforeSnapshot,
			checkpointDiffFile,
			editorRevision,
			fileId,
			filePath,
			fileRow,
			afterSnapshot,
		],
	);

	if (!historicalFile?.fileRow) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">
				File not found in the workspace.
			</div>
		);
	}

	return (
		<CsvViewLoaded
			fileRow={historicalFile.fileRow}
			externalWriteReview={historicalFile.review}
			reviewDataOverride={historicalFile.reviewData}
			reviewControls={historicalFile.controls}
			{...props}
		/>
	);
}

function CsvViewLoaded({
	fileRow,
	externalWriteReview,
	reviewDataOverride,
	reviewControls = "review",
	isActiveView = true,
	isPanelFocused = true,
	onAcceptReview,
	onRejectReview,
}: Omit<CsvViewProps, "fileId"> & {
	readonly fileRow: CsvFileRow;
	readonly externalWriteReview: ExternalWriteReview | null;
	readonly reviewDataOverride?: ExternalWriteReviewData;
	readonly reviewControls?: "review" | "none";
}) {
	const parsed = useMemo<CsvParseResult>(() => {
		return parseCsv(decodeFileDataToText(fileRow.data));
	}, [fileRow]);

	return (
		<div className="csv-view flex min-h-0 flex-1 flex-col bg-background">
			{parsed.warnings.length > 0 ? (
				<div className="mx-5 mt-3 flex shrink-0 items-start gap-2 rounded-[8px] border border-[var(--color-border-notice-warning)] bg-[var(--color-bg-notice-warning)] px-3 py-2 text-xs text-[var(--color-text-notice-warning)]">
					<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
					<span className="min-w-0 truncate">{parsed.warnings[0]}</span>
				</div>
			) : null}
			<div className="relative min-h-0 flex-1 overflow-hidden">
				{parsed.columns.length === 0 ? (
					<CsvEmptyState filePath={fileRow.path} />
				) : (
					<CsvTable parsed={parsed} isActiveView={isActiveView} />
				)}
				{externalWriteReview ? (
					<CsvReviewOverlay
						fileId={fileRow.id}
						review={externalWriteReview}
						reviewDataOverride={reviewDataOverride}
						isActive={isActiveView && isPanelFocused}
						onAccept={onAcceptReview}
						onReject={onRejectReview}
						controls={reviewControls}
					/>
				) : null}
			</div>
		</div>
	);
}

function CsvReviewOverlay({
	fileId,
	review,
	reviewDataOverride,
	isActive,
	controls = "review",
	onAccept,
	onReject,
}: {
	readonly fileId: string;
	readonly review: ExternalWriteReview;
	readonly reviewDataOverride?: ExternalWriteReviewData;
	readonly isActive: boolean;
	readonly controls?: "review" | "none";
	readonly onAccept?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
		readonly review?: ExternalWriteReview;
	}) => Promise<void>;
	readonly onReject?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
		readonly review?: ExternalWriteReview;
	}) => Promise<void>;
}) {
	const externalReviewData = useExternalWriteReviewData(
		reviewDataOverride ? null : review,
	);
	const reviewData = reviewDataOverride ?? externalReviewData;
	const diffHtml = useMemo(
		() => (reviewData ? renderCsvReviewDiffHtml(reviewData) : null),
		[reviewData],
	);
	const rejectReview = () =>
		void onReject?.({ fileId, reviewId: review.reviewId, review });

	return (
		<div className="csv-review-overlay">
			{diffHtml ? (
				<div
					className="ph-mask csv-review-table"
					dangerouslySetInnerHTML={{ __html: diffHtml }}
				/>
			) : (
				<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
					<Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
					<span>Loading review…</span>
				</div>
			)}
			{controls === "review" ? (
				<ExternalWriteReviewControls
					isActive={isActive}
					onAccept={() =>
						void onAccept?.({ fileId, reviewId: review.reviewId, review })
					}
					onReject={rejectReview}
				/>
			) : null}
		</div>
	);
}

function CsvTable({
	parsed,
	isActiveView,
}: {
	readonly parsed: CsvParseResult;
	readonly isActiveView: boolean;
}) {
	const initialColumnWidths = useMemo(
		() =>
			parsed.columns.map((header, index) =>
				measureColumnWidth(header, parsed.rows, index),
			),
		[parsed.columns, parsed.rows],
	);
	const [columnWidthOverrides, setColumnWidthOverrides] = useState<
		Record<number, number>
	>({});
	useEffect(() => {
		setColumnWidthOverrides({});
	}, [parsed]);
	useEffect(() => {
		if (!isActiveView) return;
		const frame = window.requestAnimationFrame(() => {
			window.dispatchEvent(new Event("resize"));
		});
		return () => window.cancelAnimationFrame(frame);
	}, [isActiveView]);
	const columns = useMemo<GridColumn[]>(() => {
		return parsed.columns.map((title, index) => ({
			id: String(index),
			title,
			width: columnWidthOverrides[index] ?? initialColumnWidths[index],
		}));
	}, [columnWidthOverrides, initialColumnWidths, parsed.columns]);
	const getCellContent = useCallback(
		([columnIndex, rowIndex]: Item): GridCell => {
			const value = parsed.rows[rowIndex]?.cells[columnIndex] ?? "";
			const linkUrl = toExternalLinkUrl(value);
			if (linkUrl) {
				return {
					kind: GridCellKind.Uri,
					data: linkUrl,
					displayData: value,
					hoverEffect: true,
					allowOverlay: false,
					readonly: true,
					copyData: value,
					onClickUri: (event) => {
						event.preventDefault();
						void window.flashtypeDesktop?.app.openExternal({ url: linkUrl });
					},
				};
			}
			return {
				kind: GridCellKind.Text,
				data: value,
				displayData: value,
				allowOverlay: false,
				readonly: true,
				copyData: value,
			};
		},
		[parsed.rows],
	);
	const onColumnResizeEnd = useCallback(
		(_column: GridColumn, newSize: number, columnIndex: number) => {
			setColumnWidthOverrides((current) => ({
				...current,
				[columnIndex]: clamp(newSize, COLUMN_MIN_WIDTH, COLUMN_MAX_WIDTH),
			}));
		},
		[],
	);

	return (
		<div className="ph-mask ph-no-capture h-full min-h-0 flex-1 bg-background">
			<DataEditor
				className="csv-data-grid"
				columns={columns}
				rows={parsed.rows.length}
				getCellContent={getCellContent}
				getCellsForSelection={true}
				width="100%"
				height="100%"
				rowHeight={ROW_HEIGHT}
				headerHeight={HEADER_HEIGHT}
				minColumnWidth={COLUMN_MIN_WIDTH}
				maxColumnWidth={COLUMN_MAX_WIDTH}
				maxColumnAutoWidth={COLUMN_MAX_WIDTH}
				onColumnResizeEnd={onColumnResizeEnd}
				rowMarkers="number"
				rangeSelect="multi-rect"
				columnSelect="multi"
				rowSelect="multi"
				copyHeaders={true}
				onPaste={false}
				fillHandle={false}
				freezeColumns={0}
				fixedShadowX={false}
				fixedShadowY={false}
				smoothScrollX={true}
				theme={CSV_GRID_THEME}
			/>
		</div>
	);
}

function CsvEmptyState({ filePath }: { readonly filePath: string }) {
	return (
		<div className="flex h-full items-center justify-center px-6 py-8 text-center">
			<div className="max-w-sm space-y-2 text-sm text-[var(--color-text-secondary)]">
				<p className="font-medium text-[var(--color-text-primary)]">
					No CSV rows to display.
				</p>
				<p>
					<span className="ph-mask font-mono text-xs text-[var(--color-text-secondary)]">
						{filePath}
					</span>{" "}
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

function measureColumnWidth(
	header: string,
	rows: readonly CsvRow[],
	columnIndex: number,
): number {
	let widest = textWidthEstimate(header, true);
	for (const row of rows.slice(0, COLUMN_SAMPLE_ROW_LIMIT)) {
		widest = Math.max(
			widest,
			textWidthEstimate(row.cells[columnIndex] ?? "", false),
		);
	}
	return clamp(Math.ceil(widest + 32), COLUMN_MIN_WIDTH, COLUMN_MAX_WIDTH);
}

function textWidthEstimate(value: string, isHeader: boolean): number {
	const text = value.trim();
	if (text.length === 0) return 0;

	let width = isHeader ? 10 : 0;
	for (const char of text) {
		if (char === " " || char === "," || char === "." || char === ":") {
			width += 4;
		} else if (/[ilIj|]/.test(char)) {
			width += 4.5;
		} else if (/[mwMW@%#]/.test(char)) {
			width += 11;
		} else if (/[A-Z0-9]/.test(char)) {
			width += 8;
		} else {
			width += 7;
		}
	}
	return width;
}

function toExternalLinkUrl(value: string): string | null {
	const text = value.trim();
	if (/^https?:\/\/\S+$/i.test(text)) {
		return text;
	}
	if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
		return `mailto:${text}`;
	}
	return null;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function useHistoricalFileSnapshot(
	fileId: string,
	commitId: string | null,
): HistoricalFileSnapshotRow | undefined {
	const lix = useLix();
	const [snapshot, setSnapshot] = useState<
		HistoricalFileSnapshotRow | undefined
	>(undefined);
	useEffect(() => {
		if (!commitId) {
			setSnapshot(undefined);
			return;
		}
		let cancelled = false;
		setSnapshot(undefined);
		void qb(lix)
			.selectFrom("lix_file_history")
			.select(["id", "path", "data"])
			.where("id", "=", fileId)
			.where("lixcol_start_commit_id", "=", commitId)
			.where("lixcol_depth", "=", 0)
			.where("data", "is not", null)
			.limit(1)
			.executeTakeFirst()
			.then((row) => {
				if (!cancelled) {
					setSnapshot(row as HistoricalFileSnapshotRow | undefined);
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					console.warn("Failed to load historical CSV snapshot", error);
					setSnapshot(undefined);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [commitId, fileId, lix]);
	return snapshot;
}

function checkpointDiffFileForRevision(
	checkpointDiff: CheckpointDiff | null | undefined,
	fileId: string,
	filePath: string | undefined,
	revision: EditorRevisionState,
): CheckpointDiffFile | null {
	if (!checkpointDiff || !filePath) return null;
	return (
		checkpointDiff.files.find(
			(file) => {
				const afterCommitId = checkpointDiff.afterIsActiveHead
					? null
					: file.afterCommitId;
				return (
					file.fileId === fileId &&
					file.path === filePath &&
					file.beforeCommitId === revision.beforeCommitId &&
					afterCommitId === revision.afterCommitId
				);
			},
		) ?? null
	);
}

function buildHistoricalCsvFile(args: {
	readonly fileId: string;
	readonly filePath: string | undefined;
	readonly fileRow: CsvFileRow | undefined;
	readonly revision: EditorRevisionState;
	readonly checkpointDiffFile: CheckpointDiffFile | null;
	readonly beforeSnapshot: HistoricalFileSnapshotRow | undefined;
	readonly afterSnapshot: HistoricalFileSnapshotRow | undefined;
}): HistoricalCsvFile | null {
	const mode = editorRevisionMode(args.revision);
	if (mode === "editor") return null;
	const path =
		args.checkpointDiffFile?.path ??
		args.afterSnapshot?.path ??
		args.beforeSnapshot?.path ??
		args.fileRow?.path ??
		args.filePath;
	if (!path) return null;

	if (mode === "snapshot") {
		const data = args.checkpointDiffFile
			? args.checkpointDiffFile.afterData
			: args.afterSnapshot
				? decodeFileDataToBytes(args.afterSnapshot.data)
				: null;
		if (!data) return null;
		return {
			fileRow: {
				id: args.fileId,
				path,
				data,
			},
			review: null,
			reviewData: undefined,
			controls: "none",
		};
	}

	const beforeData =
		args.checkpointDiffFile?.beforeData ??
		(args.beforeSnapshot
			? decodeFileDataToBytes(args.beforeSnapshot.data)
			: EMPTY_FILE_DATA);
	const afterData =
		args.checkpointDiffFile?.afterData ??
		(args.revision.afterCommitId
			? args.afterSnapshot
				? decodeFileDataToBytes(args.afterSnapshot.data)
				: EMPTY_FILE_DATA
			: args.fileRow
				? decodeFileDataToBytes(args.fileRow.data)
				: EMPTY_FILE_DATA);

	return {
		fileRow: {
			id: args.fileId,
			path,
			data: afterData,
		},
		review: {
			fileId: args.fileId,
			path,
			reviewId:
				args.checkpointDiffFile?.reviewId ??
				editorRevisionReviewId({
					fileId: args.fileId,
					path,
					beforeCommitId: args.revision.beforeCommitId,
					afterCommitId: args.revision.afterCommitId,
				}),
			beforeCommitId: args.revision.beforeCommitId ?? "",
			afterCommitId: args.revision.afterCommitId ?? "",
			agentTurnRangeIds: [],
		},
		reviewData: {
			beforeData,
			afterData,
		},
		controls: "none",
	};
}

function assertFileId(fileId: unknown): asserts fileId is string {
	if (typeof fileId !== "string" || fileId.length === 0) {
		throw new Error("CsvView requires a non-empty fileId.");
	}
}

export const extension = createReactExtensionDefinition({
	kind: CSV_EXTENSION_KIND,
	label: "CSV",
	description: "Display CSV files as a table.",
	icon: Table2,
	fileExtensions: ["csv"],
	component: ({ context, instance }) => (
		<LixProvider lix={context.lix}>
			<CsvView
				fileId={instance.state?.fileId as string}
				filePath={instance.state?.filePath as string | undefined}
				checkpointDiff={context.checkpointDiff}
				beforeCommitId={
					typeof instance.state?.beforeCommitId === "string"
						? instance.state.beforeCommitId
						: null
				}
				afterCommitId={
					typeof instance.state?.afterCommitId === "string"
						? instance.state.afterCommitId
						: null
				}
				onAcceptReview={context.acceptExternalWriteReview}
				onRejectReview={context.rejectExternalWriteReview}
				registerExternalWriteReview={context.registerExternalWriteReview}
				isActiveView={context.isActiveView ?? false}
				isPanelFocused={context.isPanelFocused ?? false}
			/>
		</LixProvider>
	),
});
