import { Suspense, useEffect } from "react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Check, ExternalLink, FileText, Github, Loader2 } from "lucide-react";
import {
	LixProvider,
	useLix,
	useQuery,
	useQueryTakeFirst,
} from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { isMarkdownFilePath } from "@/extension-runtime/file-handlers";
import { EditorProvider } from "@/extensions/markdown/editor/editor-context";
import { TipTapEditor } from "@/extensions/markdown/editor/tip-tap-editor";
import {
	desktopWorkspaceApi,
	useDesktopWorkspaceDir,
} from "@/extensions/markdown/editor/desktop-workspace";
import type { EmptyMarkdownDefaultBlock } from "@/extensions/markdown/editor/tiptap-markdown-bridge";
import { renderMarkdownReviewDiffHtml } from "./render-review-diff-html";
import "./style.css";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { FILE_EXTENSION_KIND } from "../../extension-runtime/extension-instance-helpers";
import { FormattingToolbar } from "./components/formatting-toolbar";
import { SlashCommandMenu } from "./components/slash-command-menu";
import type { MarkdownBlockSnapshot, MarkdownReviewDiff } from "./review-diff";
import { decodeFileDataToText } from "@/lib/decode-file-data";
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
	useExternalWriteReview,
	useExternalWriteReviewData,
} from "@/shell/external-write-review-history";
import { AnimatedZap } from "@/components/animated-zap";

type MarkdownViewProps = {
	readonly fileId: string;
	readonly filePath?: string;
	readonly isActiveView?: boolean;
	readonly isPanelFocused?: boolean;
	readonly focusOnLoad?: boolean;
	readonly defaultBlock?: EmptyMarkdownDefaultBlock;
	readonly syncActiveFile?: boolean;
	readonly checkpointDiff?: CheckpointDiff | null;
	readonly checkpointDiffReviewId?: string;
	readonly registerExternalWriteReview?: (
		review: ExternalWriteReview,
	) => () => void;
	readonly onAcceptReviewDiff?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
		readonly review?: ExternalWriteReview;
	}) => Promise<void>;
	readonly onRejectReviewDiff?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
		readonly review?: ExternalWriteReview;
	}) => Promise<void>;
};

type HistoricalMarkdownBlockRow = {
	readonly start_commit_id: string;
	readonly snapshot_content: unknown;
};

type MarkdownFileRow = {
	readonly id: string;
	readonly path: string;
};

/**
 * Embeds the shared TipTap editor to render Markdown documents.
 *
 * @example
 * <MarkdownView fileId="file-123" filePath="/docs/guide.md" isActiveView />
 */
export function MarkdownView({
	fileId,
	filePath,
	isActiveView = true,
	isPanelFocused = true,
	focusOnLoad = false,
	defaultBlock,
	syncActiveFile = true,
	checkpointDiff,
	checkpointDiffReviewId,
	registerExternalWriteReview,
	onAcceptReviewDiff,
	onRejectReviewDiff,
}: MarkdownViewProps) {
	return (
		<Suspense fallback={<MarkdownLoadingSpinner />}>
			<MarkdownViewContent
				fileId={fileId}
				filePath={filePath}
				isActiveView={isActiveView}
				isPanelFocused={isPanelFocused}
				focusOnLoad={focusOnLoad}
				defaultBlock={defaultBlock}
				syncActiveFile={syncActiveFile}
				checkpointDiff={checkpointDiff}
				checkpointDiffReviewId={checkpointDiffReviewId}
				registerExternalWriteReview={registerExternalWriteReview}
				onAcceptReviewDiff={onAcceptReviewDiff}
				onRejectReviewDiff={onRejectReviewDiff}
			/>
		</Suspense>
	);
}

function MarkdownViewContent({ fileId, ...props }: MarkdownViewProps) {
	assertFileId(fileId);

	const fileRow = useQueryTakeFirst<MarkdownFileRow>(
		(lix) =>
			qb(lix)
				.selectFrom("lix_file")
				.select(["id", "path"])
				.where("id", "=", fileId)
				.limit(1),
		{ subscribe: false },
	);

	return <MarkdownViewLoaded fileId={fileId} fileRow={fileRow} {...props} />;
}

function MarkdownViewLoaded({
	fileId,
	fileRow,
	isActiveView = true,
	isPanelFocused = true,
	focusOnLoad = false,
	defaultBlock,
	syncActiveFile = true,
	checkpointDiff,
	checkpointDiffReviewId,
	registerExternalWriteReview,
	onAcceptReviewDiff,
	onRejectReviewDiff,
}: MarkdownViewProps & {
	readonly fileRow: MarkdownFileRow | undefined;
}) {
	const checkpointDiffFile = useMemo(
		() =>
			checkpointDiffFileForReviewId(
				checkpointDiff,
				checkpointDiffReviewId,
				fileId,
			),
		[checkpointDiff, checkpointDiffReviewId, fileId],
	);
	const effectiveFileRow =
		fileRow ??
		(checkpointDiffFile
			? { id: checkpointDiffFile.fileId, path: checkpointDiffFile.path }
			: undefined);
	const checkpointReview = useMemo(
		() =>
			checkpointDiffFile
				? checkpointDiffFileToReview(checkpointDiffFile)
				: null,
		[checkpointDiffFile],
	);
	const externalWriteReview = useExternalWriteReview({
		fileId: checkpointReview ? null : effectiveFileRow?.id,
		path: checkpointReview ? null : effectiveFileRow?.path,
	});
	const externalWriteReviewData = useExternalWriteReviewData(
		checkpointReview ? null : externalWriteReview,
	);
	useEffect(() => {
		if (!externalWriteReview) return;
		return registerExternalWriteReview?.(externalWriteReview);
	}, [externalWriteReview, registerExternalWriteReview]);
	const review = checkpointReview ?? externalWriteReview;
	const reviewData: ExternalWriteReviewData | null = checkpointDiffFile
		? {
				beforeData: checkpointDiffFile.beforeData,
				afterData: checkpointDiffFile.afterData,
			}
		: externalWriteReviewData;
	const reviewDiff: MarkdownReviewDiff | null = reviewData
		? {
				beforeMarkdown: decodeFileDataToText(reviewData.beforeData),
				afterMarkdown: decodeFileDataToText(reviewData.afterData),
			}
		: null;

	let content: ReactNode;

	if (!effectiveFileRow) {
		content = (
			<div className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">
				File not found in the workspace.
			</div>
		);
	} else if (!isMarkdownFilePath(effectiveFileRow.path)) {
		content = <UnsupportedFilePlaceholder filePath={effectiveFileRow.path} />;
	} else if (checkpointDiffFile && !fileRow) {
		content = (
			<div className="markdown-view markdown-review flex h-full flex-col bg-background">
				<div className="relative min-h-0 flex-1" data-attr="markdown-editor">
					{reviewDiff && review ? (
						<Suspense fallback={<MarkdownReviewOverlayFallback />}>
							<MarkdownReviewOverlay
								fileId={checkpointDiffFile.fileId}
								sourceFilePath={checkpointDiffFile.path}
								review={review}
								reviewDiff={reviewDiff}
								reviewId={checkpointDiffFile.reviewId}
								beforeCommitId={checkpointDiffFile.beforeCommitId}
								afterCommitId={checkpointDiffFile.afterCommitId}
								isActive={isActiveView && isPanelFocused}
								controls="none"
							/>
						</Suspense>
					) : (
						<MarkdownReviewOverlayFallback />
					)}
				</div>
			</div>
		);
	} else {
		content = (
			<EditorProvider>
				<div
					className={`markdown-view flex h-full flex-col bg-background ${
						reviewDiff ? "markdown-review" : ""
					}`}
				>
					<div className={reviewDiff ? "pointer-events-none" : undefined}>
						<FormattingToolbar />
					</div>
					<div className="relative min-h-0 flex-1" data-attr="markdown-editor">
						<TipTapEditor
							className="h-full"
							fileId={effectiveFileRow.id}
							filePath={effectiveFileRow.path}
							isActiveView={isActiveView}
							focusOnLoad={focusOnLoad}
							defaultBlock={defaultBlock}
						/>
						<MarkdownAutosaveHint
							enabled={isActiveView && isPanelFocused && !reviewDiff}
						/>
						{reviewDiff && review ? (
							<Suspense fallback={<MarkdownReviewOverlayFallback />}>
								<MarkdownReviewOverlay
									fileId={effectiveFileRow.id}
									sourceFilePath={effectiveFileRow.path}
									review={review}
									reviewDiff={reviewDiff}
									reviewId={review.reviewId}
									beforeCommitId={review.beforeCommitId}
									afterCommitId={review.afterCommitId}
									isActive={isActiveView && isPanelFocused}
									onAccept={onAcceptReviewDiff}
									onReject={onRejectReviewDiff}
									controls={checkpointDiffFile ? "none" : "review"}
								/>
							</Suspense>
						) : review ? (
							<MarkdownReviewOverlayFallback />
						) : null}
					</div>
					{reviewDiff ? null : <SlashCommandMenu />}
				</div>
			</EditorProvider>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{syncActiveFile &&
			fileRow &&
			!checkpointDiffFile &&
			isMarkdownFilePath(fileRow.path) ? (
				<ActiveFileSync fileId={fileRow?.id} isActiveView={isActiveView} />
			) : null}
			{content}
		</div>
	);
}

function MarkdownAutosaveHint({ enabled }: { readonly enabled: boolean }) {
	const [hintKey, setHintKey] = useState(0);

	useEffect(() => {
		if (enabled) return;
		setHintKey(0);
	}, [enabled]);

	useEffect(() => {
		if (!enabled) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			const usesPrimaryModifier = event.metaKey || event.ctrlKey;
			if (!usesPrimaryModifier || event.altKey || event.shiftKey) return;
			if (event.key.toLowerCase() !== "s") return;
			event.preventDefault();
			event.stopPropagation();
			setHintKey((current) => current + 1);
		};
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => {
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
		};
	}, [enabled]);

	useEffect(() => {
		if (hintKey === 0) return;
		const timeoutId = window.setTimeout(() => setHintKey(0), 2400);
		return () => window.clearTimeout(timeoutId);
	}, [hintKey]);

	if (hintKey === 0) return null;

	return (
		<div
			key={hintKey}
			className="markdown-autosave-hint"
			role="status"
			aria-live="polite"
			aria-atomic="true"
		>
			<span className="markdown-autosave-hint-icon" aria-hidden="true">
				<Check aria-hidden />
			</span>
			<span>
				<strong>Auto-saved.</strong> No Cmd+S needed.
			</span>
		</div>
	);
}

function MarkdownReviewOverlay({
	fileId,
	sourceFilePath,
	review,
	reviewDiff,
	reviewId,
	beforeCommitId,
	afterCommitId,
	isActive,
	controls = "review",
	onAccept,
	onReject,
}: {
	readonly fileId: string;
	readonly sourceFilePath: string;
	readonly review: ExternalWriteReview;
	readonly reviewDiff: MarkdownReviewDiff;
	readonly reviewId: string;
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
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
	const workspaceDirState = useDesktopWorkspaceDir();
	const { beforeBlocks, afterBlocks } = useMarkdownBlocksAtCommits(
		fileId,
		beforeCommitId,
		afterCommitId,
	);

	if (!workspaceDirState.loaded) {
		return <MarkdownReviewOverlayFallback />;
	}

	const workspaceApi = desktopWorkspaceApi();
	const workspacePath = workspaceDirState.workspaceDir;
	const resolveImageSrc =
		sourceFilePath && workspacePath && workspaceApi?.resolveMarkdownImageSrc
			? (src: string) =>
					workspaceApi.resolveMarkdownImageSrc({
						src,
						sourceFilePath,
						workspacePath,
					})
			: undefined;
	const enrichedReviewDiff = enrichMarkdownReviewDiff(
		reviewDiff,
		beforeBlocks,
		afterBlocks,
	);
	const diffHtml = renderMarkdownReviewDiffHtml(enrichedReviewDiff, {
		resolveImageSrc,
	});
	const rejectReview = () => void onReject?.({ fileId, reviewId, review });

	return (
		<div className="markdown-review-overlay">
			<div className="markdown-review-surface">
				<div className="ph-mask tiptap-container w-full h-full overflow-y-auto bg-background">
					<div
						className="ProseMirror tiptap w-full mx-auto"
						dangerouslySetInnerHTML={{ __html: diffHtml }}
					/>
				</div>
			</div>
			{controls === "review" ? (
				<ExternalWriteReviewControls
					isActive={isActive}
					onAccept={() => void onAccept?.({ fileId, reviewId, review })}
					onReject={rejectReview}
				/>
			) : null}
		</div>
	);
}

function enrichMarkdownReviewDiff(
	reviewDiff: MarkdownReviewDiff,
	beforeBlocks: MarkdownBlockSnapshot[] | undefined,
	afterBlocks: MarkdownBlockSnapshot[] | undefined,
): MarkdownReviewDiff {
	const beforeSnapshotsAvailable =
		beforeBlocks !== undefined &&
		(beforeBlocks.length > 0 || reviewDiff.beforeMarkdown.trim().length === 0);
	const afterSnapshotsAvailable =
		afterBlocks !== undefined &&
		(afterBlocks.length > 0 || reviewDiff.afterMarkdown.trim().length === 0);
	if (!beforeSnapshotsAvailable || !afterSnapshotsAvailable) {
		return reviewDiff;
	}
	return {
		...reviewDiff,
		beforeBlocks: beforeBlocks ?? [],
		afterBlocks: afterBlocks ?? [],
	};
}

function MarkdownReviewOverlayFallback() {
	return (
		<div className="markdown-review-overlay">
			<div className="markdown-review-surface">
				<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
					<Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
					<span>Loading review…</span>
				</div>
			</div>
		</div>
	);
}

function useMarkdownBlocksAtCommits(
	fileId: string,
	beforeCommitId: string | undefined,
	afterCommitId: string | undefined,
): {
	readonly beforeBlocks: MarkdownBlockSnapshot[] | undefined;
	readonly afterBlocks: MarkdownBlockSnapshot[] | undefined;
} {
	const rows = useQuery<HistoricalMarkdownBlockRow>(
		(lix) =>
			beforeCommitId && afterCommitId
				? historicalMarkdownBlocksQuery(lix, {
						beforeCommitId,
						afterCommitId,
						fileId,
					})
				: emptyMarkdownBlocksQuery(),
		{ subscribe: false },
	);
	if (!beforeCommitId || !afterCommitId) {
		return { beforeBlocks: undefined, afterBlocks: undefined };
	}
	return {
		beforeBlocks: parseHistoricalMarkdownBlocks(rows, beforeCommitId),
		afterBlocks: parseHistoricalMarkdownBlocks(rows, afterCommitId),
	};
}

function parseHistoricalMarkdownBlocks(
	rows: readonly HistoricalMarkdownBlockRow[],
	commitId: string,
): MarkdownBlockSnapshot[] {
	return rows
		.filter((row) => row.start_commit_id === commitId)
		.map((row) => parseHistoricalMarkdownBlock(row.snapshot_content))
		.filter((block): block is MarkdownBlockSnapshot => block !== null)
		.sort(
			(left, right) =>
				left.orderKey.localeCompare(right.orderKey) ||
				left.id.localeCompare(right.id),
		);
}

function historicalMarkdownBlocksQuery(
	lix: ReturnType<typeof useLix>,
	args: {
		readonly beforeCommitId: string;
		readonly afterCommitId: string;
		readonly fileId: string;
	},
) {
	const sql = `
		WITH ranked AS (
			SELECT
				start_commit_id,
				entity_pk,
				snapshot_content,
				depth,
				ROW_NUMBER() OVER (
					PARTITION BY start_commit_id, entity_pk
					ORDER BY depth ASC
				) AS rn
			FROM lix_state_history
			WHERE start_commit_id IN (?, ?)
				AND file_id = ?
				AND schema_key = 'markdown_block'
		)
		SELECT start_commit_id, snapshot_content
		FROM ranked
		WHERE rn = 1
			AND snapshot_content IS NOT NULL
	`;
	const parameters = [
		args.beforeCommitId,
		args.afterCommitId,
		args.fileId,
	] as const;
	return {
		compile: () => ({ sql, parameters }),
		execute: async () => {
			const result = await lix.execute(sql, parameters);
			return result.rows.map(
				(row) => row.toObject() as HistoricalMarkdownBlockRow,
			);
		},
	};
}

function emptyMarkdownBlocksQuery() {
	return {
		compile: () => ({ sql: "SELECT 1 WHERE 0", parameters: [] }),
		execute: async () => [] as HistoricalMarkdownBlockRow[],
	};
}

function parseHistoricalMarkdownBlock(
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

function safeJsonParse(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

function checkpointDiffFileForReviewId(
	checkpointDiff: CheckpointDiff | null | undefined,
	reviewId: string | undefined,
	fileId: string,
): CheckpointDiffFile | null {
	if (!checkpointDiff || !reviewId) return null;
	return (
		checkpointDiff.files.find(
			(file) => file.reviewId === reviewId && file.fileId === fileId,
		) ?? null
	);
}

function checkpointDiffFileToReview(
	file: CheckpointDiffFile,
): ExternalWriteReview {
	return {
		fileId: file.fileId,
		path: file.path,
		reviewId: file.reviewId,
		beforeCommitId: file.beforeCommitId,
		afterCommitId: file.afterCommitId,
		agentTurnRangeIds: [],
	};
}

function UnsupportedFilePlaceholder({
	filePath,
}: {
	readonly filePath: string;
}): ReactNode {
	return (
		<div className="flex h-full items-center justify-center px-6 py-8 text-center">
			<div className="max-w-sm space-y-2 text-sm text-[var(--color-text-secondary)]">
				<p className="font-medium text-[var(--color-text-primary)]">
					This file type is not supported yet.
				</p>
				<p>
					Flashtype only opens markdown files in this editor, so{" "}
					<span className="font-mono text-xs text-[var(--color-text-secondary)]">
						{filePath}
					</span>{" "}
					was left blank to avoid damaging its formatting.
				</p>
				<p>
					<a
						href="https://github.com/opral/flashtype/issues"
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1 font-medium text-[var(--color-icon-brand)] underline underline-offset-2 hover:text-[var(--color-text-link-hover)]"
					>
						<Github className="size-3.5" aria-hidden="true" />
						Open an issue on GitHub
						<ExternalLink className="size-3" aria-hidden="true" />
					</a>{" "}
					for support for more file types.
				</p>
			</div>
		</div>
	);
}

function assertFileId(fileId: unknown): asserts fileId is string {
	if (typeof fileId !== "string" || fileId.length === 0) {
		throw new Error("MarkdownView requires a non-empty fileId.");
	}
}

function ActiveFileSync({
	fileId,
	isActiveView,
}: {
	readonly fileId?: string;
	readonly isActiveView: boolean;
}) {
	const activeFile = useQueryTakeFirst<{ value: string }>((lix) =>
		qb(lix)
			.selectFrom("lix_key_value_by_branch")
			.where("lixcol_branch_id", "=", "global")
			.where("key", "=", "flashtype_active_file_id")
			.select(["value"]),
	);

	return (
		<ActiveFileSyncEffect
			fileId={fileId}
			isActiveView={isActiveView}
			activeFileId={
				typeof activeFile?.value === "string" ? activeFile.value : null
			}
		/>
	);
}

function ActiveFileSyncEffect({
	fileId,
	isActiveView,
	activeFileId,
}: {
	readonly fileId?: string;
	readonly isActiveView: boolean;
	readonly activeFileId: string | null;
}) {
	const lix = useLix();

	useEffect(() => {
		if (!fileId) return;
		if (!isActiveView) return;
		if (activeFileId === fileId) return;
		void qb(lix)
			.insertInto("lix_key_value_by_branch")
			.values({
				key: "flashtype_active_file_id",
				value: fileId,
				lixcol_branch_id: "global",
				lixcol_global: true,
				lixcol_untracked: true,
			})
			.onConflict((oc) =>
				oc.columns(["key", "lixcol_branch_id"]).doUpdateSet({ value: fileId }),
			)
			.execute();
	}, [lix, fileId, activeFileId, isActiveView]);

	return null;
}

function MarkdownLoadingSpinner(): ReactNode {
	return (
		<div className="flex h-full items-center justify-center px-3 py-2 text-muted-foreground">
			<div className="flex items-center gap-2 text-sm">
				<AnimatedZap size={13} tone="muted" className="shrink-0" />
				<span>Loading editor…</span>
			</div>
		</div>
	);
}

/**
 * Markdown content view definition used by the registry.
 *
 * @example
 * import { extension as markdownView } from "@/extensions/markdown";
 */
export const extension = createReactExtensionDefinition({
	kind: FILE_EXTENSION_KIND,
	label: "File",
	description: "Display file contents.",
	icon: FileText,
	fileExtensions: ["md", "markdown"],
	component: ({ context, instance }) => (
		<LixProvider lix={context.lix}>
			<MarkdownView
				fileId={instance.state?.fileId as string}
				filePath={instance.state?.filePath as string | undefined}
				isActiveView={context.isActiveView ?? false}
				isPanelFocused={context.isPanelFocused ?? false}
				focusOnLoad={Boolean(instance.state?.focusOnLoad)}
				defaultBlock={
					instance.state?.defaultBlock === "heading1" ? "heading1" : undefined
				}
				syncActiveFile={false}
				checkpointDiff={context.checkpointDiff}
				checkpointDiffReviewId={
					typeof instance.state?.checkpointDiffReviewId === "string"
						? instance.state.checkpointDiffReviewId
						: undefined
				}
				registerExternalWriteReview={context.registerExternalWriteReview}
				onAcceptReviewDiff={context.acceptExternalWriteReview}
				onRejectReviewDiff={context.rejectExternalWriteReview}
			/>
		</LixProvider>
	),
});
