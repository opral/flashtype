import { Suspense, useEffect } from "react";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { FileText, Loader2 } from "lucide-react";
import { LixProvider, useLix, useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { isMarkdownFilePath } from "@/widget-runtime/file-handlers";
import { EditorProvider } from "@/widgets/markdown/editor/editor-context";
import { TipTapEditor } from "@/widgets/markdown/editor/tip-tap-editor";
import { renderMarkdownReviewDiffHtml } from "./render-review-diff-html";
import "./style.css";
import { createReactWidgetDefinition } from "../../widget-runtime/react-widget";
import { FILE_WIDGET_KIND } from "../../widget-runtime/widget-instance-helpers";
import { FormattingToolbar } from "./components/formatting-toolbar";
import { SlashCommandMenu } from "./components/slash-command-menu";
import type { MarkdownReviewDiff } from "./review-diff";
import { decodeFileDataToText } from "@/lib/decode-file-data";
import { ExternalWriteReviewControls } from "@/widget-runtime/external-write-review-controls";
import {
	EXTERNAL_WRITE_REVIEW_LAUNCH_ARG,
	type ExternalWriteReview,
} from "@/widget-runtime/external-write-review";

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
			/>
		</Suspense>
	);
}

function MarkdownViewContent({
	fileId,
	isActiveView = true,
	isPanelFocused = true,
	focusOnLoad = false,
	syncActiveFile = true,
	externalWriteReview = null,
	onAcceptReviewDiff,
	onRejectReviewDiff,
}: MarkdownViewProps) {
	assertFileId(fileId);

	const fileRow = useQueryTakeFirst(
		(lix) =>
			qb(lix)
				.selectFrom("lix_file")
				.select(["id", "path"])
				.where("id", "=", fileId)
				.limit(1),
		{ subscribe: false },
	);
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
			<div className="flex h-full items-center justify-center text-sm text-neutral-500">
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
						{reviewDiff && externalWriteReview ? (
							<MarkdownReviewOverlay
								fileId={fileRow.id}
								reviewDiff={reviewDiff}
								reviewId={externalWriteReview.reviewId}
								isActive={isActiveView && isPanelFocused}
								onAccept={onAcceptReviewDiff}
								onReject={onRejectReviewDiff}
							/>
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

function MarkdownReviewOverlay({
	fileId,
	reviewDiff,
	reviewId,
	isActive,
	onAccept,
	onReject,
}: {
	readonly fileId: string;
	readonly reviewDiff: MarkdownReviewDiff;
	readonly reviewId: string;
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
	const diffHtml = useMemo(() => {
		return renderMarkdownReviewDiffHtml(reviewDiff);
	}, [reviewDiff]);
	const rejectReview = () => void onReject?.({ fileId, reviewId });

	return (
		<div className="markdown-review-overlay">
			<div className="markdown-review-surface">
				<div className="tiptap-container w-full h-full overflow-y-auto bg-background">
					<div
						className="ProseMirror tiptap w-full mx-auto"
						dangerouslySetInnerHTML={{ __html: diffHtml }}
					/>
				</div>
			</div>
			<ExternalWriteReviewControls
				isActive={isActive}
				onAccept={() => onAccept?.({ fileId, reviewId })}
				onReject={rejectReview}
			/>
		</div>
	);
}

function UnsupportedFilePlaceholder({
	filePath,
}: {
	readonly filePath: string;
}): ReactNode {
	return (
		<div className="flex h-full items-center justify-center px-6 py-8 text-center">
			<div className="max-w-sm space-y-2 text-sm text-neutral-600">
				<p className="font-medium text-neutral-800">
					This file type is not supported yet.
				</p>
				<p>
					Flashtype only opens markdown files in this editor, so{" "}
					<span className="font-mono text-xs text-neutral-700">{filePath}</span>{" "}
					was left blank to avoid damaging its formatting.
				</p>
				<p>
					<a
						href="https://github.com/opral/flashtype/issues"
						target="_blank"
						rel="noopener noreferrer"
						className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700"
					>
						Open an issue on GitHub
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
				<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
				<span>Loading editor…</span>
			</div>
		</div>
	);
}

/**
 * Markdown content view definition used by the registry.
 *
 * @example
 * import { widget as markdownView } from "@/widgets/markdown";
 */
export const widget = createReactWidgetDefinition({
	kind: FILE_WIDGET_KIND,
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
			/>
		</LixProvider>
	),
});
