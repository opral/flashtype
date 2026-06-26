import { Suspense, useEffect } from "react";
import { useMemo, useRef, useState } from "react";
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
import { renderMarkdownReviewDiffHtml } from "./render-review-diff-html";
import "./style.css";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { FILE_EXTENSION_KIND } from "../../extension-runtime/extension-instance-helpers";
import { FormattingToolbar } from "./components/formatting-toolbar";
import { SlashCommandMenu } from "./components/slash-command-menu";
import type { MarkdownBlockSnapshot, MarkdownReviewDiff } from "./review-diff";
import { decodeFileDataToText } from "@/lib/decode-file-data";
import { ExternalWriteReviewControls } from "@/extension-runtime/external-write-review-controls";
import {
	EXTERNAL_WRITE_REVIEW_LAUNCH_ARG,
	type ExternalWriteReview,
	type GranularReviewResolution,
	type GranularReviewResolutionOutcome,
} from "@/extension-runtime/external-write-review";
import { planGranularReview } from "./granular-review-plan";
import { MarkdownReviewStepper } from "./markdown-review-stepper";
import type { ReviewGuard } from "@/shell/external-write-review-guard";
import { AnimatedZap } from "@/components/animated-zap";

type MarkdownViewProps = {
	readonly fileId: string;
	readonly filePath?: string;
	readonly isActiveView?: boolean;
	readonly isPanelFocused?: boolean;
	readonly focusOnLoad?: boolean;
	readonly syncActiveFile?: boolean;
	readonly externalWriteReview?: ExternalWriteReview | null;
	readonly onAcceptReviewDiff?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
	}) => void;
	readonly onRejectReviewDiff?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
	}) => Promise<void>;
	readonly onResolveReviewDiff?: (
		resolution: GranularReviewResolution,
	) => Promise<GranularReviewResolutionOutcome>;
	readonly onRegisterReviewGuard?: (guard: ReviewGuard) => () => void;
	readonly onReviewPendingChange?: (
		reviewId: string,
		hasPendingDecisions: boolean,
	) => void;
};

type HistoricalMarkdownBlockRow = {
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
	syncActiveFile = true,
	externalWriteReview = null,
	onAcceptReviewDiff,
	onRejectReviewDiff,
	onResolveReviewDiff,
	onRegisterReviewGuard,
	onReviewPendingChange,
}: MarkdownViewProps) {
	return (
		<Suspense fallback={<MarkdownLoadingSpinner />}>
			<MarkdownViewContent
				fileId={fileId}
				filePath={filePath}
				isActiveView={isActiveView}
				isPanelFocused={isPanelFocused}
				focusOnLoad={focusOnLoad}
				syncActiveFile={syncActiveFile}
				externalWriteReview={externalWriteReview}
				onAcceptReviewDiff={onAcceptReviewDiff}
				onRejectReviewDiff={onRejectReviewDiff}
				onResolveReviewDiff={onResolveReviewDiff}
				onRegisterReviewGuard={onRegisterReviewGuard}
				onReviewPendingChange={onReviewPendingChange}
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

	return <MarkdownViewLoaded fileRow={fileRow} {...props} />;
}

function MarkdownViewLoaded({
	fileRow,
	isActiveView = true,
	isPanelFocused = true,
	focusOnLoad = false,
	syncActiveFile = true,
	externalWriteReview = null,
	onAcceptReviewDiff,
	onRejectReviewDiff,
	onResolveReviewDiff,
	onRegisterReviewGuard,
	onReviewPendingChange,
}: Omit<MarkdownViewProps, "fileId"> & {
	readonly fileRow: MarkdownFileRow | undefined;
}) {
	const reviewDiff = useMemo<MarkdownReviewDiff | null>(() => {
		if (!externalWriteReview) return null;
		return {
			beforeMarkdown: decodeFileDataToText(externalWriteReview.beforeData),
			afterMarkdown: decodeFileDataToText(externalWriteReview.afterData),
			beforeDepth: externalWriteReview.beforeDepth,
			afterDepth: externalWriteReview.afterDepth,
		};
	}, [externalWriteReview]);

	let content: ReactNode;

	if (!fileRow) {
		content = (
			<div className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">
				File not found in the workspace.
			</div>
		);
	} else if (!isMarkdownFilePath(fileRow.path)) {
		content = <UnsupportedFilePlaceholder filePath={fileRow.path} />;
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
					<div className="relative min-h-0 flex-1">
						<TipTapEditor
							className="h-full"
							fileId={fileRow.id}
							isActiveView={isActiveView}
							focusOnLoad={focusOnLoad}
						/>
						<MarkdownAutosaveHint
							enabled={isActiveView && isPanelFocused && !reviewDiff}
						/>
						{reviewDiff && externalWriteReview ? (
							<Suspense fallback={<MarkdownReviewOverlayFallback />}>
								<MarkdownReviewOverlay
									fileId={fileRow.id}
									reviewDiff={reviewDiff}
									reviewId={externalWriteReview.reviewId}
									beforeCommitId={externalWriteReview.beforeCommitId}
									afterCommitId={externalWriteReview.afterCommitId}
									beforeData={externalWriteReview.beforeData}
									afterData={externalWriteReview.afterData}
									isActive={isActiveView && isPanelFocused}
									onAccept={onAcceptReviewDiff}
									onReject={onRejectReviewDiff}
									onResolve={onResolveReviewDiff}
									onRegisterReviewGuard={onRegisterReviewGuard}
									onReviewPendingChange={onReviewPendingChange}
								/>
							</Suspense>
						) : null}
					</div>
					{reviewDiff ? null : <SlashCommandMenu />}
				</div>
			</EditorProvider>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{syncActiveFile && fileRow && isMarkdownFilePath(fileRow.path) ? (
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
	reviewDiff,
	reviewId,
	beforeCommitId,
	afterCommitId,
	beforeData,
	afterData,
	isActive,
	onAccept,
	onReject,
	onResolve,
	onRegisterReviewGuard,
	onReviewPendingChange,
}: {
	readonly fileId: string;
	readonly reviewDiff: MarkdownReviewDiff;
	readonly reviewId: string;
	readonly beforeCommitId?: string;
	readonly afterCommitId?: string;
	readonly beforeData: Uint8Array;
	readonly afterData: Uint8Array;
	readonly isActive: boolean;
	readonly onAccept?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
	}) => void;
	readonly onReject?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
	}) => Promise<void>;
	readonly onResolve?: (
		resolution: GranularReviewResolution,
	) => Promise<GranularReviewResolutionOutcome>;
	readonly onRegisterReviewGuard?: (guard: ReviewGuard) => () => void;
	readonly onReviewPendingChange?: (
		reviewId: string,
		hasPendingDecisions: boolean,
	) => void;
}) {
	const beforeBlocks = useMarkdownBlocksAtCommit(fileId, beforeCommitId);
	const afterBlocks = useMarkdownBlocksAtCommit(fileId, afterCommitId);
	const diffContainerRef = useRef<HTMLDivElement | null>(null);
	const pendingDecisionsRef = useRef(false);
	const enrichedReviewDiff = useMemo<MarkdownReviewDiff>(() => {
		const beforeSnapshotsAvailable =
			beforeBlocks !== undefined &&
			(beforeBlocks.length > 0 ||
				reviewDiff.beforeMarkdown.trim().length === 0);
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
	}, [afterBlocks, beforeBlocks, reviewDiff]);
	// Granular review is only attempted when both historical snapshots can be
	// loaded; otherwise we keep the classic all-or-nothing controls.
	const canAttemptGranular = Boolean(
		beforeCommitId && afterCommitId && onResolve,
	);
	const snapshotsLoading =
		canAttemptGranular &&
		(beforeBlocks === undefined || afterBlocks === undefined);

	const eligibility = useMemo(() => {
		if (!canAttemptGranular || snapshotsLoading) return null;
		return planGranularReview({
			beforeBlocks,
			afterBlocks,
			beforeData,
			afterData,
		});
	}, [
		afterBlocks,
		afterData,
		beforeBlocks,
		beforeData,
		canAttemptGranular,
		snapshotsLoading,
	]);

	// Pair each change that swaps one block for one block so the diff renders a
	// word-level inline diff for it, even when Lix gave the edited block a new id
	// (an in-place edit that kept its id already word-diffs).
	const blockPairings = useMemo(() => {
		if (eligibility?.status !== "safe") return undefined;
		return eligibility.plan.changes
			.filter(
				(change) =>
					change.beforeBlockIds.length === 1 &&
					change.afterBlockIds.length === 1,
			)
			.map((change) => ({
				beforeId: change.beforeBlockIds[0]!,
				afterId: change.afterBlockIds[0]!,
			}));
	}, [eligibility]);

	const diffHtml = useMemo(() => {
		return renderMarkdownReviewDiffHtml(enrichedReviewDiff, { blockPairings });
	}, [enrichedReviewDiff, blockPairings]);

	const rejectReview = () => void onReject?.({ fileId, reviewId });

	// The per-change stepper only earns its keep when there is more than one
	// change to step through. A single change is effectively all-or-nothing, so
	// it uses the classic accept/reject controls instead of a "1 of 1" stepper.
	const isGranular =
		!snapshotsLoading &&
		eligibility?.status === "safe" &&
		eligibility.plan.changes.length > 1;

	// Register a partial-decision guard with the shell while the granular
	// stepper is mounted so destructive actions can prompt before discarding.
	useEffect(() => {
		if (!isGranular || !onRegisterReviewGuard) return;
		const unregister = onRegisterReviewGuard({
			reviewId,
			fileId,
			hasPendingDecisions: () => pendingDecisionsRef.current,
		});
		return () => {
			pendingDecisionsRef.current = false;
			onReviewPendingChange?.(reviewId, false);
			unregister();
		};
	}, [
		isGranular,
		onRegisterReviewGuard,
		onReviewPendingChange,
		reviewId,
		fileId,
	]);

	// Wait for the snapshot preflight before choosing a surface, so classic
	// controls do not flash and then swap to the stepper. The stepper handles
	// multi-change reviews; a single change uses the classic controls.
	const controls = snapshotsLoading ? null : eligibility?.status === "safe" &&
	  eligibility.plan.changes.length > 1 ? (
		<MarkdownReviewStepper
			plan={eligibility.plan}
			reviewId={reviewId}
			fileId={fileId}
			beforeData={beforeData}
			afterData={afterData}
			isActive={isActive}
			diffContainerRef={diffContainerRef}
			onResolve={onResolve!}
			onPendingDecisionsChange={(hasPending) => {
				pendingDecisionsRef.current = hasPending;
				onReviewPendingChange?.(reviewId, hasPending);
			}}
		/>
	) : (
		<ExternalWriteReviewControls
			isActive={isActive}
			onAccept={() => onAccept?.({ fileId, reviewId })}
			onReject={rejectReview}
		/>
	);

	return (
		<div className="markdown-review-overlay">
			<div className="markdown-review-surface">
				<div
					ref={diffContainerRef}
					className="ph-mask tiptap-container w-full h-full overflow-y-auto bg-background"
				>
					<div
						className="ProseMirror tiptap w-full mx-auto"
						dangerouslySetInnerHTML={{ __html: diffHtml }}
					/>
				</div>
			</div>
			{snapshotsLoading ? (
				<div className="markdown-review-loading" role="status">
					<Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
					<span>Loading review…</span>
				</div>
			) : (
				controls
			)}
		</div>
	);
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

function useMarkdownBlocksAtCommit(
	fileId: string,
	commitId: string | undefined,
): MarkdownBlockSnapshot[] | undefined {
	const rows = useQuery<HistoricalMarkdownBlockRow>(
		(lix) =>
			commitId
				? historicalMarkdownBlocksQuery(lix, commitId, fileId)
				: emptyMarkdownBlocksQuery(),
		{ subscribe: false },
	);
	return useMemo(() => {
		if (!commitId) return undefined;
		return rows
			.map((row) => parseHistoricalMarkdownBlock(row.snapshot_content))
			.filter((block): block is MarkdownBlockSnapshot => block !== null)
			.sort(
				(left, right) =>
					left.orderKey.localeCompare(right.orderKey) ||
					left.id.localeCompare(right.id),
			);
	}, [commitId, rows]);
}

function historicalMarkdownBlocksQuery(
	lix: ReturnType<typeof useLix>,
	commitId: string,
	fileId: string,
) {
	const sql = `
		WITH ranked AS (
			SELECT
				entity_pk,
				snapshot_content,
				depth,
				ROW_NUMBER() OVER (
					PARTITION BY entity_pk
					ORDER BY depth ASC
				) AS rn
			FROM lix_state_history
			WHERE start_commit_id = ?
				AND file_id = ?
				AND schema_key = 'markdown_block'
		)
		SELECT snapshot_content
		FROM ranked
		WHERE rn = 1
			AND snapshot_content IS NOT NULL
	`;
	const parameters = [commitId, fileId] as const;
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
				syncActiveFile={false}
				externalWriteReview={
					(instance.launchArgs?.[EXTERNAL_WRITE_REVIEW_LAUNCH_ARG] as
						| ExternalWriteReview
						| undefined) ?? null
				}
				onAcceptReviewDiff={context.acceptExternalWriteReview}
				onRejectReviewDiff={context.rejectExternalWriteReview}
				onResolveReviewDiff={context.resolveExternalWriteReviewGranular}
				onRegisterReviewGuard={context.registerExternalWriteReviewGuard}
				onReviewPendingChange={context.setExternalWriteReviewPending}
			/>
		</LixProvider>
	),
});
